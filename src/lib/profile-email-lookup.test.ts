import { describe, expect, it } from 'vitest';
import {
  pickProfileForEmailAlerts,
  profileEmailTarget,
} from '../../amplify/functions/shared/profiles';

describe('pickProfileForEmailAlerts', () => {
  it('prefers a duplicate row that has contactEmail', () => {
    const legacy = {
      id: 'legacy',
      username: 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      cognitoSub: 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      contactEmail: null,
    };
    const canonical = {
      id: 'canonical',
      username: 'lena',
      cognitoSub: 'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      contactEmail: 'lena@example.com',
    };

    const picked = pickProfileForEmailAlerts(
      [legacy, canonical],
      'lena',
      'aaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );

    expect(picked?.id).toBe('canonical');
    expect(profileEmailTarget(picked)?.email).toBe('lena@example.com');
  });

  it('returns null when no profiles exist', () => {
    expect(pickProfileForEmailAlerts([], 'lena', 'sub')).toBeNull();
  });
});
