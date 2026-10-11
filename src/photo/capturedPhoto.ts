// Photos taken with the glasses' camera. On Lumen a file input with
// accept="image/*" opens its capture screen, which hands the page a JPEG of
// 1200 x 1600 (about 300 KB); in a desktop browser it is a file picker.

/** A photo ready to be sent, with an object URL for its preview. */
export type CapturedPhoto = {blob: Blob; url: string; width: number; height: number};

/** A photo goes over the phone's internet: one larger than this on its longest side, or heavier, is reduced first. */
export const MAX_SIDE = 1600;
export const MAX_BYTES = 1_000_000;
const REDUCED_QUALITY = 0.85;
/** Longest side of the thumbnail in a sent photo's bubble. */
export const THUMBNAIL_SIDE = 320;
const THUMBNAIL_QUALITY = 0.8;

/** `width` x `height` scaled down to fit `side` on its longest side (never up). */
export function fitInside(width: number, height: number, side: number): {width: number; height: number} {
  const scale = Math.min(1, side / Math.max(width, height, 1));
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale))};
}

/** The size to reduce a photo to before sending, or null to send it as it is (a JPEG within MAX_SIDE and MAX_BYTES). */
export function reducedSize(width: number, height: number, bytes: number, type: string): {width: number; height: number} | null {
  if (Math.max(width, height) <= MAX_SIDE && bytes <= MAX_BYTES && type === 'image/jpeg') {
    return null;
  }
  return fitInside(width, height, MAX_SIDE);
}

function drawJpeg(image: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context == null) {
    return Promise.reject(new Error('No 2D canvas'));
  }
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))), 'image/jpeg', quality),
  );
}

/** Reads a photo from the capture: its size (EXIF orientation applied), and an object URL for the preview. */
export async function readPhoto(file: Blob): Promise<CapturedPhoto> {
  const bitmap = await createImageBitmap(file);
  const {width, height} = bitmap;
  bitmap.close();
  return {blob: file, url: URL.createObjectURL(file), width, height};
}

/** The photo to send: as taken, or reduced (see reducedSize). */
export async function photoToSend(photo: CapturedPhoto): Promise<Blob> {
  const size = reducedSize(photo.width, photo.height, photo.blob.size, photo.blob.type);
  if (size == null) {
    return photo.blob;
  }
  const bitmap = await createImageBitmap(photo.blob);
  try {
    return await drawJpeg(bitmap, size.width, size.height, REDUCED_QUALITY);
  } finally {
    bitmap.close();
  }
}

/** A small JPEG of the photo for its bubble, as an object URL. */
export async function photoThumbnail(photo: CapturedPhoto): Promise<string> {
  const size = fitInside(photo.width, photo.height, THUMBNAIL_SIDE);
  const bitmap = await createImageBitmap(photo.blob);
  try {
    return URL.createObjectURL(await drawJpeg(bitmap, size.width, size.height, THUMBNAIL_QUALITY));
  } finally {
    bitmap.close();
  }
}
