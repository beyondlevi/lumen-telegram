// Converts GramJS/MTProto objects into the app model. Inputs are read by
// `className` and field names only, so this module does not import GramJS and
// unit tests can pass plain objects (or real `Api.*` instances).
import type {Chat, ChatMessage, MessageContent, ReactionSummary, RecentReaction} from './model';

/** Any TL object as GramJS exposes it. */
export type Tl = {className?: string; [key: string]: any};

const VARIATION_SELECTOR = /️/g;

/** Telegram sends some emoji without the variation selector (❤ for ❤️); compare without it. */
export function sameEmoji(a: string, b: string): boolean {
  return a.replace(VARIATION_SELECTOR, '') === b.replace(VARIATION_SELECTOR, '');
}

/** Emoji for display: adds the variation selector to ❤ so it renders as the emoji. */
export function displayEmoji(emoji: string): string {
  return emoji === '❤' ? '❤️' : emoji;
}

function idString(value: unknown): string {
  return value == null ? '' : String(value);
}

/** Name of a user, chat or channel entity; null for deleted or nameless accounts. */
export function entityName(value: object | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const entity = value as Tl;
  if (entity.className === 'User') {
    if (entity.deleted) {
      return null;
    }
    const name = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim();
    return name || null;
  }
  const title = typeof entity.title === 'string' ? entity.title.trim() : '';
  return title || null;
}

function attribute(document: Tl, className: string): Tl | undefined {
  return (document.attributes as Tl[] | undefined)?.find(item => item.className === className);
}

function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  // Newer layers wrap poll questions in TextWithEntities.
  if (value && typeof value === 'object' && typeof (value as Tl).text === 'string') {
    return (value as Tl).text;
  }
  return '';
}

/** Kind and text of a message; null for messages that are not chat content. */
export function messageContent(value: object): MessageContent | null {
  const message = value as Tl;
  if (message.className === 'MessageService' || message.className === 'MessageEmpty') {
    return null;
  }
  const text = typeof message.message === 'string' ? message.message : '';
  const media = message.media as Tl | undefined;
  if (!media || media.className === 'MessageMediaEmpty' || media.className === 'MessageMediaWebPage') {
    return text ? {kind: 'text', text} : {kind: 'unsupported', text: ''};
  }
  switch (media.className) {
    case 'MessageMediaPhoto':
      return {kind: 'photo', text};
    case 'MessageMediaDocument': {
      const document = media.document as Tl | undefined;
      if (!document || document.className !== 'Document') {
        return {kind: 'document', text};
      }
      const sticker = attribute(document, 'DocumentAttributeSticker');
      if (sticker) {
        return {kind: 'sticker', text: typeof sticker.alt === 'string' ? sticker.alt : ''};
      }
      const audio = attribute(document, 'DocumentAttributeAudio');
      const mimeType = typeof document.mimeType === 'string' ? document.mimeType : '';
      // Voice notes and audio files (music, an .ogg sent as a file) both play as an audio bubble.
      if (audio || media.voice || (mimeType.startsWith('audio/') && !attribute(document, 'DocumentAttributeVideo'))) {
        const seconds = typeof audio?.duration === 'number' && audio.duration > 0 ? audio.duration : undefined;
        const voice = audio?.voice === true || media.voice === true;
        return {kind: 'audio', text, ...(seconds ? {seconds} : {}), voice};
      }
      if (attribute(document, 'DocumentAttributeVideo') || attribute(document, 'DocumentAttributeAnimated') || media.video || media.round) {
        return {kind: 'video', text};
      }
      const file = attribute(document, 'DocumentAttributeFilename');
      return {kind: 'document', text: text || (typeof file?.fileName === 'string' ? file.fileName : '')};
    }
    case 'MessageMediaGeo':
    case 'MessageMediaGeoLive':
      return {kind: 'location', text};
    case 'MessageMediaVenue':
      return {kind: 'location', text: typeof media.title === 'string' ? media.title : ''};
    case 'MessageMediaContact':
      return {kind: 'contact', text: [media.firstName, media.lastName].filter(Boolean).join(' ')};
    case 'MessageMediaPoll':
      return {kind: 'poll', text: textOf(media.poll?.question)};
    default:
      return text ? {kind: 'text', text} : {kind: 'unsupported', text: ''};
  }
}

/** Emoji reactions of a message (custom-emoji and paid reactions are left out). */
export function reactionsOf(value: object): ReactionSummary[] | undefined {
  const results = (value as Tl).reactions?.results as Tl[] | undefined;
  if (!results?.length) {
    return undefined;
  }
  const summaries: ReactionSummary[] = [];
  for (const result of results) {
    const reaction = result.reaction as Tl | undefined;
    if (reaction?.className !== 'ReactionEmoji' || typeof reaction.emoticon !== 'string' || !(result.count > 0)) {
      continue;
    }
    summaries.push({emoji: reaction.emoticon, count: result.count, mine: typeof result.chosenOrder === 'number'});
  }
  return summaries.length ? summaries : undefined;
}

/** Newest reaction by someone else (Telegram lists recent reactions newest first). */
export function recentReactionOf(value: object, names: (peer: Tl) => string | null): RecentReaction | undefined {
  const recent = (value as Tl).reactions?.recentReactions as Tl[] | undefined;
  const other = recent?.find(item => !item.my && item.reaction?.className === 'ReactionEmoji');
  if (!other) {
    return undefined;
  }
  return {emoji: other.reaction.emoticon, senderName: names(other.peerId), unread: other.unread === true};
}

export type ConvertContext = {
  /** Marked id of the chat the message belongs to. */
  chatId: string;
  /** Name of the message's sender (GramJS resolves `message.sender` from the entities it fetched). */
  senderName?: (message: Tl) => string | null;
  peerName?: (peer: Tl) => string | null;
};

export function toMessage(value: object | null | undefined, context: ConvertContext): ChatMessage | null {
  const message = value as Tl | null | undefined;
  if (!message || typeof message.id !== 'number') {
    return null;
  }
  const content = messageContent(message);
  if (!content) {
    return null;
  }
  const fromMe = message.out === true;
  const reactions = reactionsOf(message);
  const recentReaction = fromMe ? recentReactionOf(message, context.peerName ?? (() => null)) : undefined;
  return {
    id: String(message.id),
    chatId: context.chatId,
    fromMe,
    senderName: fromMe ? null : context.senderName?.(message) ?? entityName(message.sender) ?? null,
    timestamp: typeof message.date === 'number' ? message.date * 1000 : Date.now(),
    content,
    ...(reactions ? {reactions} : {}),
    ...(recentReaction ? {recentReaction} : {}),
  };
}

function hasPhoto(entity: Tl | undefined): {hasPhoto: boolean; photoKey?: string} {
  const photo = entity?.photo as Tl | undefined;
  if (!photo || photo.className === 'UserProfilePhotoEmpty' || photo.className === 'ChatPhotoEmpty') {
    return {hasPhoto: false};
  }
  return {hasPhoto: true, photoKey: idString(photo.photoId)};
}

/**
 * A user, basic group or channel entity as a chat with no messages yet (a
 * conversation opened from a notification that is not in the loaded list);
 * null for entities that cannot be opened (empty, forbidden, deactivated).
 */
export function entityChat(value: object | null | undefined, id: string): Chat | null {
  const entity = value as Tl | null | undefined;
  const openable =
    entity?.className === 'User' || entity?.className === 'Channel' || (entity?.className === 'Chat' && !entity.deactivated);
  if (!entity || !openable || !id) {
    return null;
  }
  const name = entityName(entity);
  const phone = entity.className === 'User' && typeof entity.phone === 'string' && entity.phone ? `+${entity.phone}` : undefined;
  return {
    id,
    name,
    isGroup: entity.className === 'Chat' || (entity.className === 'Channel' && entity.megagroup === true),
    ...(phone && !name ? {phone} : {}),
    unreadCount: 0,
    lastMessage: null,
    timestamp: null,
    ...hasPhoto(entity),
  };
}

/** A GramJS `Dialog` (from client.getDialogs) as a chat row. */
export function toChat(value: object, peerName?: (peer: Tl) => string | null): Chat | null {
  const dialog = value as Tl;
  const id = idString(dialog.id);
  if (!id) {
    return null;
  }
  const entity = dialog.entity as Tl | undefined;
  const lastMessage = toMessage(dialog.message, {chatId: id, peerName});
  const name = entityName(entity) ?? (typeof dialog.title === 'string' && dialog.title.trim() ? dialog.title.trim() : null);
  const phone = entity?.className === 'User' && typeof entity.phone === 'string' && entity.phone ? `+${entity.phone}` : undefined;
  const unread = (typeof dialog.unreadCount === 'number' ? dialog.unreadCount : 0) || (dialog.dialog?.unreadMark ? 1 : 0);
  const timestamp = lastMessage?.timestamp ?? (typeof dialog.date === 'number' && dialog.date > 0 ? dialog.date * 1000 : null);
  return {
    id,
    name,
    isGroup: dialog.isGroup === true,
    ...(phone && !name ? {phone} : {}),
    unreadCount: unread,
    lastMessage,
    timestamp,
    ...hasPhoto(entity),
  };
}
