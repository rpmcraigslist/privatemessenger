import { describe, expect, it } from 'vitest';
import {
  dedupeUserProfiles,
  isMessageFromSelf,
  isSameMessengerUser,
  matchesSelfSender,
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

  it('matches case-insensitive handles and login ids', () => {
    expect(isSameMessengerUser('Alice', 'alice', 'sub-a', subMap)).toBe(true);
    expect(
      isSameMessengerUser('Alice@messenger.local', 'alice', 'sub-a', subMap),
    ).toBe(true);
  });

  it('matches participant ids that refer to the signed-in user', () => {
    expect(
      isSameMessengerUser(
        'legacy-sub-a',
        'alice',
        'sub-a',
        subMap,
        ['legacy-sub-a'],
      ),
    ).toBe(true);
  });
});

describe('matchesSelfSender', () => {
  it('matches handle, sub, and login id for the signed-in user', () => {
    expect(matchesSelfSender('paul', 'paul', 'sub-paul')).toBe(true);
    expect(matchesSelfSender('sub-paul', 'paul', 'sub-paul')).toBe(true);
    expect(matchesSelfSender('paul@messenger.local', 'paul', 'sub-paul')).toBe(
      true,
    );
    expect(matchesSelfSender('lena', 'paul', 'sub-paul')).toBe(false);
  });
});

describe('isMessageFromSelf', () => {
  const subMap = new Map([
    ['sub-paul', 'paul'],
    ['paul@messenger.local', 'paul'],
    ['sub-lena', 'lena'],
    ['lena@messenger.local', 'lena'],
  ]);
  const handleToSub = new Map([
    ['paul', 'sub-paul'],
    ['lena', 'sub-lena'],
  ]);

  it('treats a brand-new bare-handle message as self', () => {
    expect(
      isMessageFromSelf(
        'paul',
        'paul',
        'sub-paul',
        new Map(),
        new Map(),
        {
          isGroup: false,
          participants: ['sub-paul', 'sub-lena'],
        },
      ),
    ).toBe(true);
  });

  it('treats legacy self subs in 1:1 chats as own messages', () => {
    const legacySelfSub = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(
      isMessageFromSelf(
        legacySelfSub,
        'paul',
        'sub-paul',
        subMap,
        handleToSub,
        {
          isGroup: false,
          participants: ['sub-paul', 'sub-lena'],
        },
      ),
    ).toBe(true);

    expect(
      isMessageFromSelf(
        'legacy-sub-paul',
        'paul',
        'sub-paul',
        subMap,
        handleToSub,
        {
          isGroup: false,
          participants: ['legacy-sub-paul', 'sub-lena'],
        },
      ),
    ).toBe(true);
  });

  it('does not treat the peer legacy sub as own messages', () => {
    expect(
      isMessageFromSelf(
        'sub-lena',
        'paul',
        'sub-paul',
        subMap,
        handleToSub,
        {
          isGroup: false,
          participants: ['sub-paul', 'sub-lena'],
        },
      ),
    ).toBe(false);
  });
});
