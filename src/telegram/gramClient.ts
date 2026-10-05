// Telegram client: a user account over MTProto with GramJS, straight from the
// browser through WebSocket (wss://<dc>.web.telegram.org/apiws, port 443).
// Loaded with a dynamic import only when a real account is configured, so the
// demo and the first screen do not download it.
import './polyfills';
import bigInt from 'big-integer';
import {Buffer} from 'buffer';
import {Api, TelegramClient, utils} from 'telegram';
import type {Entity} from 'telegram/define';
import {Raw} from 'telegram/events';
import {LogLevel} from 'telegram/extensions/Logger';
import {CustomFile} from 'telegram/client/uploads';
import {StringSession} from 'telegram/sessions';
import type {TelegramConfig} from '../config/lumenConfig';
import {TelegramError, type ChatApi, type ChatUpdate, type MediaPayload, type VoiceNote} from './api';
import {entityChat, entityName, reactionsOf, toChat, toMessage, type Tl} from './convert';
import {dialogPeers, markedId, type DialogPeer, type NotificationDialog} from './dialogId';
import {toTelegramError} from './errors';
import type {AllowedReactions, Chat, ChatMessage, Contact} from './model';

/** Web endpoints of the data centers; the session's own address (an IP from a desktop login) has no TLS certificate. */
const WEB_HOSTS: Record<number, string> = {1: 'pluto', 2: 'venus', 3: 'aurora', 4: 'vesta', 5: 'flora'};
const CONNECT_TIMEOUT_MS = 15000;
const CALL_TIMEOUT_MS = 20000;
/** Media downloads can take longer on the phone's connection. */
const MEDIA_TIMEOUT_MS = 45000;
const REACH_TIMEOUT_MS = 6000;

export function webHost(dcId: number): string | null {
  const name = WEB_HOSTS[dcId];
  return name ? `${name}.web.telegram.org` : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TelegramError('network', `${what} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * True when the data center accepts a WebSocket. Telegram closes the socket
 * of a session whose key it does not know, and GramJS then keeps
 * reconnecting; a reachable server after a connect timeout therefore means
 * the session was refused, not that the network is down.
 */
export function canReach(host: string): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const finish = (value: boolean) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        resolve(value);
      }
    };
    const socket = new WebSocket(`wss://${host}/apiws`, 'binary');
    const timer = setTimeout(() => finish(false), REACH_TIMEOUT_MS);
    socket.onopen = () => finish(true);
    socket.onerror = () => finish(false);
  });
}

function peerId(peer: object | undefined | null): string | undefined {
  if (!peer) {
    return undefined;
  }
  try {
    return utils.getPeerId(peer as Api.TypePeer);
  } catch {
    return undefined;
  }
}

/** Chat touched by an update, '' for updates that do not concern chats. */
function chatOfUpdate(value: object): string | undefined | null {
  const update = value as Tl;
  switch (update.className) {
    case 'UpdateNewMessage':
    case 'UpdateEditMessage':
    case 'UpdateNewChannelMessage':
    case 'UpdateEditChannelMessage':
      return peerId(update.message?.peerId);
    case 'UpdateShortMessage':
      return String(update.userId);
    case 'UpdateShortChatMessage':
      return peerId(new Api.PeerChat({chatId: update.chatId}));
    case 'UpdateMessageReactions':
    case 'UpdateReadHistoryInbox':
    case 'UpdateReadHistoryOutbox':
      return peerId(update.peer);
    case 'UpdateReadChannelInbox':
    case 'UpdateReadChannelOutbox':
    case 'UpdateDeleteChannelMessages':
    case 'UpdateChannel':
      return peerId(new Api.PeerChannel({channelId: update.channelId}));
    case 'UpdateDeleteMessages':
    case 'UpdatesTooLong':
    case 'UpdateDialogUnreadMark':
      return undefined;
    default:
      return null;
  }
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array && value.length > 0) {
    return new Uint8Array(value);
  }
  return null;
}

/**
 * The app model of a message this session just sent. It is ours whatever the
 * response's `out` flag says, so the list reads "You: …" and the bubble is outgoing.
 */
export function sentMessage(value: object | null | undefined, chatId: string): ChatMessage | null {
  const message = toMessage(value, {chatId});
  return message ? {...message, fromMe: true} : null;
}

/**
 * Sends a native voice note: an OGG/Opus document with documentAttributeAudio
 * voice=true, its length and the 5-bit waveform, so Telegram shows the
 * waveform and plays it inline.
 */
export function sendVoiceNote(client: TelegramClient, entity: Entity | Api.TypeInputPeer, voice: VoiceNote): Promise<Api.Message> {
  const buffer = Buffer.from(voice.bytes);
  return client.sendFile(entity, {
    file: new CustomFile('voice.ogg', buffer.length, '', buffer),
    voiceNote: true,
    attributes: [
      new Api.DocumentAttributeAudio({
        voice: true,
        duration: Math.max(1, Math.round(voice.durationMs / 1000)),
        ...(voice.waveform?.length ? {waveform: Buffer.from(voice.waveform)} : {}),
      }),
    ],
    workers: 1,
  });
}

/**
 * The chat of a notification's dialog: an entity already known this session
 * first, then Telegram (the user; a channel or supergroup, then a basic group).
 * A lookup that fails (unknown id, no access hash) moves on to the next one.
 */
export async function findDialogChat(
  dialog: NotificationDialog,
  known: (chatId: string) => Entity | undefined,
  fetch: (peer: DialogPeer) => Promise<Entity>,
): Promise<{chat: Chat; entity: Entity} | null> {
  const peers = dialogPeers(dialog);
  for (const peer of peers) {
    const entity = known(markedId(peer));
    const chat = entityChat(entity, markedId(peer));
    if (entity && chat) {
      return {chat, entity};
    }
  }
  for (const peer of peers) {
    try {
      const entity = await fetch(peer);
      const chat = entityChat(entity, peerId(entity) ?? markedId(peer));
      if (chat) {
        return {chat, entity};
      }
    } catch {
      // Not this kind of peer, or not reachable without an access hash.
    }
  }
  return null;
}

function toPeer(peer: DialogPeer): Api.TypePeer {
  switch (peer.type) {
    case 'user':
      return new Api.PeerUser({userId: bigInt(peer.id)});
    case 'chat':
      return new Api.PeerChat({chatId: bigInt(peer.id)});
    case 'channel':
      return new Api.PeerChannel({channelId: bigInt(peer.id)});
  }
}

/** Connects with the configured session; rejects with a TelegramError (auth/network/…). */
export async function connectTelegram(config: TelegramConfig, {timeoutMs = CONNECT_TIMEOUT_MS}: {timeoutMs?: number} = {}): Promise<ChatApi> {
  let session: StringSession;
  try {
    session = new StringSession(config.session);
  } catch {
    throw new TelegramError('auth', 'The session string is not valid', 'SESSION_INVALID');
  }
  const host = webHost(session.dcId);
  if (!host) {
    throw new TelegramError('auth', 'The session has no known data center', 'SESSION_INVALID');
  }
  session.setDC(session.dcId, host, 443);

  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    useWSS: true,
    connectionRetries: 5,
    retryDelay: 1000,
    autoReconnect: true,
    deviceModel: 'Rokid Lumen',
    systemVersion: 'Lumen',
    appVersion: 'lumen-telegram',
    langCode: 'en',
    systemLangCode: 'en',
  });
  client.setLogLevel(LogLevel.ERROR);
  client.setParseMode(undefined);

  try {
    await withTimeout(client.connect(), timeoutMs, 'Connecting');
    // After its own retries GramJS resolves connect() even when no socket opened.
    if (!client.connected) {
      throw new TelegramError('network', 'Could not open a connection to Telegram');
    }
    await withTimeout(client.getMe(), Math.min(CALL_TIMEOUT_MS, timeoutMs), 'Checking the session');
  } catch (error) {
    // GramJS may still be retrying; stop it without waiting on it.
    void client.destroy().catch(() => undefined);
    const failure = toTelegramError(error);
    if (failure.kind === 'network' && (await canReach(host))) {
      throw new TelegramError('auth', 'Telegram did not accept the session', 'AUTH_KEY_UNKNOWN');
    }
    throw failure;
  }

  const entities = new Map<string, Entity>();
  const allowedCache = new Map<string, AllowedReactions>();
  let standardReactions: string[] | null = null;
  const listeners = new Set<(update: ChatUpdate) => void>();

  const remember = (entity: Entity | undefined) => {
    const id = peerId(entity);
    if (id && entity) {
      entities.set(id, entity);
    }
  };
  const nameOfPeer = (peer: object) => entityName(entities.get(peerId(peer) ?? ''));

  const call = async <T>(work: () => Promise<T>, ms: number = CALL_TIMEOUT_MS): Promise<T> => {
    try {
      return await withTimeout(work(), ms, 'Telegram request');
    } catch (error) {
      throw toTelegramError(error);
    }
  };

  const entityFor = async (chatId: string): Promise<Entity> => {
    const known = entities.get(chatId);
    if (known) {
      return known;
    }
    const entity = await client.getEntity(bigInt(chatId));
    remember(entity);
    return entity;
  };

  const loadChats = async (limit: number): Promise<Chat[]> => {
    const dialogs = await client.getDialogs({limit});
    for (const dialog of dialogs) {
      remember(dialog.entity);
    }
    return dialogs.map(dialog => toChat(dialog, nameOfPeer)).filter((chat): chat is Chat => chat != null);
  };

  const fetchMessage = async (entity: Entity, messageId: string): Promise<Api.Message | undefined> => {
    const [message] = await client.getMessages(entity, {ids: [Number(messageId)]});
    return message;
  };

  const handler = (update: object) => {
    const chatId = chatOfUpdate(update);
    if (chatId === null) {
      return;
    }
    for (const listener of listeners) {
      listener({chatId});
    }
  };
  client.addEventHandler(handler, new Raw({}));

  const loadStandardReactions = async (): Promise<string[] | null> => {
    if (standardReactions) {
      return standardReactions;
    }
    try {
      const result = await client.invoke(new Api.messages.GetAvailableReactions({hash: 0}));
      const list =
        result instanceof Api.messages.AvailableReactions
          ? result.reactions.filter(item => !item.inactive && !item.premium).map(item => item.reaction)
          : [];
      standardReactions = list.length ? list : null;
    } catch {
      standardReactions = null;
    }
    return standardReactions;
  };

  const chatReactions = (available: Api.TypeChatReactions | undefined): AllowedReactions | null => {
    if (available instanceof Api.ChatReactionsNone) {
      return {kind: 'none'};
    }
    if (available instanceof Api.ChatReactionsSome) {
      return {
        kind: 'some',
        emojis: available.reactions.flatMap(item => (item instanceof Api.ReactionEmoji ? [item.emoticon] : [])),
      };
    }
    return null;
  };

  return {
    getChats: limit => call(() => loadChats(limit)),

    getContacts: () =>
      call(async () => {
        const result = await client.invoke(new Api.contacts.GetContacts({hash: bigInt(0)}));
        if (!(result instanceof Api.contacts.Contacts)) {
          return [];
        }
        const contacts: Contact[] = [];
        for (const user of result.users) {
          if (!(user instanceof Api.User) || user.deleted || user.self) {
            continue;
          }
          // Known with its access hash, so its conversation opens like a chat's.
          remember(user);
          const id = peerId(user);
          const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
          if (id && name) {
            contacts.push({id, name, phone: user.phone ? `+${user.phone}` : null});
          }
        }
        return contacts;
      }),

    getMessages: (chatId, limit) =>
      call(async () => {
        const entity = await entityFor(chatId);
        const messages = await client.getMessages(entity, {limit});
        for (const message of messages) {
          remember(message.sender);
        }
        return messages
          .map(message => toMessage(message, {chatId, peerName: nameOfPeer}))
          .filter((message): message is ChatMessage => message != null)
          .reverse();
      }),

    sendText: (chatId, text, replyToId) =>
      call(async () => {
        const entity = await entityFor(chatId);
        const sent = await client.sendMessage(entity, {
          message: text,
          ...(replyToId ? {replyTo: Number(replyToId)} : {}),
        });
        const message = sentMessage(sent, chatId);
        if (!message) {
          throw new TelegramError('server', 'Telegram did not return the sent message');
        }
        return message;
      }),

    sendVoice: (chatId, voice) =>
      call(async () => {
        const sent = await sendVoiceNote(client, await entityFor(chatId), voice);
        const message = sentMessage(sent, chatId);
        if (!message) {
          throw new TelegramError('server', 'Telegram did not return the sent voice note');
        }
        return message;
      }, MEDIA_TIMEOUT_MS),

    sendReaction: (chatId, messageId, emoji) =>
      call(async () => {
        const entity = await entityFor(chatId);
        const result = await client.invoke(
          new Api.messages.SendReaction({
            peer: entity,
            msgId: Number(messageId),
            reaction: emoji ? [new Api.ReactionEmoji({emoticon: emoji})] : [],
          }),
        );
        const updates = result instanceof Api.Updates || result instanceof Api.UpdatesCombined ? result.updates : [];
        const update = updates.find(item => item instanceof Api.UpdateMessageReactions);
        if (update instanceof Api.UpdateMessageReactions) {
          return reactionsOf({reactions: update.reactions});
        }
        const message = await fetchMessage(entity, messageId);
        return message ? reactionsOf(message) : undefined;
      }),

    markRead: (chatId, maxId) =>
      call(async () => {
        const entity = await entityFor(chatId);
        await client.markAsRead(entity, undefined, {maxId: Number(maxId)});
      }),

    allowedReactions: chatId =>
      call(async () => {
        const cached = allowedCache.get(chatId);
        if (cached) {
          return cached;
        }
        const entity = await entityFor(chatId);
        let allowed: AllowedReactions | null = null;
        if (entity instanceof Api.Chat) {
          const full = await client.invoke(new Api.messages.GetFullChat({chatId: entity.id}));
          allowed = chatReactions(full.fullChat.availableReactions);
        } else if (entity instanceof Api.Channel) {
          const full = await client.invoke(new Api.channels.GetFullChannel({channel: entity}));
          allowed = chatReactions(full.fullChat.availableReactions);
        }
        if (allowed == null) {
          const standard = await loadStandardReactions();
          allowed = standard ? {kind: 'some', emojis: standard} : {kind: 'all'};
        }
        allowedCache.set(chatId, allowed);
        return allowed;
      }),

    getProfilePhoto: chatId =>
      call(async () => {
        const entity = await entityFor(chatId);
        const bytes = toBytes(await client.downloadProfilePhoto(entity, {isBig: false}));
        return bytes ? {mimetype: 'image/jpeg', bytes} : null;
      }, MEDIA_TIMEOUT_MS),

    getMedia: (chatId, messageId) =>
      call(async (): Promise<MediaPayload> => {
        const entity = await entityFor(chatId);
        const message = await fetchMessage(entity, messageId);
        const media = message?.media;
        if (!message || !media) {
          throw new TelegramError('rejected', 'The message has no media');
        }
        const bytes = toBytes(await client.downloadMedia(message, {}));
        if (!bytes) {
          throw new TelegramError('server', 'The media download was empty');
        }
        const document = media instanceof Api.MessageMediaDocument ? media.document : undefined;
        const mimetype =
          media instanceof Api.MessageMediaPhoto
            ? 'image/jpeg'
            : document instanceof Api.Document && document.mimeType
              ? document.mimeType
              : 'application/octet-stream';
        return {mimetype, bytes};
      }, MEDIA_TIMEOUT_MS),

    resolveDialog: dialog =>
      call(async () => {
        const found = await findDialogChat(dialog, chatId => entities.get(chatId), peer => client.getEntity(toPeer(peer)));
        if (found == null) {
          return null;
        }
        remember(found.entity);
        return found.chat;
      }),

    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async disconnect() {
      listeners.clear();
      client.removeEventHandler(handler, new Raw({}));
      await withTimeout(client.destroy(), 3000, 'Disconnecting').catch(() => undefined);
    },
  };
}
