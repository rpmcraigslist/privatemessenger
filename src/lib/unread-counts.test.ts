import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationModel, MessageModel } from './amplify';
import { markConversationRead, resolveReadScopeKey } from './read-state';
import { computeUnreadCounts, totalUnreadCount } from './unread-counts';

vi.mock('./read-state-sync', () => ({
  getServerLastReadAt: () => null,
  mergeServerLastReadAt: vi.fn(),
  loadServerReadState: vi.fn(),
  resetReadStateSync: vi.fn(),
}));

function conversation(id: string): ConversationModel {
  return {
    id,
    participants: ['my-sub', 'other-sub'],
    isGroup: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  } as ConversationModel;
}

function message(
  id: string,
  conversationId: string,
  sender: string,
  createdAt: string,
): MessageModel {
  return {
    id,
    conversationId,
    senderUsername: sender,
    participantUsernames: ['my-sub', 'other-sub'],
    createdAt,
    updatedAt: createdAt,
  } as MessageModel;
}

describe('unread-counts', () => {
  const handleToSub = new Map<string, string>();

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns zero for the open conversation', () => {
    const counts = computeUnreadCounts(
      [conversation('c1'), conversation('c2')],
      [
        message('m1', 'c1', 'other', '2026-06-20T10:00:00.000Z'),
        message('m2', 'c2', 'other', '2026-06-20T11:00:00.000Z'),
      ],
      'c1',
      'me',
      'my-sub',
      new Map(),
      handleToSub,
    );

    expect(counts.get('c1')).toBe(0);
    expect(counts.get('c2')).toBe(1);
  });

  it('updates after a conversation is marked read', () => {
    const conv = conversation('c2');
    const scope = resolveReadScopeKey(conv, 'me', 'my-sub', handleToSub);
    markConversationRead('my-sub', 'me', scope, '2026-06-20T11:00:00.000Z', 'c2');

    const counts = computeUnreadCounts(
      [conv],
      [message('m2', 'c2', 'other', '2026-06-20T11:00:00.000Z')],
      null,
      'me',
      'my-sub',
      new Map(),
      handleToSub,
    );

    expect(counts.get('c2')).toBe(0);
    expect(totalUnreadCount(counts)).toBe(0);
  });

  it('aggregates totals across conversations', () => {
    const counts = computeUnreadCounts(
      [conversation('c1'), conversation('c2')],
      [
        message('m1', 'c1', 'other', '2026-06-20T10:00:00.000Z'),
        message('m2', 'c1', 'other', '2026-06-20T10:01:00.000Z'),
        message('m3', 'c2', 'other', '2026-06-20T11:00:00.000Z'),
      ],
      null,
      'me',
      'my-sub',
      new Map(),
      handleToSub,
    );

    expect(totalUnreadCount(counts)).toBe(3);
  });
});
