import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationModel, MessageModel } from './amplify';
import { markConversationRead } from './read-state';
import { computeUnreadCounts, totalUnreadCount } from './unread-counts';

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
    );

    expect(counts.get('c1')).toBe(0);
    expect(counts.get('c2')).toBe(1);
  });

  it('updates after a conversation is marked read', () => {
    markConversationRead('my-sub', 'c2', '2026-06-20T11:00:00.000Z');

    const counts = computeUnreadCounts(
      [conversation('c2')],
      [message('m2', 'c2', 'other', '2026-06-20T11:00:00.000Z')],
      null,
      'me',
      'my-sub',
      new Map(),
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
    );

    expect(totalUnreadCount(counts)).toBe(3);
  });
});
