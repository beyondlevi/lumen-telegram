import {Buffer} from 'buffer';
import bigInt from 'big-integer';
import {Api, TelegramClient} from 'telegram';
import {StringSession} from 'telegram/sessions';
import {describe, expect, it} from 'vitest';
import {sendPhotoFile, sentMessage} from '../../src/telegram/gramClient';

describe('sendPhotoFile (GramJS sendFile with the network replaced)', () => {
  it('uploads the JPEG and sends it as a photo with its caption', async () => {
    const client = new TelegramClient(new StringSession(''), 1, '0123456789abcdef0123456789abcdef', {});
    client.setLogLevel('none' as never);
    const parts: Api.upload.SaveFilePart[] = [];
    const requests: Api.messages.SendMedia[] = [];
    Object.assign(client, {
      getSender: async () => ({
        send: async (request: Api.upload.SaveFilePart) => {
          parts.push(request);
          return true;
        },
        isConnected: () => true,
      }),
      invoke: async (request: Api.messages.SendMedia) => {
        requests.push(request);
        const message = new Api.Message({
          id: 78,
          out: true,
          peerId: new Api.PeerUser({userId: bigInt(42)}),
          date: 1790000000,
          message: request.message,
          media: new Api.MessageMediaPhoto({
            photo: new Api.Photo({
              id: bigInt(1), accessHash: bigInt(2), fileReference: Buffer.alloc(0), date: 1790000000, sizes: [], dcId: 2,
            }),
          }),
        });
        return new Api.Updates({
          updates: [
            new Api.UpdateMessageID({id: 78, randomId: request.randomId}),
            new Api.UpdateNewMessage({message, pts: 1, ptsCount: 1}),
          ],
          users: [],
          chats: [],
          date: 1790000000,
          seq: 0,
        });
      },
    });
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6000, 7)]);
    const sent = await sendPhotoFile(
      client,
      new Api.InputPeerUser({userId: bigInt(42), accessHash: bigInt(9)}),
      {bytes: new Uint8Array(jpeg), mimetype: 'image/jpeg', caption: 'Pôr do sol'},
    );
    expect(sent.id).toBe(78);
    expect(Array.from(Buffer.concat(parts.map(part => Buffer.from(part.bytes))).subarray(0, 3), byte => byte.toString(16)).join('')).toBe('ffd8ff');
    expect(requests[0].media.className).toBe('InputMediaUploadedPhoto');
    expect(requests[0].message).toBe('Pôr do sol');
    expect(sentMessage(sent, '42')).toMatchObject({id: '78', chatId: '42', fromMe: true, content: {kind: 'photo', text: 'Pôr do sol'}});
  });
});
