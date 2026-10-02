import {Buffer} from 'buffer';
import bigInt from 'big-integer';
import {Api} from 'telegram';
import {describe, expect, it} from 'vitest';
import {displayEmoji, entityName, messageContent, sameEmoji, toChat, toMessage} from '../../src/telegram/convert';

const date = 1790000000;
const emoji = (emoticon: string) => new Api.ReactionEmoji({emoticon});

function message(fields: Partial<ConstructorParameters<typeof Api.Message>[0]>) {
  return new Api.Message({id: 7, peerId: new Api.PeerUser({userId: bigInt(42)}), date, message: '', ...fields});
}

function document(attributes: Api.TypeDocumentAttribute[], mimeType = 'application/octet-stream') {
  return new Api.Document({
    id: bigInt(1), accessHash: bigInt(2), fileReference: Buffer.from([]), date, mimeType, size: bigInt(10), dcId: 2, attributes,
  });
}

describe('messageContent', () => {
  it('shows every audio as a playable audio bubble and tells voice notes from audio files', () => {
    const audioDocument = (attributes: Api.TypeDocumentAttribute[], mimeType: string, voiceFlag = false) =>
      messageContent(message({media: new Api.MessageMediaDocument({voice: voiceFlag, document: document(attributes, mimeType)})}));
    // What GramJS sendFile({voiceNote: true}) uploads: a file name and the voice attribute
    expect(audioDocument([new Api.DocumentAttributeFilename({fileName: 'voice.ogg'}), new Api.DocumentAttributeAudio({voice: true, duration: 22})], 'audio/ogg', true))
      .toEqual({kind: 'audio', text: '', seconds: 22, voice: true});
    // The voice attribute alone marks a voice note, even without the media flag
    expect(audioDocument([new Api.DocumentAttributeAudio({voice: true, duration: 5})], 'audio/ogg')).toEqual({kind: 'audio', text: '', seconds: 5, voice: true});
    // An audio file (music, an .ogg sent as a file): audio, not voice
    expect(audioDocument([new Api.DocumentAttributeAudio({duration: 180, title: 'Song'}), new Api.DocumentAttributeFilename({fileName: 'song.mp3'})], 'audio/mpeg'))
      .toEqual({kind: 'audio', text: '', seconds: 180, voice: false});
    // An audio document with only a file name: still audio (it used to be a "Document")
    expect(audioDocument([new Api.DocumentAttributeFilename({fileName: 'note.ogg'})], 'audio/ogg')).toEqual({kind: 'audio', text: '', voice: false});
    // A video with a sound track stays a video
    expect(audioDocument([new Api.DocumentAttributeVideo({duration: 3, w: 1, h: 1})], 'audio/mp4')).toEqual({kind: 'video', text: ''});
  });

  it('reads text, photos and every marker kind', () => {
    expect(messageContent(message({message: 'Hi'}))).toEqual({kind: 'text', text: 'Hi'});
    expect(messageContent(message({message: 'Look', media: new Api.MessageMediaPhoto({})}))).toEqual({kind: 'photo', text: 'Look'});
    const voice = message({media: new Api.MessageMediaDocument({voice: true, document: document([new Api.DocumentAttributeAudio({voice: true, duration: 9})], 'audio/ogg')})});
    expect(messageContent(voice)).toEqual({kind: 'audio', text: '', seconds: 9, voice: true});
    const sticker = message({media: new Api.MessageMediaDocument({document: document([new Api.DocumentAttributeSticker({alt: '👋', stickerset: new Api.InputStickerSetEmpty()})])})});
    expect(messageContent(sticker)).toEqual({kind: 'sticker', text: '👋'});
    const video = message({media: new Api.MessageMediaDocument({document: document([new Api.DocumentAttributeVideo({duration: 3, w: 1, h: 1})])})});
    expect(messageContent(video)).toEqual({kind: 'video', text: ''});
    const file = message({media: new Api.MessageMediaDocument({document: document([new Api.DocumentAttributeFilename({fileName: 'a.pdf'})])})});
    expect(messageContent(file)).toEqual({kind: 'document', text: 'a.pdf'});
    const venue = message({media: new Api.MessageMediaVenue({geo: new Api.GeoPointEmpty(), title: 'Central', address: '', provider: '', venueId: '', venueType: ''})});
    expect(messageContent(venue)).toEqual({kind: 'location', text: 'Central'});
    const contact = message({media: new Api.MessageMediaContact({phoneNumber: '', firstName: 'Rita', lastName: 'Gomes', vcard: '', userId: bigInt(0)})});
    expect(messageContent(contact)).toEqual({kind: 'contact', text: 'Rita Gomes'});
    const poll = message({
      media: new Api.MessageMediaPoll({
        poll: new Api.Poll({id: bigInt(1), question: new Api.TextWithEntities({text: 'Lunch?', entities: []}), answers: []}),
        results: new Api.PollResults({}),
      }),
    });
    expect(messageContent(poll)).toEqual({kind: 'poll', text: 'Lunch?'});
  });

  it('skips service messages', () => {
    const service = new Api.MessageService({id: 1, peerId: new Api.PeerUser({userId: bigInt(1)}), date, action: new Api.MessageActionChatCreate({title: 'x', users: []})});
    expect(messageContent(service)).toBeNull();
    expect(toMessage(service, {chatId: '1'})).toBeNull();
  });
});

describe('toMessage', () => {
  it('reads reactions (yours marked by chosen_order) and the newest reaction by someone else', () => {
    const converted = toMessage(
      message({
        out: true,
        message: 'Lunch at noon?',
        reactions: new Api.MessageReactions({
          results: [
            new Api.ReactionCount({reaction: emoji('👍'), count: 2, chosenOrder: 0}),
            new Api.ReactionCount({reaction: emoji('❤'), count: 1}),
            new Api.ReactionCount({reaction: new Api.ReactionCustomEmoji({documentId: bigInt(5)}), count: 1}),
          ],
          recentReactions: [
            new Api.MessagePeerReaction({peerId: new Api.PeerUser({userId: bigInt(9)}), date, reaction: emoji('❤'), unread: true}),
          ],
        }),
      }),
      {chatId: '42', peerName: () => 'Bruno Lima'},
    );
    expect(converted).toMatchObject({
      id: '7',
      chatId: '42',
      fromMe: true,
      timestamp: date * 1000,
      content: {kind: 'text', text: 'Lunch at noon?'},
      reactions: [
        {emoji: '👍', count: 2, mine: true},
        {emoji: '❤', count: 1, mine: false},
      ],
      recentReaction: {emoji: '❤', senderName: 'Bruno Lima', unread: true},
    });
  });
});

describe('toChat', () => {
  it('reads a dialog: name, group, unread, photo, phone for unnamed users', () => {
    const user = new Api.User({id: bigInt(42), firstName: 'Ana', lastName: 'Souza', photo: new Api.UserProfilePhoto({photoId: bigInt(77), dcId: 2})});
    const chat = toChat({id: bigInt(42), entity: user, isGroup: false, unreadCount: 3, message: message({message: 'Oi'}), date});
    expect(chat).toMatchObject({id: '42', name: 'Ana Souza', isGroup: false, unreadCount: 3, hasPhoto: true, photoKey: '77'});
    expect(chat?.lastMessage?.content.text).toBe('Oi');

    const unnamed = new Api.User({id: bigInt(43), phone: '15550100106'});
    expect(toChat({id: bigInt(43), entity: unnamed, isGroup: false, unreadCount: 0, dialog: {unreadMark: true}})).toMatchObject({
      name: null,
      phone: '+15550100106',
      unreadCount: 1,
      hasPhoto: false,
    });

    const group = new Api.Channel({id: bigInt(5), title: 'Família', photo: new Api.ChatPhotoEmpty(), date, megagroup: true});
    expect(toChat({id: bigInt('-1005'), entity: group, isGroup: true, unreadCount: 0})).toMatchObject({id: '-1005', name: 'Família', isGroup: true, hasPhoto: false});
  });

  it('names entities', () => {
    expect(entityName(new Api.User({id: bigInt(1), deleted: true}))).toBeNull();
    expect(entityName(new Api.Chat({id: bigInt(1), title: ' Club ', photo: new Api.ChatPhotoEmpty(), participantsCount: 1, date, version: 1}))).toBe('Club');
  });
});

describe('emoji', () => {
  it('compares and displays ❤ with or without the variation selector', () => {
    expect(sameEmoji('❤', '❤️')).toBe(true);
    expect(displayEmoji('❤')).toBe('❤️');
    expect(displayEmoji('👍')).toBe('👍');
  });
});
