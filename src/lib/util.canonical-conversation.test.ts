import { describe, expect, it } from 'vitest';
import { buildCanonicalConversationIdMap } from './util';

describe('buildCanonicalConversationIdMap', () => {
  const mySub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const peerSub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const handleToSub = new Map<string, string>();

  it('maps duplicate 1:1 threads to the conversation with latest activity', () => {
    const older = {
      id: 'conv-old',
      isGroup: false,
      participants: [mySub, peerSub],
      lastMessageAt: '2026-06-20T10:00:00.000Z',
      createdAt: '2026-06-20T09:00:00.000Z',
    };
    const newer = {
      id: 'conv-new',
      isGroup: false,
      participants: [mySub, peerSub],
      lastMessageAt: '2026-06-20T12:00:00.000Z',
      createdAt: '2026-06-20T11:00:00.000Z',
    };

    const map = buildCanonicalConversationIdMap(
      [older, newer],
      (conversation) => conversation.lastMessageAt ?? conversation.createdAt,
      'alice',
      mySub,
      handleToSub,
    );

    expect(map.get('conv-new')).toBe('conv-new');
    expect(map.get('conv-old')).toBe('conv-new');
  });
});
