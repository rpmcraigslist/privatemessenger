import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageModel } from './amplify';
import {
  countUnreadMessages,
  findLastUnreadMessage,
  getLastReadAt,
  isReadThrough,
  markConversationRead,
  markConversationReadThrough,
  resolveReadScopeKey,
} from './read-state';

vi.mock('./read-state-sync', () => ({
  getServerLastReadAt: () => null,
  mergeServerLastReadAt: vi.fn(),
  loadServerReadState: vi.fn(),
  resetReadStateSync: vi.fn(),
  flushReadStateNow: vi.fn(),
  installReadStateFlushHooks: vi.fn(),
}));

const SCOPE = 'conv:conv-1';

describe('read-state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('marks and reads conversation cursors', () => {
    markConversationRead('sub-1', 'alice', SCOPE, '2026-06-20T12:00:00.000Z', 'conv-1');
    expect(getLastReadAt('sub-1', 'alice', SCOPE, 'conv-1')).toBe(
      '2026-06-20T12:00:00.000Z',
    );
    expect(getLastReadAt('sub-1', 'alice', 'conv:conv-2')).toBeNull();
  });

  it('falls back to username-scoped read cursor keys', () => {
    markConversationRead('old-sub', 'alice', SCOPE, '2026-06-20T12:00:00.000Z', 'conv-1');
    expect(getLastReadAt('new-sub', 'alice', SCOPE, 'conv-1')).toBe(
      '2026-06-20T12:00:00.000Z',
    );
  });

  it('uses stable peer scope keys for direct chats', () => {
    const scope = resolveReadScopeKey(
      {
        id: 'conv-old',
        isGroup: false,
        participants: ['sub-a', 'sub-b'],
      },
      'alice',
      'sub-a',
      new Map(),
    );
    expect(scope).toBe('peer:sub-a:sub-b');
    markConversationRead('sub-a', 'alice', scope, '2026-06-20T12:00:00.000Z', 'conv-new');
    expect(getLastReadAt('sub-a', 'alice', scope, 'conv-old')).toBe(
      '2026-06-20T12:00:00.000Z',
    );
  });

  it('treats equal timestamps as read', () => {
    const at = '2026-06-20T12:00:00.000Z';
    expect(isReadThrough(at, at)).toBe(true);
  });

  it('marks through the latest message timestamp in the list', () => {
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
        createdAt: '2026-06-20T13:00:00.000Z',
        updatedAt: '2026-06-20T13:00:00.000Z',
      } as MessageModel,
    ];

    expect(
      markConversationReadThrough('sub-1', 'alice', SCOPE, messages, 'conv-1'),
    ).toBe(true);
    expect(getLastReadAt('sub-1', 'alice', SCOPE, 'conv-1')).toBe(
      '2026-06-20T13:00:00.000Z',
    );
    expect(
      countUnreadMessages(messages, getLastReadAt('sub-1', 'alice', SCOPE, 'conv-1'), 'alice', 'sub-1', new Map(), new Map()),
    ).toBe(0);
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
        new Map(),
      ),
    ).toBe(1);

    expect(
      countUnreadMessages(
        messages,
        '2026-06-20T13:00:00.000Z',
        'me',
        'my-sub',
        subMap,
        new Map(),
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
        new Map(),
      )?.id,
    ).toBe('2');

    expect(
      findLastUnreadMessage(
        messages,
        '2026-06-20T12:00:00.000Z',
        'me',
        'my-sub',
        subMap,
        new Map(),
      ),
    ).toBeNull();
  });
});
