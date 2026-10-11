// Which of a Telegram photo's sizes to download. Telegram keeps each photo in
// several sizes (core.telegram.org/api/files, "PhotoSize.type values"): 's'
// fits 100 x 100, 'm' 320 x 320, 'x' 800 x 800, 'y' 1280 x 1280, 'w'
// 2560 x 2560, plus 'i', a stripped thumbnail of a few dozen pixels that
// comes inside the message, and 'j', a vector outline. Read by className and
// field names only, so this module does not import GramJS.
import type {Tl} from './convert';

/** Sizes that are downloaded from Telegram and have their pixel size (w, h). */
const DOWNLOADABLE = new Set(['PhotoSize', 'PhotoSizeProgressive']);

/**
 * Index in `sizes` of the size to download to show the photo `side` pixels
 * on its longest side: the smallest one at least that large, else the
 * largest; -1 when there is none to download.
 */
export function photoSizeFor(sizes: readonly object[], side: number): number {
  let fitting = -1;
  let largest = -1;
  const longest = (index: number) => {
    const size = sizes[index] as Tl;
    return Math.max(Number(size.w) || 0, Number(size.h) || 0);
  };
  sizes.forEach((value, index) => {
    const size = value as Tl;
    if (!DOWNLOADABLE.has(size.className ?? '') || longest(index) <= 0) {
      return;
    }
    if (largest < 0 || longest(index) > longest(largest)) {
      largest = index;
    }
    if (longest(index) >= side && (fitting < 0 || longest(index) < longest(fitting))) {
      fitting = index;
    }
  });
  return fitting >= 0 ? fitting : largest;
}
