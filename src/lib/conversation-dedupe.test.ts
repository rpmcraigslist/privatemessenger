import { describe, expect, it } from 'vitest';
import type { ConversationModel, MessageModel } from './amplify';
import {
  dedupeDirectConversations,
  pickPreferredDirectConversation,
} from './conversation-dedupe';

const mySub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const markSub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const handleToSub = new Map([['mark', markSub]]);

function conversation(
  id: string,
  participants: string[],
  lastMessageAt = '2026-08-01T12:00:00.000Z',
): ConversationModel {
  return {
    id,
    participants,
    isGroup: false,
    lastMessageAt,
    createdAt: lastMessageAt,
  } as ConversationModel;
}

function message(id: string, conversationId: string): MessageModel {
  return {
    id,
    conversationId,
    senderUsername: 'mark',
    participantUsernames: [mySub, markSub],
    createdAt: '2026-08-01T12:00:00.000Z',
  } as MessageModel;
}

describe('conversation-dedupe', () => {
  it('keeps the duplicate with more messages', () => {
    const active = conversation('active', [mySub, markSub], '2026-08-01T10:00:00.000Z');
    const empty = conversation('empty', [mySub, 'mark'], '2026-08-02T12:00:00.000Z');
    const result = dedupeDirectConversations(
      [empty, active],
      'me',
      mySub,
      handleToSub,
      [message('m1', 'active'), message('m2', 'active')],
      new Map(),
    );
    expect(result.conversations.map((c) => c.id)).toEqual(['active']);
    expect(result.aliasToCanonicalId.get('empty')).toBe('active');
  });

  it('pickPreferredDirectConversation uses recent activity when counts tie', () => {
    const older = conversation('older', [mySub, markSub], '2026-08-01T10:00:00.000Z');
    const newer = conversation('newer', [mySub, markSub], '2026-08-02T10:00:00.000Z');
    const winner = pickPreferredDirectConversation(
      [older, newer],
      new Map(),
      new Map(),
    );
    expect(winner.id).toBe('newer');
  });
});
