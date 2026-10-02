// Demo mode stand-in for the Telegram client. Serves the fictional chats in
// demoData through the same ChatApi the screens use with Telegram, so the
// same screens run. Never opens a connection and never touches storage: every
// launch starts from the same chats. Pictures and the voice note are files
// inside the package; the app loads them like any other image/audio.

import {TelegramError, type ChatApi, type ChatUpdate, type MediaPayload} from '../telegram/api';
import {sameEmoji} from '../telegram/convert';
import {withMyReaction} from '../telegram/reactions';
import type {AllowedReactions, Chat, ChatMessage} from '../telegram/model';
import voiceNote from './assets/voice-note.ogg';
import {DEMO_DAY_END, DEMO_STANDARD_REACTIONS, demoChats, type DemoChat, type DemoMessage} from './demoData';

/** Time the "Sending" state stays on screen. */
const SEND_DELAY_MS = 600;
/** Delay before a chat's scripted answer to your first reply. */
const AUTO_REPLY_DELAY_MS = 2500;
/** Time the photo/voice "download" spinner stays on screen. */
const MEDIA_DELAY_MS = 700;

type StoredMessage = Omit<DemoMessage, 'daysAgo' | 'time'> & {timestamp: number};
type StoredChat = Omit<DemoChat, 'messages'> & {messages: StoredMessage[]; autoReplied: boolean};

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Epoch milliseconds of `HH:MM` on the day `daysAgo` days before today. */
function demoTime(daysAgo: number, time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/** Absolute URL of a packaged asset (data URIs stay as they are). */
function assetUrl(url: string): string {
  return typeof location === 'undefined' ? url : new URL(url, location.href).href;
}

export function createDemoClient(): ChatApi {
  const chats: StoredChat[] = demoChats().map(chat => ({
    ...chat,
    autoReplied: false,
    messages: chat.messages.map(({daysAgo, time, ...rest}) => ({...rest, timestamp: demoTime(daysAgo, time)})),
  }));
  const launchedAt = Date.now();
  const dayEnd = demoTime(0, DEMO_DAY_END);
  const listeners = new Set<(update: ChatUpdate) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let nextId = 5000;

  /** Demo clock: 09:41 at launch, then running with real time. */
  const now = () => dayEnd + (Date.now() - launchedAt);
  const chatFor = (chatId: string) => {
    const chat = chats.find(item => item.id === chatId);
    if (!chat) {
      throw new TelegramError('rejected', 'Unknown chat', 'PEER_ID_INVALID');
    }
    return chat;
  };
  const toModel = (chat: StoredChat, message: StoredMessage): ChatMessage => ({
    id: message.id,
    chatId: chat.id,
    fromMe: message.fromMe,
    senderName: message.senderName,
    timestamp: message.timestamp,
    content: {...message.content},
    ...(message.reactions ? {reactions: message.reactions.map(item => ({...item}))} : {}),
    ...(message.recentReaction ? {recentReaction: {...message.recentReaction}} : {}),
  });
  const add = (chat: StoredChat, message: Omit<StoredMessage, 'id' | 'timestamp'>) => {
    nextId += 1;
    const stored: StoredMessage = {...message, id: String(nextId), timestamp: now()};
    chat.messages.push(stored);
    return stored;
  };
  const notify = (chatId: string) => {
    for (const listener of listeners) {
      listener({chatId});
    }
  };
  const allowedFor = (chat: StoredChat): AllowedReactions =>
    chat.allowed ?? {kind: 'some', emojis: DEMO_STANDARD_REACTIONS};

  return {
    async getChats(limit) {
      return chats
        .map((chat): Chat => {
          const last = chat.messages[chat.messages.length - 1];
          return {
            id: chat.id,
            name: chat.name ?? null,
            ...(chat.phone ? {phone: chat.phone} : {}),
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            lastMessage: last ? toModel(chat, last) : null,
            timestamp: last?.timestamp ?? null,
            hasPhoto: chat.avatar != null,
            ...(chat.avatar ? {photoKey: `demo-${chat.id}`} : {}),
          };
        })
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
        .slice(0, limit);
    },

    async getMessages(chatId, limit) {
      const chat = chatFor(chatId);
      return chat.messages.slice(-limit).map(message => toModel(chat, message));
    },

    async sendVoice(chatId, voice) {
      await wait(SEND_DELAY_MS);
      const chat = chatFor(chatId);
      // The demo "recording" is the packaged voice note.
      const sent = add(chat, {
        fromMe: true,
        senderName: null,
        content: {kind: 'audio', text: '', seconds: Math.max(1, Math.round(voice.durationMs / 1000)), voice: true},
        media: {url: voiceNote, mimetype: 'audio/ogg'},
      });
      return toModel(chat, sent);
    },

    async sendText(chatId, value) {
      await wait(SEND_DELAY_MS);
      const chat = chatFor(chatId);
      const sent = add(chat, {fromMe: true, senderName: null, content: {kind: 'text', text: value}});
      if (chat.autoReply && !chat.autoReplied) {
        chat.autoReplied = true;
        const answer = chat.autoReply;
        const timer = setTimeout(() => {
          timers.delete(timer);
          add(chat, {fromMe: false, senderName: chat.name ?? null, content: {kind: 'text', text: answer}});
          chat.unreadCount += 1;
          notify(chat.id);
        }, AUTO_REPLY_DELAY_MS);
        timers.add(timer);
      }
      return toModel(chat, sent);
    },

    async sendReaction(chatId, messageId, emoji) {
      await wait(SEND_DELAY_MS / 2);
      const chat = chatFor(chatId);
      const allowed = allowedFor(chat);
      if (emoji && (allowed.kind === 'none' || (allowed.kind === 'some' && !allowed.emojis.some(item => sameEmoji(item, emoji))))) {
        throw new TelegramError('rejected', 'Reaction not allowed', 'REACTION_INVALID');
      }
      const message = chat.messages.find(item => item.id === messageId);
      if (!message) {
        throw new TelegramError('rejected', 'Unknown message', 'MESSAGE_ID_INVALID');
      }
      message.reactions = withMyReaction(message.reactions, emoji);
      return message.reactions?.map(item => ({...item}));
    },

    async markRead(chatId) {
      const chat = chatFor(chatId);
      chat.unreadCount = 0;
      for (const message of chat.messages) {
        if (message.recentReaction) {
          message.recentReaction = {...message.recentReaction, unread: false};
        }
      }
    },

    async allowedReactions(chatId) {
      return allowedFor(chatFor(chatId));
    },

    async getProfilePhoto(chatId) {
      const avatar = chatFor(chatId).avatar;
      return avatar ? {mimetype: 'image/webp', url: assetUrl(avatar)} : null;
    },

    async getMedia(chatId, messageId): Promise<MediaPayload> {
      await wait(MEDIA_DELAY_MS);
      const media = chatFor(chatId).messages.find(message => message.id === messageId)?.media;
      if (!media) {
        throw new TelegramError('rejected', 'The message has no media');
      }
      return {mimetype: media.mimetype, url: assetUrl(media.url)};
    },

    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async disconnect() {
      listeners.clear();
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
    },
  };
}
