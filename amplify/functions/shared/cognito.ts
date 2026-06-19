/** Shared Cognito helpers for admin Lambdas. */
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export const LOGIN_DOMAIN = '@messenger.local';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CognitoIdentity = {
  username?: string;
  sub?: string;
  groups?: string[] | null;
  claims?: Record<string, string | string[]>;
};

const cognito = new CognitoIdentityProviderClient({});

export function isCognitoUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

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

function usernameFromEmailClaim(email: string | undefined): string | null {
  if (!email?.toLowerCase().endsWith(LOGIN_DOMAIN)) return null;
  return fromLoginId(email);
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

  const email = claimString(claims, 'email');

  let username =
    preferred?.toLowerCase() ??
    usernameFromEmailClaim(email) ??
    (loginId?.endsWith(LOGIN_DOMAIN) ? fromLoginId(loginId) : null);

  if (username && isCognitoUuid(username)) {
    username = null;
  }

  return { username, loginId, sub, groups };
}

/** Resolve handle from Cognito when AppSync only passes an internal UUID. */
export async function resolveUsernameFromPool(
  sub: string,
): Promise<string | null> {
  const res = await cognito.send(
    new ListUsersCommand({
      UserPoolId: poolId(),
      Filter: `sub = "${sub}"`,
      Limit: 1,
    }),
  );

  const user = res.Users?.[0];
  if (!user) return null;

  const attrs = Object.fromEntries(
    (user.Attributes ?? []).map((a) => [a.Name!, a.Value!]),
  );

  const preferred = attrs.preferred_username?.toLowerCase();
  if (preferred && !isCognitoUuid(preferred)) return preferred;

  return (
    usernameFromEmailClaim(attrs.email) ??
    (user.Username?.toLowerCase().endsWith(LOGIN_DOMAIN)
      ? fromLoginId(user.Username)
      : null)
  );
}

/** Resolve caller handle from AppSync identity, including Cognito pool lookup by sub. */
export async function resolveCallerIdentity(identity: unknown): Promise<{
  username: string | null;
  loginId: string | null;
  sub: string | null;
  groups: string[];
}> {
  const parsed = parseIdentity(identity);
  let { username, loginId, sub, groups } = parsed;

  if (sub && (!username || isCognitoUuid(username))) {
    username = await resolveUsernameFromPool(sub);
  }

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

/** Normalize user-entered phone numbers to E.164 for SNS (+country + digits). */
export function normalizePhoneE164(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/[\s().-]/g, '');
  if (/^\+\d{10,15}$/.test(compact)) return compact;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;

  return null;
}
