import { describe, expect, it } from 'vitest';
import { dedupeUserProfiles, isSameMessengerUser } from './util';

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
