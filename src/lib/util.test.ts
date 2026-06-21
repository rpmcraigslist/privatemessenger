import { describe, expect, it } from 'vitest';
import {
  dedupeDirectConversations,
  dedupeUserProfiles,
  isSameMessengerUser,
  repairParticipantSubs,
} from './util';

describe('dedupeUserProfiles', () => {
  it('keeps one row per cognito sub', () => {
    const result = dedupeUserProfiles([
      { username: 'alice', cognitoSub: 'sub-a', id: '1' },
      { username: 'alice', cognitoSub: null, id: '2' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.cognitoSub).toBe('sub-a');
  });

  it('drops legacy uuid username rows', () => {
    const result = dedupeUserProfiles([
      {
        username: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        cognitoSub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      },
      { username: 'alice', cognitoSub: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.username).toBe('alice');
  });

  it('does not return two entries for the same person with different profile ids', () => {
    const result = dedupeUserProfiles([
      { username: 'bob', cognitoSub: 'sub-b', id: '10' },
      { username: 'bob', cognitoSub: 'sub-b', id: '11' },
    ]);

    expect(result).toHaveLength(1);
  });

  it('never shows two rows for the same username with different subs', () => {
    const result = dedupeUserProfiles([
      { username: 'lena', cognitoSub: 'sub-real', id: '1' },
      { username: 'lena', cognitoSub: 'sub-stale', id: '2' },
      { username: 'lena', cognitoSub: null, id: '3' },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.cognitoSub).toBe('sub-real');
  });
});

describe('repairParticipantSubs', () => {
  const handleToSub = new Map([['bob', 'sub-b']]);

  it('maps login ids and handles to cognito subs', () => {
    const result = repairParticipantSubs(
      ['alice@messenger.local', 'sub-b', 'bob'],
      'alice',
      'sub-a',
      handleToSub,
    );
    expect(result.sort()).toEqual(['sub-a', 'sub-b']);
  });
});

describe('dedupeDirectConversations', () => {
  const handleToSub = new Map([['lena', 'sub-lena']]);

  it('keeps one 1:1 thread when legacy and current participant ids refer to the same person', () => {
    const stale = {
      id: 'stale',
      isGroup: false,
      participants: ['sub-paul', 'lena'],
      lastMessageAt: '2026-06-20T11:00:00.000Z',
    };
    const current = {
      id: 'current',
      isGroup: false,
      participants: ['sub-paul', 'sub-lena'],
      lastMessageAt: '2026-06-20T12:00:00.000Z',
    };

    const result = dedupeDirectConversations(
      [stale, current],
      (conversation) => conversation.lastMessageAt ?? '',
      'paul',
      'sub-paul',
      handleToSub,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('current');
  });
});

describe('isSameMessengerUser', () => {
  const subMap = new Map([
    ['sub-a', 'alice'],
    ['alice@messenger.local', 'alice'],
  ]);

  it('matches username, sub, and login id forms', () => {
    expect(isSameMessengerUser('alice', 'alice', 'sub-a', subMap)).toBe(true);
    expect(isSameMessengerUser('sub-a', 'alice', 'sub-a', subMap)).toBe(true);
    expect(
      isSameMessengerUser('alice@messenger.local', 'alice', 'sub-a', subMap),
    ).toBe(true);
    expect(isSameMessengerUser('bob', 'alice', 'sub-a', subMap)).toBe(false);
  });
});
