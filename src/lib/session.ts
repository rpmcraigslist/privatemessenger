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
import { isCognitoUuid, toLoginId, usernameFromAttributes } from './util';

export type SessionUser = {
  username: string;
  cognitoSub: string;
  isAdmin: boolean;
  phoneNumber: string | null;
  profileId: string | null;
};

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
  phoneNumber?: string | null,
): Promise<SessionUser> {
  await getCurrentUser();
  const session = await fetchAuthSession();
  if (!session.tokens?.accessToken) {
    throw new Error('Not authenticated');
  }

  const attrs = await fetchUserAttributes();
  const attrUsername = usernameFromAttributes(attrs);

  const { data, errors } = await client.mutations.syncMyProfile({
    phoneNumber: phoneNumber ?? attrs.phone_number ?? undefined,
  });
  if (errors?.length || !data) {
    throw new Error(errors?.[0]?.message ?? 'Profile sync failed');
  }

  const username =
    !isCognitoUuid(data.username)
      ? data.username
      : (attrUsername ?? data.username);

  return {
    username,
    cognitoSub: data.cognitoSub,
    isAdmin: data.role === 'admin',
    phoneNumber: phoneNumber ?? attrs.phone_number ?? null,
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
  } catch {
    try {
      await signOut();
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
  try {
    await signOut();
  } catch {
    // ignore — no active session
  }
  return signIn({ username: toLoginId(username), password });
}

export async function completeNewPassword(newPassword: string) {
  return confirmSignIn({ challengeResponse: newPassword });
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
