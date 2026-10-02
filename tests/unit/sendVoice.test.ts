import {Buffer} from 'buffer';
import bigInt from 'big-integer';
import {Api, TelegramClient} from 'telegram';
import {StringSession} from 'telegram/sessions';
import {describe, expect, it} from 'vitest';
import {sendVoiceNote} from '../../src/telegram/gramClient';
import {decodeWaveform, encodeWaveform} from '../../src/telegram/waveform';

describe('sendVoiceNote (GramJS sendFile with the network replaced)', () => {
  it('uploads the OGG and sends a voice document with length and waveform', async () => {
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
          id: 77,
          out: true,
          peerId: new Api.PeerUser({userId: bigInt(42)}),
          date: 1790000000,
          message: '',
          media: new Api.MessageMediaDocument({voice: true, document: new Api.DocumentEmpty({id: bigInt(1)})}),
        });
        return new Api.Updates({
          updates: [
            new Api.UpdateMessageID({id: 77, randomId: request.randomId}),
            new Api.UpdateNewMessage({message, pts: 1, ptsCount: 1}),
          ],
          users: [],
          chats: [],
          date: 1790000000,
          seq: 0,
        });
      },
    });
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(5000, 1)]);
    const levels = Array.from({length: 40}, (_, index) => (index % 10) / 10);
    const sent = await sendVoiceNote(
      client,
      new Api.InputPeerUser({userId: bigInt(42), accessHash: bigInt(9)}),
      {bytes: new Uint8Array(ogg), mimetype: 'audio/ogg; codecs=opus', durationMs: 4400, waveform: encodeWaveform(levels)},
    );
    expect(sent.id).toBe(77);
    expect(Buffer.concat(parts.map(part => Buffer.from(part.bytes))).subarray(0, 4).toString()).toBe('OggS');
    const media = requests[0].media as Api.InputMediaUploadedDocument;
    expect(media.className).toBe('InputMediaUploadedDocument');
    const audio = media.attributes.find(item => item instanceof Api.DocumentAttributeAudio) as Api.DocumentAttributeAudio;
    expect(audio.voice).toBe(true);
    expect(audio.duration).toBe(4);
    expect(decodeWaveform(new Uint8Array(audio.waveform ?? []))).toHaveLength(100);
    expect(media.mimeType).toBe('audio/ogg');
  });
});

describe('waveform', () => {
  it('packs 100 five-bit samples scaled to the loudest level', () => {
    const packed = encodeWaveform(Array.from({length: 250}, (_, index) => index / 249));
    expect(packed).toHaveLength(63);
    const values = decodeWaveform(packed).slice(0, 100);
    expect(values[0]).toBe(0);
    expect(values[99]).toBe(31);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(encodeWaveform([])).toHaveLength(0);
  });
});
