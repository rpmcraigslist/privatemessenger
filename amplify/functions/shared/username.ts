/** Lower-case handle for comparisons and Cognito preferred_username. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function usernameValidationError(value: string): string | null {
  const handle = normalizeUsername(value);
  if (!handle) return 'Enter the username you want.';
  if (handle.length < 3) return 'Username must be at least 3 characters.';
  if (handle.length > 32) return 'Username must be 32 characters or fewer.';
  if (!/^[a-z0-9._-]+$/.test(handle)) {
    return 'Use letters, numbers, dots, underscores, or hyphens only.';
  }
  return null;
}
