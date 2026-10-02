import {afterEach, describe, expect, it, vi} from 'vitest';
import {createDemoClient} from '../../src/demo/demoClient';
import {chatPreview} from '../../src/format';
import {reactionOptions} from '../../src/telegram/reactions';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('demo client', () => {
  it('never opens a connection or fetches', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network used')));
    const socketSpy = vi.fn(() => {
      throw new Error('WebSocket used');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', socketSpy);
    const client = createDemoClient();
    const chats = await client.getChats(40);
    for (const chat of chats) {
      await client.getMessages(chat.id, 30);
      await client.allowedReactions(chat.id);
    }
    await client.markRead(chats[0].id, '1');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(socketSpy).not.toHaveBeenCalled();
  });

  it('lists fictional chats with unread rows, a group, a channel, media and a reaction preview', async () => {
    const chats = await createDemoClient().getChats(40);
    expect(chats.map(chat => chat.name ?? chat.phone)).toEqual([
      'Maya Chen', 'Hike Crew', 'Sam Rivera', 'Library News', 'Bike Shop', 'Jordan Lee', '+12025550199',
    ]);
    expect(chats.map(chat => chatPreview(chat))).toEqual([
      'Can you bring the projector?',
      'Leo: Photo: Trail map',
      'Reacted ❤️ to “Sounds good, 7 pm works.”',
      'Poll: Best reading spot?',
      'Document: Invoice_0042.pdf',
      'Location: Central Station',
      'Hi! Is the desk still available?',
    ]);
    expect(chats.filter(chat => chat.unreadCount > 0).map(chat => chat.id)).toEqual(['7700101', '-4000042', '-1001000000042', '7700199']);
    expect(chats.filter(chat => chat.hasPhoto).map(chat => chat.name)).toEqual(['Maya Chen', 'Hike Crew', 'Sam Rivera', 'Library News', 'Bike Shop']);
  });

  it('accepts only the reactions each chat allows', async () => {
    const client = createDemoClient();
    expect(reactionOptions(await client.allowedReactions('7700101')).map(option => option.emoji)).toEqual(['👍', '❤', '🤣', '😭']);
    expect(reactionOptions(await client.allowedReactions('-4000042')).map(option => option.emoji)).toEqual(['👍', '❤', '🤣', '😢']);
    expect(await client.allowedReactions('-1001000000042')).toEqual({kind: 'none'});
    vi.useFakeTimers();
    const refused = client.sendReaction('-1001000000042', '1012', '👍');
    refused.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(refused).rejects.toMatchObject({kind: 'rejected', code: 'REACTION_INVALID'});
    const added = client.sendReaction('7700101', '1007', '❤');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await added).toEqual([{emoji: '❤', count: 1, mine: true}]);
  });

  it('answers your first reply once, with a push update', async () => {
    vi.useFakeTimers();
    const client = createDemoClient();
    const updates: (string | undefined)[] = [];
    client.onUpdate(update => updates.push(update.chatId));
    const sending = client.sendText('7700101', 'Sure, I will bring it.');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await sending).content.text).toBe('Sure, I will bring it.');
    await vi.advanceTimersByTimeAsync(3000);
    expect(updates).toEqual(['7700101']);
    const texts = (await client.getMessages('7700101', 30)).map(message => message.content.text);
    expect(texts.slice(-2)).toEqual(['Sure, I will bring it.', 'Perfect, thanks! See you at 10.']);
  });

  it('starts from the same chats on every launch and serves packaged media', async () => {
    vi.stubGlobal('location', {href: 'http://127.0.0.1:5500/'});
    const first = createDemoClient();
    await first.markRead('7700101', '1007');
    expect((await createDemoClient().getChats(40))[0].unreadCount).toBe(2);
    const thread = await first.getMessages('7700101', 30);
    const voice = thread.find(message => message.content.kind === 'audio');
    expect(voice?.content.seconds).toBe(6);
    vi.useFakeTimers();
    const media = first.getMedia('7700101', voice?.id ?? '');
    const photo = first.getProfilePhoto('7700103');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await media).toMatchObject({mimetype: 'audio/ogg'});
    expect(await photo).toBeNull();
  });
});
