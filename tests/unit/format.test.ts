import {describe, expect, it} from 'vitest';
import {chatPreview, describeContent} from '../../src/format';
import type {Chat, ChatMessage, MessageContent} from '../../src/telegram/model';

const chat = (content: MessageContent, fromMe: boolean): Chat => ({
  id: '42', name: 'Ana Souza', isGroup: false, unreadCount: 0, hasPhoto: false, timestamp: 0,
  lastMessage: {id: '1', chatId: '42', fromMe, senderName: fromMe ? null : 'Ana Souza', timestamp: 0, content} satisfies ChatMessage,
});

describe('audio previews', () => {
  it('names voice notes and audio files apart, with "You:" on your own', () => {
    expect(chatPreview(chat({kind: 'audio', text: '', seconds: 22, voice: true}, true))).toBe('You: Voice message');
    expect(chatPreview(chat({kind: 'audio', text: '', seconds: 180, voice: false}, true))).toBe('You: Audio');
    expect(chatPreview(chat({kind: 'audio', text: '', seconds: 6, voice: true}, false))).toBe('Voice message');
    // Content cached by 0.2.0 has no flag: those were voice notes
    expect(describeContent({kind: 'audio', text: '', seconds: 6})).toBe('Voice message');
  });
});
