import { describe, expect, it } from 'vitest';

import {
  normalizeUsername,
  usernameValidationError,
} from '../../amplify/functions/shared/username';

describe('username validation (account request)', () => {
  it('normalizes handles to lowercase', () => {
    expect(normalizeUsername('  Steve  ')).toBe('steve');
  });

  it('accepts valid usernames', () => {
    expect(usernameValidationError('steve')).toBeNull();
    expect(usernameValidationError('user.name_1')).toBeNull();
  });

  it('rejects invalid usernames', () => {
    expect(usernameValidationError('ab')).toContain('3 characters');
    expect(usernameValidationError('bad name')).toContain('letters');
  });
});
