import {Buffer} from 'buffer';
import bigInt from 'big-integer';
import {Api, TelegramClient, utils} from 'telegram';
import {StringSession} from 'telegram/sessions';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {messageContent} from '../../src/telegram/convert';
import {downloadPhotoSize, withPreview} from '../../src/telegram/gramClient';
import {photoSizeFor} from '../../src/telegram/photoSizes';
import type {ChatMessage} from '../../src/telegram/model';
import {saveChatCache, withoutPreview} from '../../src/state/chatCache';
import {createThumbnailLoader, KEPT_THUMBNAILS, messagePreview, THUMBNAIL_DOWNLOADS} from '../../src/state/photoThumbnails';

// A stripped size as Telegram sends it: 0x01, height, width, then the JPEG body without its header.
const STRIPPED = Buffer.from([1, 30, 40, 0x11, 0x22, 0x33, 0x44]);

/** A photo as Telegram describes it: the stripped preview, sizes m and x, and a progressive y. */
function telegramPhoto(portrait = false): Api.Photo {
  const [w, h] = portrait ? [3, 4] : [4, 3];
  return new Api.Photo({
    id: bigInt(5001),
    accessHash: bigInt(77),
    fileReference: Buffer.from([9, 9]),
    date: 1790000000,
    dcId: 2,
    sizes: [
      new Api.PhotoStrippedSize({type: 'i', bytes: STRIPPED}),
      new Api.PhotoSize({type: 'm', w: 80 * w, h: 80 * h, size: 21000}),
      new Api.PhotoSize({type: 'x', w: 200 * w, h: 200 * h, size: 88000}),
      new Api.PhotoSizeProgressive({type: 'y', w: 320 * w, h: 320 * h, sizes: [9000, 40000, 160000]}),
    ],
  });
}

function photoMessage(photo = telegramPhoto(), caption = 'Olha isso'): Api.Message {
  return new Api.Message({
    id: 31,
    peerId: new Api.PeerUser({userId: bigInt(42)}),
    date: 1790000000,
    message: caption,
    media: new Api.MessageMediaPhoto({photo}),
  });
}

const model = (extra: Partial<ChatMessage['content']> = {}): ChatMessage => ({
  id: '31',
  chatId: '42',
  fromMe: false,
  senderName: 'Bruno',
  timestamp: 0,
  content: {kind: 'photo', text: 'Olha isso', ...extra},
});

describe('photoSizeFor (which of Telegram sizes to download)', () => {
  const sizes = telegramPhoto().sizes;

  it('takes the smallest size that covers the side: m (320) for a thumbnail, x (800) for the photo in full', () => {
    expect(sizes[photoSizeFor(sizes, 320)]).toMatchObject({type: 'm'});
    expect(sizes[photoSizeFor(sizes, 600)]).toMatchObject({type: 'x'});
  });

  it('takes the largest when none covers it, and never the stripped or path sizes', () => {
    expect(sizes[photoSizeFor(sizes, 4000)]).toMatchObject({type: 'y'});
    const inline = [new Api.PhotoStrippedSize({type: 'i', bytes: STRIPPED}), new Api.PhotoPathSize({type: 'j', bytes: Buffer.from([1])})];
    expect(photoSizeFor(inline, 320)).toBe(-1);
  });

  it('measures the longest side (a portrait photo)', () => {
    const portrait = telegramPhoto(true).sizes;
    expect(sizes[photoSizeFor(portrait, 320)]).toMatchObject({type: 'm'});
    expect(portrait[photoSizeFor(portrait, 320)]).toMatchObject({w: 240, h: 320});
  });

  it('takes s (100) over nothing for an old photo without m', () => {
    const old = [new Api.PhotoSize({type: 's', w: 100, h: 75, size: 2000})];
    expect(photoSizeFor(old, 320)).toBe(0);
  });
});

describe('photo messages from GramJS', () => {
  it('give the photo size of its largest size', () => {
    expect(messageContent(photoMessage())).toEqual({kind: 'photo', text: 'Olha isso', width: 1280, height: 960});
  });

  it('carry the stripped size made a JPEG again as the preview, as GramJS does it', () => {
    const raw = photoMessage();
    const message = withPreview(model(), raw);
    expect(message.content.preview).toBe(utils.strippedPhotoToJpg(STRIPPED).toString('base64'));
    const jpeg = Buffer.from(message.content.preview ?? '', 'base64');
    expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...jpeg.subarray(-2)]).toEqual([0xff, 0xd9]);
    expect(messagePreview(message)).toBe(`data:image/jpeg;base64,${message.content.preview}`);
  });

  it('without a stripped size, have no preview', () => {
    const photo = telegramPhoto();
    photo.sizes = photo.sizes.filter(size => !(size instanceof Api.PhotoStrippedSize));
    expect(withPreview(model(), photoMessage(photo)).content.preview).toBeUndefined();
  });
});

describe('downloadPhotoSize (GramJS downloadMedia with the network replaced)', () => {
  /** A client whose file requests are recorded and answered with `bytes`. */
  function recordingClient(bytes: Buffer) {
    const client = new TelegramClient(new StringSession(''), 1, '0123456789abcdef0123456789abcdef', {});
    client.setLogLevel('none' as never);
    const requests: Api.upload.GetFile[] = [];
    Object.assign(client, {
      getSender: async (dcId: number) => ({dcId, isConnected: () => true}),
      invokeWithSender: async (request: Api.upload.GetFile) => {
        requests.push(request);
        return new Api.upload.File({type: new Api.storage.FileJpeg(), mtime: 0, bytes: request.offset.isZero() ? bytes : Buffer.alloc(0)});
      },
    });
    return {client, requests};
  }

  it('asks Telegram for the m size for a thumbnail and the x size for the photo in full', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const {client, requests} = recordingClient(jpeg);
    const thumbnail = await downloadPhotoSize(client, photoMessage(), 320);
    expect(thumbnail).toEqual(new Uint8Array(jpeg));
    const full = await downloadPhotoSize(client, photoMessage(), 600);
    expect(full).toEqual(new Uint8Array(jpeg));
    const locations = requests.map(request => request.location);
    expect(locations.every(location => location instanceof Api.InputPhotoFileLocation)).toBe(true);
    expect(locations.map(location => (location instanceof Api.InputPhotoFileLocation ? location.thumbSize : null))).toEqual(['m', 'x']);
    expect(locations[0]).toMatchObject({id: bigInt(5001), accessHash: bigInt(77)});
  });

  it('refuses a message without a photo', async () => {
    const {client} = recordingClient(Buffer.alloc(0));
    const text = new Api.Message({id: 1, peerId: new Api.PeerUser({userId: bigInt(42)}), date: 0, message: 'oi'});
    await expect(downloadPhotoSize(client, text, 320)).rejects.toThrow('no photo');
  });
});

describe('createThumbnailLoader', () => {
  afterEach(() => vi.restoreAllMocks());

  const photo = (id: number): ChatMessage => ({...model(), id: String(id)});

  it(`downloads ${THUMBNAIL_DOWNLOADS} at a time, once per photo, and tells when one arrives`, async () => {
    let running = 0;
    let most = 0;
    const asked: string[] = [];
    const changed = vi.fn();
    const loader = createThumbnailLoader(async message => {
      asked.push(message.id);
      running += 1;
      most = Math.max(most, running);
      await new Promise(resolve => setTimeout(resolve, 5));
      running -= 1;
      return new Blob(['jpeg']);
    }, changed);
    for (const id of [1, 2, 3, 4, 1, 2]) loader.request(photo(id));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(4));
    expect(asked).toEqual(['1', '2', '3', '4']);
    expect(most).toBe(THUMBNAIL_DOWNLOADS);
    expect(loader.get(photo(3))).toMatch(/^blob:/);
    loader.request(photo(3));
    expect(asked).toHaveLength(4);
    loader.dispose();
  });

  it(`keeps the last ${KEPT_THUMBNAILS}, releasing the oldest, and releases all on dispose`, async () => {
    const revoked: string[] = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => {
      revoked.push(url);
      revoke(url);
    });
    const changed = vi.fn();
    const loader = createThumbnailLoader(async () => new Blob(['jpeg']), changed);
    for (let id = 1; id <= KEPT_THUMBNAILS + 2; id += 1) loader.request(photo(id));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(KEPT_THUMBNAILS + 2));
    expect(loader.get(photo(1))).toBeNull();
    expect(loader.get(photo(2))).toBeNull();
    expect(revoked).toHaveLength(2);
    loader.dispose();
    expect(revoked).toHaveLength(KEPT_THUMBNAILS + 2);
  });

  it('skips a photo still being sent, and keeps the preview after a failed download', async () => {
    const download = vi.fn(async () => {
      throw new Error('FILE_REFERENCE_EXPIRED');
    });
    const loader = createThumbnailLoader(download, vi.fn());
    loader.request({...photo(9), pending: true});
    expect(download).not.toHaveBeenCalled();
    loader.request(photo(10));
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(loader.get(photo(10))).toBeNull();
    loader.dispose();
  });
});

describe('chat cache', () => {
  it('never stores photo previews', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value)});
    const message = model({preview: 'AAAA', width: 800, height: 600});
    expect(withoutPreview(message).content).toEqual({kind: 'photo', text: 'Olha isso', width: 800, height: 600});
    saveChatCache('account', [{id: '42', name: 'Bruno', isGroup: false, unreadCount: 0, lastMessage: message, timestamp: 0, hasPhoto: false}], {'42': [message]});
    const json = [...stored.values()][0];
    expect(json).not.toContain('AAAA');
    expect(json).toContain('"width":800');
    vi.unstubAllGlobals();
  });
});
