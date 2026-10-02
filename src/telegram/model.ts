// The app's chat model. Both the Telegram client (GramJS) and the demo client
// produce these shapes, so the screens never see MTProto objects.

export type ContentKind =
  | 'text'
  | 'photo'
  | 'video'
  | 'audio'
  | 'sticker'
  | 'document'
  | 'location'
  | 'contact'
  | 'poll'
  | 'deleted'
  | 'unsupported';

export type MessageContent = {
  kind: ContentKind;
  /** Body for text, caption/title/name for media markers. */
  text: string;
  /** Audio: length in seconds, when known. */
  seconds?: number;
  /** Audio: a voice note (recorded message) rather than an audio file such as music. */
  voice?: boolean;
};

export type ReactionSummary = {
  /** Emoji as Telegram sends it (e.g. "❤" without the variation selector). */
  emoji: string;
  count: number;
  /** You reacted with this emoji. */
  mine: boolean;
};

/** Someone else's recent reaction to one of your messages (drives the list preview). */
export type RecentReaction = {emoji: string; senderName: string | null; unread: boolean};

export type ChatMessage = {
  /** Telegram message id within the chat, as a string. */
  id: string;
  chatId: string;
  fromMe: boolean;
  /** Sender name for incoming messages (shown in groups). */
  senderName: string | null;
  /** Epoch milliseconds. */
  timestamp: number;
  content: MessageContent;
  reactions?: ReactionSummary[];
  /** Newest reaction by someone else, when the server reports it. */
  recentReaction?: RecentReaction;
  pending?: boolean;
};

export type Chat = {
  /** Marked peer id (users positive, basic groups negative, channels -100…), as a string. */
  id: string;
  /** Null when no name is known (deleted account, hidden number). */
  name: string | null;
  isGroup: boolean;
  /** Phone number in international form when the contact shares it, for unnamed chats. */
  phone?: string;
  unreadCount: number;
  lastMessage: ChatMessage | null;
  /** Epoch milliseconds of the latest activity, when known. */
  timestamp: number | null;
  /** The chat has a profile photo to download. */
  hasPhoto: boolean;
  /** Changes when the photo changes (cache key). */
  photoKey?: string;
};

/** Reactions the chat accepts. `all`: any standard emoji reaction. */
export type AllowedReactions = {kind: 'all'} | {kind: 'some'; emojis: string[]} | {kind: 'none'};
