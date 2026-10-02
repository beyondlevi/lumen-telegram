import type {AllowedReactions, Chat, ChatMessage} from './model';

export type TelegramErrorKind =
  /** No connection to Telegram (offline, DNS, TLS, proxy, timeout). */
  | 'network'
  /** The session or API ID/hash was refused; a new session is needed. */
  | 'auth'
  /** Telegram refused this request (e.g. a reaction that is not allowed). */
  | 'rejected'
  /** Too many requests; `waitSeconds` says how long to wait. */
  | 'flood'
  /** Any other server error. */
  | 'server';

export class TelegramError extends Error {
  readonly kind: TelegramErrorKind;
  /** Telegram's error string, e.g. AUTH_KEY_UNREGISTERED. */
  readonly code: string | null;
  readonly waitSeconds: number | null;

  constructor(kind: TelegramErrorKind, message: string, code: string | null = null, waitSeconds: number | null = null) {
    super(message);
    this.name = 'TelegramError';
    this.kind = kind;
    this.code = code;
    this.waitSeconds = waitSeconds;
  }
}

export type VoiceNote = {bytes: Uint8Array; mimetype: string; durationMs: number; waveform?: Uint8Array};

/** Media of one message: bytes (Telegram) or a URL the app can load directly (demo). */
export type MediaPayload = {mimetype: string; bytes?: Uint8Array; url?: string};

export type ChatUpdate = {
  /** Chat touched by the update, when known; undefined means "something changed". */
  chatId?: string;
};

/** Everything the screens need from Telegram; implemented by the GramJS client and the demo client. */
export type ChatApi = {
  /** Most recent chats first. */
  getChats(limit: number): Promise<Chat[]>;
  /** Oldest first. */
  getMessages(chatId: string, limit: number): Promise<ChatMessage[]>;
  sendText(chatId: string, text: string, replyToId?: string): Promise<ChatMessage>;
  /** Sends a voice note (OGG/Opus) with its length and Telegram's 5-bit waveform. */
  sendVoice(chatId: string, voice: VoiceNote): Promise<ChatMessage>;
  /** Sets (or with null clears) your reaction; returns the message's new reactions. */
  sendReaction(chatId: string, messageId: string, emoji: string | null): Promise<ChatMessage['reactions']>;
  /** Marks everything up to `maxId` as read. */
  markRead(chatId: string, maxId: string): Promise<void>;
  allowedReactions(chatId: string): Promise<AllowedReactions>;
  /** Small profile photo of a chat, or null when there is none. */
  getProfilePhoto(chatId: string): Promise<MediaPayload | null>;
  /** Photo or voice message media. */
  getMedia(chatId: string, messageId: string): Promise<MediaPayload>;
  /** Push updates; returns the unsubscribe function. */
  onUpdate(callback: (update: ChatUpdate) => void): () => void;
  disconnect(): Promise<void>;
};

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
