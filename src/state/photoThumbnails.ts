// Thumbnails of the photos in a conversation. Telegram keeps each photo in
// several sizes; the one that fits 320 x 320 ('m') is downloaded for the
// bubbles that are rendered, two at a time, once per photo, and kept as an
// object URL; the oldest are released. Until it arrives, the bubble shows the
// tiny preview that came with the message (or an icon).
import type {ChatMessage} from '../telegram/model';

/** Thumbnails kept: more than a conversation loads (30 messages), so the rendered ones are never dropped. */
export const KEPT_THUMBNAILS = 40;
/** Downloads at a time. */
export const THUMBNAIL_DOWNLOADS = 2;

export type ThumbnailLoader = {
  /** The downloaded thumbnail, or null (not yet, or it failed). */
  get(message: ChatMessage): string | null;
  /** Downloads the thumbnail of a photo, once. */
  request(message: ChatMessage): void;
  dispose(): void;
};

const keyOf = (message: ChatMessage) => `${message.chatId}:${message.id}`;

/** The preview that came with a photo message (a few dozen pixels), as a data URL. */
export function messagePreview(message: ChatMessage): string | null {
  return message.content.preview ? `data:image/jpeg;base64,${message.content.preview}` : null;
}

export function createThumbnailLoader(download: (message: ChatMessage) => Promise<Blob>, onChange: () => void): ThumbnailLoader {
  // Insertion order is the recency order: the first one is the next to go.
  const made = new Map<string, string>();
  const tried = new Set<string>();
  const queue: ChatMessage[] = [];
  let running = 0;
  let disposed = false;

  const keep = (key: string, url: string) => {
    made.set(key, url);
    while (made.size > KEPT_THUMBNAILS) {
      const [oldest, oldUrl] = made.entries().next().value as [string, string];
      made.delete(oldest);
      URL.revokeObjectURL(oldUrl);
      // Its bubble may come back later: it is downloaded again then.
      tried.delete(oldest);
    }
  };

  const pump = () => {
    while (!disposed && running < THUMBNAIL_DOWNLOADS && queue.length > 0) {
      const message = queue.shift() as ChatMessage;
      running += 1;
      download(message)
        .then(
          blob => {
            if (!disposed) {
              keep(keyOf(message), URL.createObjectURL(blob));
              onChange();
            }
          },
          () => undefined, // No thumbnail: the bubble keeps its preview or icon.
        )
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  return {
    get(message) {
      const key = keyOf(message);
      const url = made.get(key);
      if (url != null) {
        // Seen again: the most recent now.
        made.delete(key);
        made.set(key, url);
      }
      return url ?? null;
    },
    request(message) {
      const key = keyOf(message);
      if (disposed || message.pending || tried.has(key) || made.has(key)) {
        return;
      }
      tried.add(key);
      queue.push(message);
      pump();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      for (const url of made.values()) {
        URL.revokeObjectURL(url);
      }
      made.clear();
    },
  };
}
