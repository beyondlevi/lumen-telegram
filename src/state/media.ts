// Photo and voice-message media, downloaded only when opened or played and
// kept in memory for the session (a few items; never stored).
import {TelegramError, type ChatApi, type MediaPayload} from '../telegram/api';
import type {ChatMessage} from '../telegram/model';

export type LoadedMedia = {src: string; mimetype: string};

export type MediaLoader = {
  load(message: ChatMessage): Promise<LoadedMedia>;
  /** Keeps audio you just recorded, so playing your own voice note needs no download. */
  prime(message: Pick<ChatMessage, 'chatId' | 'id'>, blob: Blob, mimetype: string): void;
  dispose(): void;
};

const MAX_ITEMS = 6;

/**
 * Turns the payload into an object URL typed with the media's mimetype, so
 * playback does not depend on how the host labels files (demo media is read
 * from the package itself).
 */
export async function toObjectUrl(payload: MediaPayload): Promise<string> {
  const type = payload.mimetype.split(';')[0];
  if (payload.url) {
    const response = await fetch(payload.url);
    if (!response.ok) {
      throw new TelegramError('server', `HTTP ${response.status}`);
    }
    return URL.createObjectURL(new Blob([await response.arrayBuffer()], {type}));
  }
  const bytes = payload.bytes ?? new Uint8Array();
  return URL.createObjectURL(new Blob([bytes as BlobPart], {type}));
}

/** True when this browser's <audio> can decode the type (Telegram voice notes are OGG/Opus). */
export function canPlayAudio(mimetype: string): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  return document.createElement('audio').canPlayType(mimetype) !== '';
}

export function createMediaLoader(api: ChatApi): MediaLoader {
  const items = new Map<string, Promise<LoadedMedia>>();
  const objectUrls = new Map<string, string>();

  const fetchMedia = async (message: ChatMessage): Promise<LoadedMedia> => {
    const payload = await api.getMedia(message.chatId, message.id);
    let mimetype = payload.mimetype;
    if (message.content.kind === 'audio') {
      // Voice notes come as audio/ogg; say Opus so canPlayType answers for the codec.
      if (/^audio\/ogg$/i.test(mimetype)) {
        mimetype = 'audio/ogg; codecs=opus';
      }
      if (!canPlayAudio(mimetype)) {
        throw new TelegramError('rejected', `Cannot play ${mimetype}`, 'MEDIA_FORMAT');
      }
    }
    const src = await toObjectUrl({...payload, mimetype});
    objectUrls.set(`${message.chatId}:${message.id}`, src);
    return {src, mimetype};
  };

  return {
    load(message) {
      const key = `${message.chatId}:${message.id}`;
      const existing = items.get(key);
      if (existing) {
        items.delete(key);
        items.set(key, existing);
        return existing;
      }
      const pending = fetchMedia(message);
      items.set(key, pending);
      pending.catch(() => items.delete(key));
      while (items.size > MAX_ITEMS) {
        const oldest = items.keys().next().value as string;
        items.delete(oldest);
        const url = objectUrls.get(oldest);
        if (url) {
          URL.revokeObjectURL(url);
          objectUrls.delete(oldest);
        }
      }
      return pending;
    },
    prime(message, blob, mimetype) {
      const key = `${message.chatId}:${message.id}`;
      const src = URL.createObjectURL(blob);
      objectUrls.set(key, src);
      items.set(key, Promise.resolve({src, mimetype}));
    },
    dispose() {
      for (const url of objectUrls.values()) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
      items.clear();
    },
  };
}
