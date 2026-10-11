import {describe, expect, it} from 'vitest';
import {fitInside, MAX_BYTES, MAX_SIDE, reducedSize, THUMBNAIL_SIDE} from '../../src/photo/capturedPhoto';
import {isPhotoSendState} from '../../src/photo/sendState';

describe('photos taken with the camera', () => {
  it("sends Lumen's capture (a JPEG of 1200 x 1600, about 300 KB) as it is", () => {
    expect(reducedSize(1200, 1600, 300_000, 'image/jpeg')).toBeNull();
    expect(reducedSize(MAX_SIDE, 1200, MAX_BYTES, 'image/jpeg')).toBeNull();
  });

  it('reduces a larger, heavier or non-JPEG photo to fit MAX_SIDE, keeping its shape', () => {
    expect(reducedSize(2400, 3200, 2_000_000, 'image/jpeg')).toEqual({width: 1200, height: 1600});
    expect(reducedSize(1200, 1600, MAX_BYTES + 1, 'image/jpeg')).toEqual({width: 1200, height: 1600});
    expect(reducedSize(4000, 3000, 900_000, 'image/jpeg')).toEqual({width: 1600, height: 1200});
    expect(reducedSize(800, 600, 50_000, 'image/png')).toEqual({width: 800, height: 600});
  });

  it('fits a thumbnail inside its side, never scaling up', () => {
    expect(fitInside(1200, 1600, THUMBNAIL_SIDE)).toEqual({width: 240, height: THUMBNAIL_SIDE});
    expect(fitInside(100, 50, THUMBNAIL_SIDE)).toEqual({width: 100, height: 50});
  });

  it('knows the history entry of the send screen', () => {
    expect(isPhotoSendState({photoSend: true})).toBe(true);
    expect(isPhotoSendState({replyComposer: true})).toBe(false);
    expect(isPhotoSendState(null)).toBe(false);
  });
});
