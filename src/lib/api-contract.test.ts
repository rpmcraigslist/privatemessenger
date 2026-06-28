import { describe, expect, it } from 'vitest';
import outputs from '../../amplify_outputs.json';
import {
  assertAmplifyOutputsMatchContract,
  sessionUserFromSyncProfile,
} from './api-contract';
import {
  buildSyncProfileResponse,
  resolveContactEmailAfterSync,
} from '../../amplify/functions/shared/profile-sync-logic';

describe('api-contract', () => {
  it('amplify_outputs.json matches client and email delivery contracts', () => {
    const issues = assertAmplifyOutputsMatchContract(
      outputs as Parameters<typeof assertAmplifyOutputsMatchContract>[0],
    );
    expect(issues).toEqual([]);
  });

  it('sessionUserFromSyncProfile maps a valid sync payload', () => {
    const user = sessionUserFromSyncProfile(
      {
        profileId: 'profile-1',
        username: 'paul',
        cognitoSub: 'sub-paul',
        role: 'user',
        contactEmail: 'paul@example.com',
      },
      'paul',
      null,
    );
    expect(user.username).toBe('paul');
    expect(user.cognitoSub).toBe('sub-paul');
    expect(user.contactEmail).toBe('paul@example.com');
    expect(user.isAdmin).toBe(false);
  });

  it('sessionUserFromSyncProfile rejects empty profileId', () => {
    expect(() =>
      sessionUserFromSyncProfile(
        {
          profileId: '',
          username: 'paul',
          cognitoSub: 'sub-paul',
          role: 'user',
        },
        'paul',
        null,
      ),
    ).toThrow(/profileId/i);
  });
});

describe('profile-sync-logic', () => {
  it('keeps existing email when mutation omits contactEmail', () => {
    expect(
      resolveContactEmailAfterSync({
        existing: 'keep@example.com',
        emailArg: undefined,
      }),
    ).toBe('keep@example.com');
  });

  it('clears email when mutation sends empty string', () => {
    expect(
      resolveContactEmailAfterSync({
        existing: 'old@example.com',
        emailArg: '',
      }),
    ).toBeNull();
  });

  it('rejects messenger login ids as contact email', () => {
    expect(() =>
      resolveContactEmailAfterSync({
        existing: null,
        emailArg: 'paul@messenger.local',
      }),
    ).toThrow(/valid email/i);
  });

  it('buildSyncProfileResponse requires profileId', () => {
    expect(() =>
      buildSyncProfileResponse('', 'paul', 'sub-paul', 'user', null, '#005c4b'),
    ).toThrow(/not created/i);
  });
});
