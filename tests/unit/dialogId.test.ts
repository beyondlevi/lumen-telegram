import bigInt from 'big-integer';
import {Api} from 'telegram';
import {describe, expect, it} from 'vitest';
import {createDemoClient} from '../../src/demo/demoClient';
import {entityChat} from '../../src/telegram/convert';
import {candidateChatIds, dialogPeers, findListedChat, markedId, parseShortcut, type DialogPeer} from '../../src/telegram/dialogId';
import {findDialogChat} from '../../src/telegram/gramClient';

const date = 1790000000;

describe('parseShortcut (Telegram for Android notification shortcut ids)', () => {
  it('reads a user dialog', () => {
    expect(parseShortcut('ndid_8811522265')).toEqual({kind: 'user', userId: '8811522265'});
  });

  it('reads a negative dialog as a group (basic group or channel/supergroup)', () => {
    expect(parseShortcut('ndid_-1194773306')).toEqual({kind: 'group', id: '1194773306'});
    expect(parseShortcut(' ndid_-42 ')).toEqual({kind: 'group', id: '42'});
  });

  it('rejects anything else', () => {
    for (const garbage of [
      '',
      'ndid_',
      'ndid_-',
      'ndid_0',
      'ndid_-0',
      'ndid_007',
      'ndid_12a',
      'ndid_1.5',
      'ndid_--5',
      'ndid_+5',
      'ndid_1e9',
      'ndid_99999999999999999',
      'NDID_123',
      'nid_123',
      '8811522265',
      '-1001194773306',
      'ndid_123_456',
      '{shortcut}',
      'ndid_１２３',
    ]) {
      expect(parseShortcut(garbage), garbage).toBeNull();
    }
  });
});

describe('dialog id → app chat id (GramJS marked ids)', () => {
  it('maps a user to its own id', () => {
    const dialog = parseShortcut('ndid_8811522265');
    expect(dialog && candidateChatIds(dialog)).toEqual(['8811522265']);
  });

  it('maps a negative id to a supergroup/channel (-100…) and a basic group (-id)', () => {
    const dialog = parseShortcut('ndid_-1194773306');
    expect(dialog && candidateChatIds(dialog)).toEqual(['-1001194773306', '-1194773306']);
  });

  it('marks channel ids as -(10^12 + id), like GramJS, also for short ids', () => {
    expect(markedId({type: 'channel', id: '123456789'})).toBe('-1000123456789');
    expect(markedId({type: 'channel', id: '1000000042'})).toBe('-1001000000042');
    expect(markedId({type: 'channel', id: '2345678901'})).toBe('-1002345678901');
    expect(markedId({type: 'chat', id: '4000042'})).toBe('-4000042');
    expect(markedId({type: 'user', id: '7700101'})).toBe('7700101');
  });

  it('marks like GramJS utils.getPeerId', async () => {
    const {utils} = await import('telegram');
    expect(markedId({type: 'channel', id: '1194773306'})).toBe(utils.getPeerId(new Api.PeerChannel({channelId: bigInt(1194773306)})));
    expect(markedId({type: 'chat', id: '1194773306'})).toBe(utils.getPeerId(new Api.PeerChat({chatId: bigInt(1194773306)})));
    expect(markedId({type: 'user', id: '8811522265'})).toBe(utils.getPeerId(new Api.PeerUser({userId: bigInt(8811522265)})));
  });

  it('looks up users as users, and negative ids as a channel first, then a basic group', () => {
    expect(dialogPeers({kind: 'user', userId: '5'})).toEqual([{type: 'user', id: '5'}]);
    expect(dialogPeers({kind: 'group', id: '5'})).toEqual([
      {type: 'channel', id: '5'},
      {type: 'chat', id: '5'},
    ]);
  });

  it('finds the chat in the loaded list', () => {
    const chats = [{id: '8811522265'}, {id: '-4000042'}, {id: '-1001194773306'}, {id: '1194773306'}];
    const find = (shortcut: string) => {
      const dialog = parseShortcut(shortcut);
      return dialog ? findListedChat(dialog, chats)?.id : undefined;
    };
    expect(find('ndid_8811522265')).toBe('8811522265');
    expect(find('ndid_-4000042')).toBe('-4000042');
    expect(find('ndid_-1194773306')).toBe('-1001194773306');
    // A positive id never matches a group, nor a negative one a user.
    expect(find('ndid_4000042')).toBeUndefined();
    expect(find('ndid_-8811522265')).toBeUndefined();
    expect(find('ndid_123')).toBeUndefined();
  });
});

describe('entityChat (an entity opened from a notification)', () => {
  it('builds a user, a basic group, a supergroup and a channel', () => {
    const user = new Api.User({id: bigInt(8811522265), firstName: 'Ana', lastName: 'Souza'});
    expect(entityChat(user, '8811522265')).toMatchObject({id: '8811522265', name: 'Ana Souza', isGroup: false, unreadCount: 0, lastMessage: null, timestamp: null, hasPhoto: false});
    const unnamed = new Api.User({id: bigInt(9), phone: '15550100109'});
    expect(entityChat(unnamed, '9')).toMatchObject({name: null, phone: '+15550100109'});
    const chat = new Api.Chat({id: bigInt(4000042), title: 'Hike Crew', photo: new Api.ChatPhotoEmpty(), participantsCount: 3, date, version: 1});
    expect(entityChat(chat, '-4000042')).toMatchObject({id: '-4000042', name: 'Hike Crew', isGroup: true});
    const supergroup = new Api.Channel({id: bigInt(1194773306), title: 'Trail Club', megagroup: true, photo: new Api.ChatPhotoEmpty(), date});
    expect(entityChat(supergroup, '-1001194773306')).toMatchObject({name: 'Trail Club', isGroup: true});
    const channel = new Api.Channel({id: bigInt(1194773306), title: 'News', broadcast: true, photo: new Api.ChatPhotoEmpty(), date});
    expect(entityChat(channel, '-1001194773306')).toMatchObject({name: 'News', isGroup: false});
  });

  it('refuses entities that cannot be opened', () => {
    expect(entityChat(new Api.UserEmpty({id: bigInt(1)}), '1')).toBeNull();
    expect(entityChat(new Api.ChatForbidden({id: bigInt(2), title: 'Old'}), '-2')).toBeNull();
    expect(entityChat(new Api.ChannelForbidden({id: bigInt(3), accessHash: bigInt(1), title: 'Gone'}), '-1000000000003')).toBeNull();
    const deactivated = new Api.Chat({id: bigInt(4), title: 'Moved', deactivated: true, photo: new Api.ChatPhotoEmpty(), participantsCount: 0, date, version: 1});
    expect(entityChat(deactivated, '-4')).toBeNull();
    expect(entityChat(undefined, '5')).toBeNull();
  });
});

describe('findDialogChat (GramJS lookup)', () => {
  const supergroup = new Api.Channel({id: bigInt(1194773306), title: 'Trail Club', megagroup: true, accessHash: bigInt(7), photo: new Api.ChatPhotoEmpty(), date});
  const basic = new Api.Chat({id: bigInt(1194773306), title: 'Family', photo: new Api.ChatPhotoEmpty(), participantsCount: 4, date, version: 1});

  it('uses an entity already known this session without asking Telegram', async () => {
    const asked: DialogPeer[] = [];
    const found = await findDialogChat(
      {kind: 'group', id: '1194773306'},
      chatId => (chatId === '-1001194773306' ? supergroup : undefined),
      async peer => {
        asked.push(peer);
        throw new Error('not expected');
      },
    );
    expect(found?.chat.id).toBe('-1001194773306');
    expect(asked).toEqual([]);
  });

  it('asks Telegram for a channel/supergroup, then falls back to a basic group', async () => {
    const asked: string[] = [];
    const found = await findDialogChat({kind: 'group', id: '1194773306'}, () => undefined, async peer => {
      asked.push(peer.type);
      if (peer.type === 'channel') throw new Error('CHANNEL_INVALID');
      return basic;
    });
    expect(asked).toEqual(['channel', 'chat']);
    expect(found?.chat).toMatchObject({id: '-1194773306', name: 'Family', isGroup: true});
    expect(found?.entity).toBe(basic);
  });

  it('returns the supergroup with its marked id', async () => {
    const found = await findDialogChat({kind: 'group', id: '1194773306'}, () => undefined, async peer => {
      if (peer.type === 'channel') return supergroup;
      throw new Error('not expected');
    });
    expect(found?.chat).toMatchObject({id: '-1001194773306', name: 'Trail Club'});
  });

  it('asks for a user as a user', async () => {
    const user = new Api.User({id: bigInt(8811522265), firstName: 'Ana', accessHash: bigInt(3)});
    const asked: DialogPeer[] = [];
    const found = await findDialogChat({kind: 'user', userId: '8811522265'}, () => undefined, async peer => {
      asked.push(peer);
      return user;
    });
    expect(asked).toEqual([{type: 'user', id: '8811522265'}]);
    expect(found?.chat).toMatchObject({id: '8811522265', name: 'Ana'});
  });

  it('gives null when nothing can be opened', async () => {
    const forbidden = new Api.ChatForbidden({id: bigInt(5), title: 'Left'});
    const found = await findDialogChat({kind: 'group', id: '5'}, () => undefined, async peer => {
      if (peer.type === 'chat') return forbidden;
      throw new Error('CHANNEL_INVALID');
    });
    expect(found).toBeNull();
    expect(await findDialogChat({kind: 'user', userId: '5'}, () => undefined, async () => Promise.reject(new Error('PEER_ID_INVALID')))).toBeNull();
  });
});

describe('demo client dialog ids', () => {
  it('opens the fictional chats by their dialog ids', async () => {
    const client = createDemoClient();
    const resolve = async (shortcut: string) => {
      const dialog = parseShortcut(shortcut);
      return dialog ? (await client.resolveDialog(dialog))?.name : undefined;
    };
    expect(await resolve('ndid_7700101')).toBe('Maya Chen');
    expect(await resolve('ndid_-4000042')).toBe('Hike Crew');
    expect(await resolve('ndid_-1000000042')).toBe('Library News');
    expect(await resolve('ndid_8811522265')).toBeUndefined();
    await client.disconnect();
  });
});
