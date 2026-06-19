export const LOGIN_DOMAIN = '@messenger.local';

/** Lower-case handle for comparisons and Cognito preferred_username. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Cognito sign-in username (Amplify Gen 2 requires email-shaped login). */
export function toLoginId(username: string): string {
  return `${normalizeUsername(username)}${LOGIN_DOMAIN}`;
}

export function fromLoginId(loginId: string): string {
  return loginId.replace(/@messenger\.local$/i, '');
}

/** Cognito internal username/sub shape — not a user handle. */
export function isCognitoUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** Best-effort handle from Cognito user attributes in the browser. */
export function usernameFromAttributes(attrs: {
  preferred_username?: string;
  email?: string;
}): string | null {
  if (attrs.preferred_username) {
    const handle = normalizeUsername(attrs.preferred_username);
    if (!isCognitoUuid(handle)) return handle;
  }
  if (attrs.email?.toLowerCase().endsWith(LOGIN_DOMAIN)) {
    return normalizeUsername(fromLoginId(attrs.email));
  }
  return null;
}

/** Cognito login id stored in Conversation/Message owner fields (matches cognito:username). */
export function toParticipantLoginId(username: string): string {
  return toLoginId(fromLoginId(username));
}

/** True if a participant entry matches a login id (supports legacy bare usernames). */
export function participantMatchesLoginId(
  participant: string,
  loginId: string,
): boolean {
  const a = participant.toLowerCase();
  const b = loginId.toLowerCase();
  if (a === b) return true;
  return a === participantHandle(b);
}

export function graphqlErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err && 'errors' in err) {
    const errors = (err as { errors?: { message?: string }[] }).errors;
    if (errors?.length) return errors.map((e) => e.message ?? fallback).join('; ');
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Bare handle from a login id or bare username. */
export function participantHandle(value: string): string {
  return normalizeUsername(fromLoginId(value));
}

export function isValidUsername(value: string): boolean {
  const u = normalizeUsername(value);
  return /^[a-z0-9._-]{3,32}$/.test(u);
}

/** One directory row per username; prefer rows that have signed in (cognitoSub). */
export function dedupeUserProfiles<
  T extends { username: string; cognitoSub?: string | null },
>(profiles: T[]): T[] {
  const byUsername = new Map<string, T>();
  for (const profile of profiles) {
    if (!isValidUsername(profile.username)) continue;
    const existing = byUsername.get(profile.username);
    if (!existing) {
      byUsername.set(profile.username, profile);
      continue;
    }
    if (!existing.cognitoSub && profile.cognitoSub) {
      byUsername.set(profile.username, profile);
    }
  }
  return [...byUsername.values()];
}

export function usernameError(value: string): string | null {
  const u = normalizeUsername(value);
  if (u.length < 3) return 'Username must be at least 3 characters.';
  if (u.length > 32) return 'Username must be 32 characters or fewer.';
  if (!/^[a-z0-9._-]+$/.test(u)) {
    return 'Use letters, numbers, dots, underscores, or hyphens only.';
  }
  return null;
}

/** Normalize optional phone to E.164 (+…). Returns null if empty. */
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\+\d{10,15}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function phoneError(value: string): string | null {
  if (!value.trim()) return null;
  if (normalizePhone(value)) return null;
  return 'Use E.164 format, e.g. +18013684783 (include + and country code).';
}

export function mapAuthError(err: unknown): string {
  const name =
    typeof err === 'object' && err && 'name' in err
      ? String((err as { name: string }).name)
      : '';
  const message =
    typeof err === 'object' && err && 'message' in err
      ? String((err as { message: string }).message)
      : 'Something went wrong.';

  if (name === 'UserAlreadyAuthenticatedException') {
    return 'There is already a signed in user. Sign out first, or use a separate browser profile.';
  }
  if (name === 'UsernameExistsException') {
    return 'That username is already in use.';
  }
  if (name === 'UserNotFoundException' || name === 'NotAuthorizedException') {
    return 'Wrong username or password.';
  }
  if (name === 'InvalidPasswordException') {
    return 'Password must be 8+ chars with upper, lower, number, and symbol.';
  }
  return message;
}

const AVATAR_COLORS = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
  '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784',
  '#aed581', '#ffb74d', '#ff8a65', '#a1887f', '#90a4ae',
];

export function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function initials(value: string): string {
  const name = fromLoginId(value);
  const parts = name.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Never show Cognito internal UUIDs in the UI. */
export function formatUserHandle(handle: string | null | undefined): string {
  if (!handle || isCognitoUuid(handle)) return 'your account';
  const bare = normalizeUsername(fromLoginId(handle));
  if (!isValidUsername(bare)) return 'your account';
  return bare;
}

/** First usable messenger handle from several candidates. */
export function pickUserHandle(
  ...candidates: (string | null | undefined)[]
): string {
  for (const candidate of candidates) {
    if (!candidate || isCognitoUuid(candidate)) continue;
    const bare = normalizeUsername(fromLoginId(candidate));
    if (isValidUsername(bare)) return bare;
  }
  return 'user';
}

export function displayName(username: string): string {
  if (isCognitoUuid(username) || !isValidUsername(normalizeUsername(fromLoginId(username)))) {
    return 'User';
  }
  const bare = fromLoginId(username);
  return bare
    .split(/[.\-_]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ');
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatListTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function conversationTitle(
  participants: (string | null)[],
  name: string | null | undefined,
  mySub: string,
  subToUsername: Map<string, string>,
): string {
  if (name) return name;
  const others = participants.filter((p): p is string => !!p && p !== mySub);
  if (others.length === 0) return 'You';
  const label = (sub: string) => {
    const username = subToUsername.get(sub);
    return username ? displayName(username) : 'User';
  };
  if (others.length === 1) return label(others[0]);
  return others.map(label).join(', ');
}
