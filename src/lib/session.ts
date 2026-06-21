import {
  confirmSignIn,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn,
  signOut,
  type SignInOutput,
} from 'aws-amplify/auth';
import { client } from './amplify';
import {
  isCognitoUuid,
  normalizeUsername,
  pickUserHandle,
  toLoginId,
  usernameFromAttributes,
} from './util';

export type SessionUser = {
  username: string;
  cognitoSub: string;
  isAdmin: boolean;
  phoneNumber: string | null;
  smsNotificationsEnabled: boolean;
  profileId: string | null;
};

export type ProfileUpdate = {
  phoneNumber: string | null;
  smsNotificationsEnabled: boolean;
};

const LAST_HANDLE_KEY = 'messenger:lastHandle';

/** Remember the handle typed at sign-in (per browser tab/session). */
export function rememberSignInHandle(handle: string): void {
  const normalized = normalizeUsername(handle);
  if (!isCognitoUuid(normalized)) {
    sessionStorage.setItem(LAST_HANDLE_KEY, normalized);
  }
}

export function clearRememberedSignInHandle(): void {
  sessionStorage.removeItem(LAST_HANDLE_KEY);
}

function recalledSignInHandle(): string | null {
  const value = sessionStorage.getItem(LAST_HANDLE_KEY);
  if (!value || isCognitoUuid(value)) return null;
  return normalizeUsername(value);
}

function resolveHandleFromTokens(
  attrs: Awaited<ReturnType<typeof fetchUserAttributes>>,
  session: Awaited<ReturnType<typeof fetchAuthSession>>,
): string | null {
  const fromAttrs = usernameFromAttributes(attrs);
  if (fromAttrs) return fromAttrs;

  const idPayload = session.tokens?.idToken?.payload;
  if (idPayload) {
    const preferred = idPayload['preferred_username'];
    if (typeof preferred === 'string' && !isCognitoUuid(preferred)) {
      return normalizeUsername(preferred);
    }
    const email = idPayload.email;
    if (typeof email === 'string') {
      return usernameFromAttributes({ email, preferred_username: undefined });
    }
  }

  return recalledSignInHandle();
}

export async function resolveCurrentSub(): Promise<string> {
  const session = await fetchAuthSession();
  const sub =
    session.tokens?.accessToken?.payload.sub ??
    session.tokens?.idToken?.payload.sub;
  if (typeof sub !== 'string') {
    throw new Error('Not authenticated');
  }
  return sub;
}

export async function syncMyProfile(
  update?: ProfileUpdate,
): Promise<SessionUser> {
  await getCurrentUser();
  const session = await fetchAuthSession();
  if (!session.tokens?.accessToken) {
    throw new Error('Not authenticated');
  }

  const attrs = await fetchUserAttributes();
  const resolvedHandle = resolveHandleFromTokens(attrs, session);

  const mutationArgs: {
    phoneNumber?: string;
    smsNotificationsEnabled?: boolean;
  } = {};

  if (update) {
    mutationArgs.phoneNumber = update.phoneNumber ?? '';
    mutationArgs.smsNotificationsEnabled = update.smsNotificationsEnabled;
  }

  const { data, errors } = await client.mutations.syncMyProfile(mutationArgs);
  if (errors?.length || !data) {
    throw new Error(errors?.[0]?.message ?? 'Profile sync failed');
  }

  const username = pickUserHandle(
    resolvedHandle,
    recalledSignInHandle(),
    data.username,
  );
  rememberSignInHandle(username);

  return {
    username,
    cognitoSub: data.cognitoSub,
    isAdmin: data.role === 'admin',
    phoneNumber: data.phoneNumber ?? null,
    smsNotificationsEnabled: data.smsNotificationsEnabled,
    profileId: data.profileId,
  };
}

export async function resolveCurrentUser(): Promise<SessionUser> {
  return syncMyProfile();
}

export async function ensureValidSession(): Promise<boolean> {
  try {
    await resolveCurrentUser();
    return true;
  } catch (err) {
    console.error('session validation failed', err);
    try {
      await signOutAndClear();
    } catch {
      // ignore
    }
    return false;
  }
}

export async function signInWithUsername(
  username: string,
  password: string,
): Promise<SignInOutput> {
  rememberSignInHandle(username);
  try {
    const session = await fetchAuthSession();
    if (session.tokens?.accessToken) {
      await signOut();
    }
  } catch {
    // ignore — no active session
  }
  return signIn({ username: toLoginId(username), password });
}

export async function completeNewPassword(newPassword: string) {
  return confirmSignIn({ challengeResponse: newPassword });
}

export async function signOutAndClear(): Promise<void> {
  clearRememberedSignInHandle();
  await signOut();
}

/** Cognito sign-in id (matches participants before sub-based chats). */
export async function resolveCurrentLoginId(): Promise<string> {
  const session = await fetchAuthSession();
  const fromToken =
    session.tokens?.idToken?.payload['cognito:username'] ??
    session.tokens?.idToken?.payload.username;
  if (typeof fromToken === 'string') return fromToken.toLowerCase();
  const { username } = await getCurrentUser();
  return username.toLowerCase();
}
