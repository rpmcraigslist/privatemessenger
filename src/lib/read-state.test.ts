import { beforeEach, describe, expect, it } from 'vitest';
import type { MessageModel } from './amplify';
import {
  countUnreadMessages,
  findLastUnreadMessage,
  getLastReadAt,
  isReadThrough,
  markConversationRead,
} from './read-state';

describe('read-state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('marks and reads conversation cursors', () => {
    markConversationRead('sub-1', 'conv-1', '2026-06-20T12:00:00.000Z');
    expect(getLastReadAt('sub-1', 'conv-1')).toBe('2026-06-20T12:00:00.000Z');
    expect(getLastReadAt('sub-1', 'conv-2')).toBeNull();
  });

  it('treats equal timestamps as read', () => {
    const at = '2026-06-20T12:00:00.000Z';
    expect(isReadThrough(at, at)).toBe(true);
  });

  it('counts only messages from others after the read cursor', () => {
    const subMap = new Map<string, string>();
    const messages: MessageModel[] = [
      {
        id: '1',
        conversationId: 'conv-1',
        senderUsername: 'alice',
        participantUsernames: ['my-sub'],
        createdAt: '2026-06-20T11:00:00.000Z',
        updatedAt: '2026-06-20T11:00:00.000Z',
      } as MessageModel,
      {
        id: '2',
        conversationId: 'conv-1',
        senderUsername: 'bob',
        participantUsernames: ['my-sub'],
        createdAt: '2026-06-20T12:00:00.000Z',
        updatedAt: '2026-06-20T12:00:00.000Z',
      } as MessageModel,
      {
        id: '3',
        conversationId: 'conv-1',
        senderUsername: 'bob',
        participantUsernames: ['my-sub'],
        createdAt: '2026-06-20T13:00:00.000Z',
        updatedAt: '2026-06-20T13:00:00.000Z',
      } as MessageModel,
      {
        id: '4',
        conversationId: 'conv-1',
        senderUsername: 'me',
        participantUsernames: ['my-sub'],
        createdAt: '2026-06-20T14:00:00.000Z',
        updatedAt: '2026-06-20T14:00:00.000Z',
      } as MessageModel,
    ];

    expect(
      countUnreadMessages(
        messages,
        '2026-06-20T12:00:00.000Z',
        'me',
        'my-sub',
        subMap,
      ),
    ).toBe(1);

    expect(
      countUnreadMessages(
        messages,
        '2026-06-20T13:00:00.000Z',
        'me',
        'my-sub',
        subMap,
      ),
    ).toBe(0);
  });

  it('findLastUnreadMessage returns the newest unread from others', () => {
    const subMap = new Map<string, string>();
    const messages: MessageModel[] = [
      {
        id: '1',
        conversationId: 'conv-1',
        senderUsername: 'bob',
        participantUsernames: ['my-sub'],
        createdAt: '2026-06-20T11:00:00.000Z',
        updatedAt: '2026-06-20T11:00:00.000Z',
      } as MessageModel,
      {
        id: '2',
        conversationId: 'conv-1',
        senderUsername: 'bob',
        participantUsernames: ['my-sub'],
        createdAt: '2026-06-20T12:00:00.000Z',
        updatedAt: '2026-06-20T12:00:00.000Z',
      } as MessageModel,
      {
        id: '3',
        conversationId: 'conv-1',
        senderUsername: 'me',
        participantUsernames: ['my-sub'],
        createdAt: '2026-06-20T13:00:00.000Z',
        updatedAt: '2026-06-20T13:00:00.000Z',
      } as MessageModel,
    ];

    expect(
      findLastUnreadMessage(
        messages,
        '2026-06-20T10:00:00.000Z',
        'me',
        'my-sub',
        subMap,
      )?.id,
    ).toBe('2');

    expect(
      findLastUnreadMessage(
        messages,
        '2026-06-20T12:00:00.000Z',
        'me',
        'my-sub',
        subMap,
      ),
    ).toBeNull();
  });
});
