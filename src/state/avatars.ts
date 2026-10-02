// Profile photos, downloaded on demand (two at a time) for the chats on screen
// and kept in memory for the session, keyed by photo so a changed photo is
// fetched again. A photo is shown only after it has loaded, so a missing or
// broken one keeps the initials. Photos are never written to storage.
import type {ChatApi} from '../telegram/api';
import {toObjectUrl} from './media';

export type AvatarLoader = {
  /** Loaded photo URL, or null while loading / when there is none. */
  get(chatId: string): string | null;
  /** Starts loading once per chat and photo. */
  request(chatId: string, photoKey: string | undefined): void;
  dispose(): void;
};

const MAX_DOWNLOADS = 2;

function preload(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.decoding = 'async';
    image.src = url;
  });
}

export function createAvatarLoader(api: ChatApi, onChange: () => void): AvatarLoader {
  const loaded = new Map<string, string | null>();
  const started = new Map<string, string>();
  const objectUrls: string[] = [];
  const queue: string[] = [];
  let active = 0;
  let disposed = false;

  const download = async (chatId: string) => {
    const payload = await api.getProfilePhoto(chatId);
    if (!payload || disposed) {
      return null;
    }
    const url = await toObjectUrl(payload);
    objectUrls.push(url);
    return (await preload(url)) ? url : null;
  };

  const pump = () => {
    while (active < MAX_DOWNLOADS && queue.length > 0 && !disposed) {
      const chatId = queue.shift() as string;
      active += 1;
      download(chatId)
        .then(url => {
          if (disposed) {
            return;
          }
          loaded.set(chatId, url);
          if (url) {
            onChange();
          }
        })
        .catch(() => {
          // Offline or refused: try again when the chat is requested next time.
          started.delete(chatId);
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return {
    get: chatId => loaded.get(chatId) ?? null,
    request(chatId, photoKey) {
      if (disposed || !photoKey || started.get(chatId) === photoKey) {
        return;
      }
      started.set(chatId, photoKey);
      queue.push(chatId);
      pump();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    },
  };
}
