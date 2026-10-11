// Scripted Telegram for the keyboard E2E tests. `npm run build:e2e` puts this
// module in place of src/telegram/gramClient.ts (see vite.config.ts), so the
// app runs its normal (non-demo) path against data the tests control through
// `window.__fakeTelegram`. It is never part of the release build.
//
// Before a page load, tests may set sessionStorage['fake-telegram-init'] to
// JSON {connect: 'ok'|'auth'|'network'|'flood', downForMs, push: boolean,
// mediaFails: boolean, extraChats: number, photoDelayMs: number} to script the
// connection; photoDelayMs delays photo downloads (getPhoto); extraChats
// adds that many older chats (35 messages each, two of them photos) for load
// tests, and lifts the app's page size so the whole list comes in one getChats.
//
// Photos are kept like Telegram keeps them: in sizes, here 'm' (fits 320 x 320)
// and 'x' (fits 800 x 800), JPEGs made from the demo pictures, plus the
// stripped 'i' preview that comes inside the message (content.preview, as the
// GramJS client makes it).
import photoTrailMap from '../../src/demo/assets/photo-trail-map.webp';
import sketchM from '../fixtures/sketch-m.jpg';
import sketchX from '../fixtures/sketch-x.jpg';
import sketchI from '../fixtures/sketch-i.jpg?inline';
import trailM from '../fixtures/trail-m.jpg';
import trailX from '../fixtures/trail-x.jpg';
import trailI from '../fixtures/trail-i.jpg?inline';
import avatarHike from '../../src/demo/assets/avatar-hike.webp';
import avatarMaya from '../../src/demo/assets/avatar-maya.webp';
import voiceNote from '../../src/demo/assets/voice-note.ogg';
import type {TelegramConfig} from '../../src/config/lumenConfig';
import {TelegramError, type ChatApi, type ChatUpdate, type MediaPayload} from '../../src/telegram/api';
import {sameEmoji} from '../../src/telegram/convert';
import {candidateChatIds} from '../../src/telegram/dialogId';
import {decodeWaveform} from '../../src/telegram/waveform';
import type {AllowedReactions, Chat, ChatMessage, Contact, MessageContent, ReactionSummary} from '../../src/telegram/model';

type Init = {connect?: 'ok' | 'auth' | 'network' | 'flood'; downForMs?: number; push?: boolean; mediaFails?: boolean; extraChats?: number; photoDelayMs?: number};

/**
 * Media of a message: `url` is the file; a photo may also have Telegram's
 * sizes ('m', 'x'). `thumbFails`: its small sizes fail to download (the photo
 * in full still opens).
 */
type FakeMedia = {url: string; mimetype: string; sizes?: {m: string; x: string}; thumbFails?: boolean};
type FakeMessage = ChatMessage & {media?: FakeMedia};
type FakeChat = Omit<Chat, 'lastMessage' | 'timestamp'> & {messages: FakeMessage[]; allowed: AllowedReactions; avatar?: string};

type Log = {
  connects: number;
  sent: {chatId: string; text: string; replyToId: string | null}[];
  /** Voice notes sent: size, first bytes ("OggS"), seconds, waveform values. */
  voice: {chatId: string; bytes: number; head: string; seconds: number; waveform: number[]}[];
  /** Photos sent: size, first bytes (ffd8ff for a JPEG), its width and height, caption. */
  photos: {chatId: string; bytes: number; head: string; mimetype: string; caption: string; width: number | null; height: number | null}[];
  reactions: {chatId: string; messageId: string; emoji: string | null}[];
  reads: {chatId: string; maxId: string}[];
  /** Notification dialogs looked up on Telegram (not found in the loaded list). */
  resolves: string[];
  mediaRequests: {chatId: string; messageId: string}[];
  photoRequests: string[];
  /** Photo downloads in a size (getPhoto): the side asked for, and the size served. */
  photoDownloads: {chatId: string; messageId: string; side: number; served: string}[];
};

const STANDARD = ['👍', '❤', '🔥', '🤣', '😁', '😢', '😭', '🎉'];

declare global {
  interface Window {
    __fakeTelegram?: ReturnType<typeof createController>;
  }
}

let idCounter = 100;
const minutesAgo = (minutes: number) => Date.now() - minutes * 60000;

function msg(chatId: string, fromMe: boolean, minutes: number, content: MessageContent, senderName: string | null, extra: Partial<FakeMessage> = {}): FakeMessage {
  idCounter += 1;
  return {id: String(idCounter), chatId, fromMe, senderName: fromMe ? null : senderName, timestamp: minutesAgo(minutes), content, ...extra};
}

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

/** A photo message's content and media as Telegram has them: 800 x 600, sizes m and x, and the stripped preview. */
export function telegramPhoto(caption: string, picture: 'trail' | 'sketch' = 'trail'): {content: MessageContent; media: FakeMedia} {
  const [m, x, preview] = picture === 'trail' ? [trailM, trailX, trailI] : [sketchM, sketchX, sketchI];
  return {
    content: {kind: 'photo', text: caption, width: 800, height: 600, preview: base64Of(preview)},
    media: {url: x, mimetype: 'image/jpeg', sizes: {m, x}},
  };
}

function seed(): FakeChat[] {
  idCounter = 100;
  const lunch = telegramPhoto('Foto do almoço', 'sketch');
  const look = telegramPhoto('Olha isso');
  const text = (value: string): MessageContent => ({kind: 'text', text: value});
  const combinado = msg('1001', true, 60, text('Combinado, até amanhã'), null, {reactions: [{emoji: '👍', count: 1, mine: false}]});
  return [
    {
      id: '1001', name: 'Ana Souza', isGroup: false, unreadCount: 2, hasPhoto: true, photoKey: 'ana-1', avatar: avatarMaya,
      allowed: {kind: 'some', emojis: STANDARD},
      messages: [
        msg('1001', false, 120, {kind: 'audio', text: '', seconds: 6}, 'Ana Souza', {media: {url: voiceNote, mimetype: 'audio/ogg'}}),
        combinado,
        msg('1001', false, 4, text('Oi! Tudo certo para amanhã?'), 'Ana Souza'),
        msg('1001', false, 3, text('Levo o projetor'), 'Ana Souza'),
      ],
    },
    {
      id: '1006', name: null, phone: '+15550100106', isGroup: false, unreadCount: 1, hasPhoto: false,
      allowed: {kind: 'some', emojis: STANDARD},
      messages: [msg('1006', false, 10, {kind: 'sticker', text: '👋'}, null)],
    },
    {
      id: '-2002', name: 'Família', isGroup: true, unreadCount: 0, hasPhoto: true, photoKey: 'familia-1', avatar: avatarHike,
      allowed: {kind: 'some', emojis: ['👍', '❤', '🤣']},
      messages: [
        msg('-2002', false, 90, text('Almoço no domingo?'), 'Bruno Lima'),
        msg('-2002', true, 88, text('Eu vou'), null),
        // Yours, sent from another device (or an earlier session): Telegram's sizes, like anyone's.
        msg('-2002', true, 87, lunch.content, null, {media: lunch.media}),
        // Without size, preview or downloadable small size (an old client): the icon, then the photo in full.
        msg('-2002', false, 85, {kind: 'photo', text: 'Sem miniatura'}, 'Bruno Lima', {media: {url: photoTrailMap, mimetype: 'image/webp', thumbFails: true}}),
        msg('-2002', false, 83, look.content, 'Bruno Lima', {media: look.media}),
      ],
    },
    {
      id: '1003', name: 'Carla Dias', isGroup: false, unreadCount: 0, hasPhoto: true, photoKey: 'carla-broken',
      allowed: {kind: 'some', emojis: STANDARD},
      messages: [
        msg('1003', false, 1500, text('Me manda o endereço?'), 'Carla Dias'),
        msg('1003', true, 1440, {kind: 'audio', text: '', seconds: 12}, null),
      ],
    },
    {
      id: '-1009', name: 'Avisos', isGroup: false, unreadCount: 0, hasPhoto: false,
      allowed: {kind: 'none'},
      messages: [msg('-1009', false, 3000, {kind: 'poll', text: 'Melhor horário?'}, 'Avisos')],
    },
    {
      id: '1005', name: 'Diego Alves', isGroup: false, unreadCount: 0, hasPhoto: false,
      allowed: {kind: 'some', emojis: STANDARD},
      messages: [
        msg('1005', false, 4400, {kind: 'document', text: 'orcamento.pdf'}, 'Diego Alves'),
        msg('1005', false, 4300, {kind: 'location', text: 'Praça Central'}, 'Diego Alves'),
        msg('1005', false, 4200, {kind: 'contact', text: 'Rita Gomes'}, 'Diego Alves'),
        // An audio file (not a voice note): still a playable audio bubble.
        msg('1005', false, 4150, {kind: 'audio', text: '', seconds: 6, voice: false}, 'Diego Alves', {media: {url: voiceNote, mimetype: 'audio/ogg'}}),
        msg('1005', false, 4100, {kind: 'video', text: ''}, 'Diego Alves'),
      ],
    },
  ];
}

const FILLER = [
  'Ok',
  'See you at the station at eight, the train leaves at 8:20.',
  'Did you get the files I sent yesterday? The second one has the new numbers and the photos from the visit.',
  'Thanks!',
  'Can we move the call to Thursday afternoon?',
];

/** Older chats after the seeded ones, for load tests: every 2nd with a photo, every 3rd unread. */
function extraChats(count: number): FakeChat[] {
  return Array.from({length: count}, (_, index): FakeChat => {
    const id = String(3000 + index);
    const name = `Contact ${index + 1}`;
    const newest = 5000 + index * 60;
    const messages = Array.from({length: 35}, (__, step) => {
      const age = 34 - step;
      // Two photos among the newest messages: one received, one of yours.
      const photo = age === 2 || age === 5 ? telegramPhoto(FILLER[3], age === 2 ? 'trail' : 'sketch') : null;
      return photo
        ? msg(id, age % 4 === 1, newest + age * 2, photo.content, name, {media: photo.media})
        : msg(id, age % 4 === 1, newest + age * 2, {kind: 'text', text: FILLER[(index + age) % FILLER.length]}, name);
    });
    const photo = index % 2 === 0 ? [avatarMaya, avatarHike][index % 4 === 0 ? 0 : 1] : undefined;
    return {
      id, name, isGroup: false, unreadCount: index % 3 === 0 ? 2 : 0,
      // A query per chat, so each photo is a separate download and decode, as on a real account.
      hasPhoto: photo != null, photoKey: photo ? `extra-${index}` : undefined, avatar: photo ? `${photo}?chat=${index}` : undefined,
      allowed: {kind: 'some', emojis: STANDARD},
      messages,
    };
  });
}

/** Width and height of a JPEG, from its SOF segment (null when it is not one). */
function jpegSize(bytes: Uint8Array): {width: number; height: number} | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset + 9 < bytes.length; ) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8]};
    }
    offset += 2 + length;
  }
  return null;
}

function readInit(): Init {
  try {
    return JSON.parse(sessionStorage.getItem('fake-telegram-init') ?? '{}') as Init;
  } catch {
    return {};
  }
}

function createController() {
  const init = readInit();
  const chats = [...seed(), ...extraChats(init.extraChats ?? 0)];
  const listeners = new Set<(update: ChatUpdate) => void>();
  const log: Log = {connects: 0, sent: [], voice: [], photos: [], reactions: [], reads: [], resolves: [], mediaRequests: [], photoRequests: [], photoDownloads: []};
  const state = {
    downUntil: Date.now() + (init.downForMs ?? 0), push: init.push !== false, mediaFails: init.mediaFails === true, pollFails: false, photoFailures: 0, photoDelayMs: 0,
    downloadDelayMs: init.photoDelayMs ?? 0, downloadFails: false,
  };

  // Saved contacts: the people with a chat, and Bruno Lima, who has none yet.
  const contacts: Contact[] = [
    {id: '1001', name: 'Ana Souza', phone: '+5511999990001'},
    {id: '1003', name: 'Carla Dias', phone: '+5511999990003'},
    {id: '1005', name: 'Diego Alves', phone: null},
    {id: '1008', name: 'Bruno Lima', phone: '+5511999990002'},
  ];
  // A supergroup you are in whose chat is older than the loaded list: Telegram finds it by id.
  const unlisted: FakeChat[] = [
    {
      id: '-1001500000077', name: 'Trilhas BR', isGroup: true, unreadCount: 0, hasPhoto: false,
      allowed: {kind: 'some', emojis: STANDARD},
      messages: [msg('-1001500000077', false, 6, {kind: 'text', text: 'Saída às 7h do portão norte'}, 'Rui Prado')],
    },
  ];
  // A contact's conversation before its first message; it joins the list once a message is sent.
  const contactChats = new Map<string, FakeChat>();
  const chatFor = (chatId: string) => {
    const chat = chats.find(item => item.id === chatId) ?? unlisted.find(item => item.id === chatId);
    if (chat) return chat;
    const contact = contacts.find(item => item.id === chatId);
    if (!contact) throw new TelegramError('rejected', 'PEER_ID_INVALID', 'PEER_ID_INVALID');
    let pending = contactChats.get(chatId);
    if (!pending) {
      pending = {id: contact.id, name: contact.name, isGroup: false, unreadCount: 0, hasPhoto: false, messages: [], allowed: {kind: 'some', emojis: STANDARD}};
      contactChats.set(chatId, pending);
    }
    return pending;
  };
  const listChat = (chat: FakeChat) => {
    if (!chats.includes(chat)) chats.push(chat);
  };
  const notify = (chatId: string) => {
    if (state.push) for (const listener of listeners) listener({chatId});
  };
  const copy = (message: FakeMessage): ChatMessage => {
    const {media: _media, ...rest} = message;
    return JSON.parse(JSON.stringify(rest)) as ChatMessage;
  };
  const guard = async () => {
    await new Promise(resolve => setTimeout(resolve, 40));
    if (Date.now() < state.downUntil || state.pollFails) {
      throw new TelegramError('network', 'Not connected');
    }
  };

  return {
    init,
    log,
    state,
    chats,
    listeners,
    chatFor,
    /** A message arrives (pushed as an update unless push is off). */
    incoming(chatId: string, text: string, senderName: string) {
      const chat = chatFor(chatId);
      chat.messages.push(msg(chatId, false, 0, {kind: 'text', text}, senderName));
      chat.unreadCount += 1;
      notify(chatId);
    },
    /** A photo message arrives (Telegram's sizes and preview); `fromMe`: yours, from another device. */
    incomingPhoto(chatId: string, caption: string, senderName: string | null, fromMe = false) {
      const chat = chatFor(chatId);
      const photo = telegramPhoto(caption);
      chat.messages.push(msg(chatId, fromMe, 0, photo.content, senderName, {media: photo.media}));
      if (!fromMe) chat.unreadCount += 1;
      notify(chatId);
    },
    /** A text message of yours (from another device) arrives. */
    outgoing(chatId: string, text: string) {
      chatFor(chatId).messages.push(msg(chatId, true, 0, {kind: 'text', text}, null));
      notify(chatId);
    },
    /** Photo downloads (getPhoto) take `delayMs`; with `fails`, they fail. */
    setPhotoDownload({delayMs = 0, fails = false}: {delayMs?: number; fails?: boolean}) {
      state.downloadDelayMs = delayMs;
      state.downloadFails = fails;
    },
    /** Someone reacts to a message (pushed as an update). */
    react(chatId: string, messageId: string, emoji: string) {
      const message = chatFor(chatId).messages.find(item => item.id === messageId);
      if (message) {
        const existing = message.reactions?.find(item => sameEmoji(item.emoji, emoji));
        if (existing) existing.count += 1;
        else message.reactions = [...(message.reactions ?? []), {emoji, count: 1, mine: false}];
      }
      notify(chatId);
    },
    setPush(value: boolean) {
      state.push = value;
    },
    setPollFails(value: boolean) {
      state.pollFails = value;
    },
    /** The next `failures` photo uploads fail; every upload takes `delayMs` (over the phone's internet). */
    setPhotoUpload({failures = 0, delayMs = 0}: {failures?: number; delayMs?: number}) {
      state.photoFailures = failures;
      state.photoDelayMs = delayMs;
    },
    api(): ChatApi {
      return {
        async getChats(limit) {
          await guard();
          return chats
            .map((chat): Chat => {
              const {messages, allowed: _allowed, avatar: _avatar, ...rest} = chat;
              const last = messages[messages.length - 1];
              return {...rest, lastMessage: last ? copy(last) : null, timestamp: last?.timestamp ?? null};
            })
            .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
            .slice(0, init.extraChats ? undefined : limit);
        },
        async getContacts() {
          await guard();
          return contacts.map(contact => ({...contact}));
        },
        async getMessages(chatId, limit) {
          await guard();
          return chatFor(chatId).messages.slice(-limit).map(copy);
        },
        async sendVoice(chatId, voice) {
          await guard();
          const seconds = Math.max(1, Math.round(voice.durationMs / 1000));
          log.voice.push({
            chatId,
            bytes: voice.bytes.length,
            head: String.fromCharCode(...voice.bytes.subarray(0, 4)),
            seconds,
            waveform: voice.waveform ? decodeWaveform(voice.waveform) : [],
          });
          const sent = msg(chatId, true, 0, {kind: 'audio', text: '', seconds}, null);
          chatFor(chatId).messages.push(sent);
          listChat(chatFor(chatId));
          return copy(sent);
        },
        async sendPhoto(chatId, photo) {
          await guard();
          await new Promise(resolve => setTimeout(resolve, state.photoDelayMs));
          if (state.photoFailures > 0) {
            state.photoFailures -= 1;
            throw new TelegramError('server', 'Upload failed');
          }
          const size = jpegSize(photo.bytes);
          log.photos.push({
            chatId,
            bytes: photo.bytes.length,
            head: Array.from(photo.bytes.subarray(0, 3), byte => byte.toString(16).padStart(2, '0')).join(''),
            mimetype: photo.mimetype,
            caption: photo.caption,
            width: size?.width ?? null,
            height: size?.height ?? null,
          });
          const url = URL.createObjectURL(new Blob([photo.bytes as BlobPart], {type: photo.mimetype}));
          // Telegram's copy has the photo's size (its sizes are served from the file itself here).
          const shape = size ? {width: size.width, height: size.height} : {};
          const sent = msg(chatId, true, 0, {kind: 'photo', text: photo.caption, ...shape}, null, {media: {url, mimetype: photo.mimetype}});
          chatFor(chatId).messages.push(sent);
          listChat(chatFor(chatId));
          return copy(sent);
        },
        async sendText(chatId, text, replyToId) {
          await guard();
          log.sent.push({chatId, text, replyToId: replyToId ?? null});
          const sent = msg(chatId, true, 0, {kind: 'text', text}, null);
          chatFor(chatId).messages.push(sent);
          listChat(chatFor(chatId));
          return copy(sent);
        },
        async sendReaction(chatId, messageId, emoji) {
          await guard();
          const chat = chatFor(chatId);
          if (emoji && (chat.allowed.kind === 'none' || (chat.allowed.kind === 'some' && !chat.allowed.emojis.some(item => sameEmoji(item, emoji))))) {
            throw new TelegramError('rejected', 'REACTION_INVALID', 'REACTION_INVALID');
          }
          log.reactions.push({chatId, messageId, emoji});
          const message = chat.messages.find(item => item.id === messageId);
          if (!message) throw new TelegramError('rejected', 'MESSAGE_ID_INVALID', 'MESSAGE_ID_INVALID');
          const next: ReactionSummary[] = [];
          for (const reaction of message.reactions ?? []) {
            if (reaction.mine) {
              if (reaction.count > 1) next.push({...reaction, count: reaction.count - 1, mine: false});
            } else next.push(reaction);
          }
          if (emoji) {
            const existing = next.find(item => sameEmoji(item.emoji, emoji));
            if (existing) {
              existing.count += 1;
              existing.mine = true;
            } else next.push({emoji, count: 1, mine: true});
          }
          message.reactions = next.length ? next : undefined;
          return message.reactions?.map(item => ({...item}));
        },
        async markRead(chatId, maxId) {
          await guard();
          log.reads.push({chatId, maxId});
          chatFor(chatId).unreadCount = 0;
        },
        async allowedReactions(chatId) {
          await guard();
          return chatFor(chatId).allowed;
        },
        async getProfilePhoto(chatId) {
          await guard();
          log.photoRequests.push(chatId);
          const chat = chatFor(chatId);
          if (chat.photoKey === 'carla-broken') return {mimetype: 'image/jpeg', bytes: new Uint8Array([1, 2, 3])};
          return chat.avatar ? {mimetype: 'image/webp', url: new URL(chat.avatar, location.href).href} : null;
        },
        async getMedia(chatId, messageId): Promise<MediaPayload> {
          await guard();
          log.mediaRequests.push({chatId, messageId});
          const media = chatFor(chatId).messages.find(item => item.id === messageId)?.media;
          if (state.mediaFails || !media) throw new TelegramError('rejected', 'MEDIA_EMPTY', 'MEDIA_EMPTY');
          return {mimetype: media.mimetype, url: new URL(media.url, location.href).href};
        },
        async getPhoto(chatId, messageId, side): Promise<MediaPayload> {
          await guard();
          const media = chatFor(chatId).messages.find(item => item.id === messageId)?.media;
          const served = media?.sizes ? (side <= 320 ? 'm' : 'x') : 'file';
          log.photoDownloads.push({chatId, messageId, side, served});
          await new Promise(resolve => setTimeout(resolve, state.downloadDelayMs));
          if (state.mediaFails || state.downloadFails || !media || (media.thumbFails && side <= 320)) {
            throw new TelegramError('rejected', 'MEDIA_EMPTY', 'MEDIA_EMPTY');
          }
          const url = media.sizes ? media.sizes[side <= 320 ? 'm' : 'x'] : media.url;
          return {mimetype: media.mimetype, url: new URL(url, location.href).href};
        },
        async resolveDialog(dialog) {
          await guard();
          log.resolves.push(dialog.kind === 'user' ? dialog.userId : `-${dialog.id}`);
          const candidates = new Set(candidateChatIds(dialog));
          const chat = [...chats, ...unlisted].find(item => candidates.has(item.id));
          if (!chat) return null;
          const {messages: _messages, allowed: _allowed, avatar: _avatar, ...rest} = chat;
          return {...rest, unreadCount: 0, lastMessage: null, timestamp: null};
        },
        onUpdate(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async disconnect() {
          listeners.clear();
        },
      };
    },
  };
}

/** Same signature as the GramJS module it replaces. */
export async function connectTelegram(config: TelegramConfig, _options: {timeoutMs?: number} = {}): Promise<ChatApi> {
  window.__fakeTelegram ??= createController();
  const fake = window.__fakeTelegram;
  fake.log.connects += 1;
  await new Promise(resolve => setTimeout(resolve, 60));
  if (config.apiId === 401 || fake.init.connect === 'auth') {
    throw new TelegramError('auth', 'AUTH_KEY_UNREGISTERED', 'AUTH_KEY_UNREGISTERED');
  }
  if (fake.init.connect === 'flood') {
    throw new TelegramError('flood', 'FLOOD_WAIT_42', 'FLOOD_WAIT_42', 42);
  }
  if (fake.init.connect === 'network' || Date.now() < fake.state.downUntil) {
    throw new TelegramError('network', 'Connecting timed out');
  }
  return fake.api();
}
