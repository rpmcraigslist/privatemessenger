import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationModel, MessageModel } from './amplify';
import { markConversationRead, resolveReadScopeKey } from './read-state';
import {
  computeUnreadCounts,
  readThroughTimestampForConversation,
  totalUnreadCount,
} from './unread-counts';

vi.mock('./read-state-sync', () => ({
  getServerLastReadAt: () => null,
  mergeServerLastReadAt: vi.fn(),
  loadServerReadState: vi.fn(),
  resetReadStateSync: vi.fn(),
  flushReadStateNow: vi.fn(),
  installReadStateFlushHooks: vi.fn(),
}));

function conversation(id: string, participants = ['my-sub', 'other-sub']): ConversationModel {
  return {
    id,
    participants,
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
      [conversation('c1', ['my-sub', 'peer-a']), conversation('c2', ['my-sub', 'peer-b'])],
      [conversation('c1', ['my-sub', 'peer-a']), conversation('c2', ['my-sub', 'peer-b'])],
      [
        message('m1', 'c1', 'peer-a', '2026-06-20T10:00:00.000Z'),
        message('m2', 'c2', 'peer-b', '2026-06-20T11:00:00.000Z'),
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

  it('aggregates duplicate direct threads under one read cursor', () => {
    const kept = conversation('c-new', ['my-sub', 'other-sub']);
    const duplicate = conversation('c-old', ['my-sub', 'other-sub']);
    const scope = resolveReadScopeKey(kept, 'me', 'my-sub', handleToSub);
    markConversationRead('my-sub', 'me', scope, '2026-06-20T11:00:00.000Z', 'c-new');

    const counts = computeUnreadCounts(
      [kept],
      [kept, duplicate],
      [
        message('m-old', 'c-old', 'other', '2026-06-20T10:00:00.000Z'),
        message('m-new', 'c-new', 'other', '2026-06-20T11:00:00.000Z'),
      ],
      null,
      'me',
      'my-sub',
      new Map(),
      handleToSub,
    );

    expect(counts.get('c-new')).toBe(0);
  });

  it('uses the newest loaded message when marking a thread read', () => {
    const conv = conversation('c1');
    const readAt = readThroughTimestampForConversation(
      conv,
      [conv],
      [
        message('m1', 'c1', 'other', '2026-06-20T10:00:00.000Z'),
        message('m2', 'c1', 'other', '2026-06-20T12:00:00.000Z'),
      ],
      'me',
      'my-sub',
      handleToSub,
    );

    expect(readAt).toBe('2026-06-20T12:00:00.000Z');
  });
});
