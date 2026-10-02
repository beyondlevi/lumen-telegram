import {locale, t, type Locale, type StringKey} from './i18n/strings';
import {displayEmoji} from './telegram/convert';
import type {Chat, ChatMessage, MessageContent} from './telegram/model';

const MARKER_KEYS: Partial<Record<MessageContent['kind'], StringKey>> = {
  photo: 'markerPhoto',
  video: 'markerVideo',
  audio: 'markerAudio',
  sticker: 'markerSticker',
  document: 'markerDocument',
  location: 'markerLocation',
  contact: 'markerContact',
  poll: 'markerPoll',
  deleted: 'markerDeleted',
  unsupported: 'markerUnsupported',
};

/** A voice note, as opposed to an audio file (content cached by older versions has no flag: voice). */
export function isVoiceNote(content: MessageContent): boolean {
  return content.kind === 'audio' && content.voice !== false;
}

/** Text shown for a message: the body, or a marker such as "Photo: caption". */
export function describeContent(content: MessageContent): string {
  if (content.kind === 'text') {
    return content.text;
  }
  const marker = t(isVoiceNote(content) ? 'markerVoice' : MARKER_KEYS[content.kind] ?? 'markerUnsupported');
  return content.text ? t('markerWithCaption', {marker, caption: content.text}) : marker;
}

export function isMarker(content: MessageContent): boolean {
  return content.kind !== 'text';
}

export function chatDisplayName(chat: Pick<Chat, 'name' | 'phone'> | undefined): string {
  return chat?.name ?? chat?.phone ?? t('unknownContact');
}

const SNIPPET_LENGTH = 24;

/** Short quote of a message text, cut on a character boundary. */
export function snippet(text: string, length: number = SNIPPET_LENGTH): string {
  const chars = Array.from(text);
  return chars.length > length ? `${chars.slice(0, length - 1).join('').trimEnd()}…` : text;
}

function firstName(name: string): string {
  return name.split(' ')[0];
}

function messagePreview(chat: Chat, message: ChatMessage): string {
  const text = describeContent(message.content);
  if (message.fromMe) {
    return t('senderPrefix', {sender: t('you'), text});
  }
  if (chat.isGroup && message.senderName) {
    return t('senderPrefix', {sender: firstName(message.senderName), text});
  }
  return text;
}

/**
 * List preview: the newest message. Telegram keeps reactions on the message
 * they react to, so a reaction is never previewed as a message; when someone
 * else's unread reaction is the newest thing on your last message, the row
 * reads "Reacted ❤️ to “…”" (with the sender's first name in a group).
 */
export function chatPreview(chat: Chat): string {
  const message = chat.lastMessage;
  if (!message) {
    return t('markerNoPreview');
  }
  const reaction = message.fromMe ? message.recentReaction : undefined;
  if (reaction?.unread) {
    const text = t('reactedTo', {emoji: displayEmoji(reaction.emoji), text: snippet(describeContent(message.content))});
    return chat.isGroup && reaction.senderName ? t('senderPrefix', {sender: firstName(reaction.senderName), text}) : text;
  }
  return messagePreview(chat, message);
}

/** "0:09", "1:05": a duration or position in minutes and seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function initials(name: string): string {
  const letters = name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => Array.from(part)[0] ?? '')
    .join('');
  return Array.from(letters).slice(0, 2).join('').toUpperCase();
}

type DateFormats = {time: Intl.DateTimeFormat; weekday: Intl.DateTimeFormat; date: Intl.DateTimeFormat};
const dateFormats = new Map<Locale, DateFormats>();

function formats(): DateFormats {
  let current = dateFormats.get(locale);
  if (current == null) {
    current = {
      time: new Intl.DateTimeFormat(locale, {hour: '2-digit', minute: '2-digit'}),
      weekday: new Intl.DateTimeFormat(locale, {weekday: 'short'}),
      date: new Intl.DateTimeFormat(locale, {day: '2-digit', month: '2-digit'}),
    };
    dateFormats.set(locale, current);
  }
  return current;
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** One representation per row: time today, "Yesterday", weekday this week, else day/month. */
export function formatListTime(ms: number | null, now: number = Date.now()): string | undefined {
  if (ms == null) {
    return undefined;
  }
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
  const {time, weekday, date} = formats();
  if (days <= 0) {
    return time.format(ms);
  }
  if (days === 1) {
    return t('yesterday');
  }
  if (days < 7) {
    return weekday.format(ms);
  }
  return date.format(ms);
}

export function formatBubbleTime(ms: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86400000);
  const {time: timeFormat, weekday, date} = formats();
  const time = timeFormat.format(ms);
  if (days <= 0) {
    return time;
  }
  const day = days === 1 ? t('yesterday') : days < 7 ? weekday.format(ms) : date.format(ms);
  return `${day} ${time}`;
}

/** Messages from the same sender within five minutes share one timestamp. */
export function endsMessageRun(messages: ChatMessage[], index: number): boolean {
  const current = messages[index];
  const next = messages[index + 1];
  if (!next) {
    return true;
  }
  return (
    next.fromMe !== current.fromMe ||
    next.senderName !== current.senderName ||
    next.timestamp - current.timestamp > 5 * 60000
  );
}

export function startsMessageRun(messages: ChatMessage[], index: number): boolean {
  return index === 0 || endsMessageRun(messages, index - 1);
}
