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
import { toLoginId } from './util';

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

  const session = await fetchAuthSession({ forceRefresh: true });

  if (!session.tokens) {

    throw new Error('Not authenticated');

  }



  await getCurrentUser();

  const attrs = await fetchUserAttributes();



  const { data, errors } = await client.mutations.syncMyProfile({

    phoneNumber: phoneNumber ?? attrs.phone_number ?? undefined,

  });

  if (errors?.length || !data) {

    throw new Error(errors?.[0]?.message ?? 'Profile sync failed');

  }



  return {

    username: data.username,

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


