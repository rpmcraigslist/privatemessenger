import { describe, expect, it } from 'vitest';
import type { MessageModel } from './amplify';
import {
  applyGlobalMessageSnapshot,
  mergeConversationMessages,
  mergeMessages,
  removeMessageById,
} from './message-merge';

function msg(
  id: string,
  conversationId: string,
  createdAt = '2026-06-20T12:00:00.000Z',
): MessageModel {
  return {
    id,
    conversationId,
    senderUsername: 'alice',
    participantUsernames: ['sub-a', 'sub-b'],
    createdAt,
    updatedAt: createdAt,
  } as MessageModel;
}

describe('message-merge', () => {
  it('mergeMessages updates by id without removing deleted rows', () => {
    const existing = [msg('1', 'c1'), msg('2', 'c1')];
    const incoming = [msg('1', 'c1', '2026-06-20T13:00:00.000Z')];
    const merged = mergeMessages(existing, incoming);
    expect(merged.map((m) => m.id).sort()).toEqual(['1', '2']);
  });

  it('mergeConversationMessages keeps optimistic sends not yet in subscription', () => {
    const optimistic = msg('new-1', 'c1');
    const existing = [msg('1', 'c1'), optimistic, msg('3', 'c2')];
    const incoming = [msg('1', 'c1')];
    const result = mergeConversationMessages(
      existing,
      'c1',
      incoming,
      new Set(['new-1']),
    );
    expect(result.map((m) => m.id).sort()).toEqual(['1', '3', 'new-1']);
  });

  it('mergeConversationMessages drops deleted rows for that conversation', () => {
    const existing = [msg('1', 'c1'), msg('2', 'c1'), msg('3', 'c2')];
    const incoming = [msg('1', 'c1')];
    const result = mergeConversationMessages(existing, 'c1', incoming);
    expect(result.map((m) => m.id).sort()).toEqual(['1', '3']);
  });

  it('applyGlobalMessageSnapshot replaces synced data but keeps optimistic sends', () => {
    const snapshot = [msg('1', 'c1')];
    const optimistic = msg('opt-1', 'c1');
    const existing = [msg('1', 'c1'), msg('2', 'c1'), optimistic];
    const result = applyGlobalMessageSnapshot(existing, snapshot, new Set(['opt-1']));
    expect(result.map((m) => m.id).sort()).toEqual(['1', 'opt-1']);
  });

  it('applyGlobalMessageSnapshot keeps freshly subscribed messages missing from the poll', () => {
    const now = Date.parse('2026-07-31T18:00:10.000Z');
    const snapshot = [msg('1', 'c1', '2026-07-31T17:00:00.000Z')];
    const fresh = msg('fresh', 'c1', '2026-07-31T18:00:05.000Z');
    const result = applyGlobalMessageSnapshot(
      [msg('1', 'c1'), fresh],
      snapshot,
      new Set(),
      new Map(),
      { nowMs: now, retainNewerThanMs: 15_000 },
    );
    expect(result.map((m) => m.id).sort()).toEqual(['1', 'fresh']);
  });

  it('applyGlobalMessageSnapshot keeps pending optimistic sends not yet in local state', () => {
    const snapshot = [msg('1', 'c1')];
    const pending = msg('opt-1', 'c1');
    const pendingMap = new Map([[pending.id, pending]]);
    const result = applyGlobalMessageSnapshot(
      [msg('1', 'c1')],
      snapshot,
      new Set(['opt-1']),
      pendingMap,
    );
    expect(result.map((m) => m.id).sort()).toEqual(['1', 'opt-1']);
  });

  it('removeMessageById filters a single row', () => {
    const existing = [msg('1', 'c1'), msg('2', 'c1')];
    expect(removeMessageById(existing, '2').map((m) => m.id)).toEqual(['1']);
  });
});
