import {describe, expect, it} from 'vitest';
import {chatPreview, chatDisplayName} from '../../src/format';
import type {Chat, ChatMessage} from '../../src/telegram/model';
import {reactionOptions, withMyReaction} from '../../src/telegram/reactions';

describe('reactionOptions', () => {
  it('keeps the four defaults when anything is allowed', () => {
    expect(reactionOptions(null).map(option => option.emoji)).toEqual(['👍', '❤', '😂', '😭']);
    expect(reactionOptions({kind: 'all'}).every(option => option.allowed)).toBe(true);
  });

  it('swaps in an accepted substitute, or disables the slot', () => {
    expect(reactionOptions({kind: 'some', emojis: ['👍', '❤️', '🤣', '😢']})).toEqual([
      {emoji: '👍', allowed: true},
      {emoji: '❤', allowed: true},
      {emoji: '🤣', allowed: true},
      {emoji: '😢', allowed: true},
    ]);
    expect(reactionOptions({kind: 'some', emojis: ['👍']}).map(option => option.allowed)).toEqual([true, false, false, false]);
    expect(reactionOptions({kind: 'none'}).every(option => !option.allowed)).toBe(true);
  });
});

describe('withMyReaction', () => {
  it('replaces your reaction and keeps the others', () => {
    const start = [
      {emoji: '👍', count: 2, mine: true},
      {emoji: '❤', count: 1, mine: false},
    ];
    expect(withMyReaction(start, '❤️')).toEqual([
      {emoji: '👍', count: 1, mine: false},
      {emoji: '❤', count: 2, mine: true},
    ]);
    expect(withMyReaction([{emoji: '👍', count: 1, mine: true}], null)).toBeUndefined();
    expect(withMyReaction(undefined, '🤣')).toEqual([{emoji: '🤣', count: 1, mine: true}]);
  });
});

describe('chatPreview', () => {
  const base = (lastMessage: ChatMessage, isGroup = false): Chat => ({
    id: '1', name: isGroup ? 'Family' : 'Ana Souza', isGroup, unreadCount: 0, lastMessage, timestamp: lastMessage.timestamp, hasPhoto: false,
  });
  const message = (extra: Partial<ChatMessage>): ChatMessage => ({
    id: '9', chatId: '1', fromMe: true, senderName: null, timestamp: 1, content: {kind: 'text', text: 'Lunch on Sunday at noon?'}, ...extra,
  });

  it('never previews a reaction as a message', () => {
    expect(chatPreview(base(message({reactions: [{emoji: '👍', count: 1, mine: true}]})))).toBe('You: Lunch on Sunday at noon?');
  });

  it("reads someone else's unread reaction to your last message", () => {
    expect(chatPreview(base(message({recentReaction: {emoji: '❤', senderName: 'Ana Souza', unread: true}})))).toBe(
      'Reacted ❤️ to “Lunch on Sunday at noon?”',
    );
    expect(chatPreview(base(message({recentReaction: {emoji: '😁', senderName: 'Bruno Lima', unread: true}}), true))).toBe(
      'Bruno: Reacted 😁 to “Lunch on Sunday at noon?”',
    );
    expect(chatPreview(base(message({recentReaction: {emoji: '😁', senderName: 'Bruno', unread: false}})))).toBe('You: Lunch on Sunday at noon?');
  });

  it('names chats, falling back to the phone number', () => {
    expect(chatDisplayName({name: null, phone: '+15550100106'})).toBe('+15550100106');
    expect(chatDisplayName({name: null})).toBe('Unknown contact');
  });
});
