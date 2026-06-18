/** Shared Cognito helpers for admin Lambdas. */
export const LOGIN_DOMAIN = '@messenger.local';

type CognitoIdentity = {
  username?: string;
  sub?: string;
  groups?: string[] | null;
  claims?: Record<string, string | string[]>;
};

export function toLoginId(username: string): string {
  return `${username.trim().toLowerCase()}${LOGIN_DOMAIN}`;
}

export function fromLoginId(loginId: string): string {
  return loginId.replace(/@messenger\.local$/i, '').toLowerCase();
}

export function poolId(): string {
  const id = process.env.USER_POOL_ID;
  if (!id) throw new Error('USER_POOL_ID is not configured');
  return id;
}

function claimString(
  claims: Record<string, string | string[]>,
  key: string,
): string | undefined {
  const value = claims[key];
  return typeof value === 'string' ? value : undefined;
}

/** Parse AppSync/Cognito identity from Lambda resolver events. */
export function parseIdentity(identity: unknown): {
  username: string | null;
  loginId: string | null;
  sub: string | null;
  groups: string[];
} {
  if (!identity || typeof identity !== 'object') {
    return { username: null, loginId: null, sub: null, groups: [] };
  }

  const id = identity as CognitoIdentity;
  const claims = id.claims ?? {};

  const groupsRaw = id.groups ?? claims['cognito:groups'];
  const groups = Array.isArray(groupsRaw)
    ? groupsRaw.map(String)
    : typeof groupsRaw === 'string'
      ? [groupsRaw]
      : [];

  const sub =
    (typeof id.sub === 'string' ? id.sub : undefined) ??
    claimString(claims, 'sub') ??
    null;

  const loginId = (
    id.username ??
    claimString(claims, 'username') ??
    claimString(claims, 'cognito:username') ??
    claimString(claims, 'email')
  )?.toLowerCase() ?? null;

  const preferred =
    claimString(claims, 'preferred_username') ??
    claimString(claims, 'cognito:preferred_username');

  const username = preferred
    ? preferred.toLowerCase()
    : loginId
      ? fromLoginId(loginId)
      : null;

  return { username, loginId, sub, groups };
}

export function callerUsername(identity: unknown): string | null {
  return parseIdentity(identity).username;
}

export function callerLoginId(identity: unknown): string | null {
  const { loginId, username } = parseIdentity(identity);
  return loginId ?? (username ? toLoginId(username) : null);
}

export function callerSub(identity: unknown): string | null {
  return parseIdentity(identity).sub;
}

export function isAdminGroupMember(identity: unknown): boolean {
  return parseIdentity(identity).groups.includes('Admin');
}
