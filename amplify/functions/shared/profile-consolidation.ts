import type { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { isCognitoUuid } from './cognito';

export type DataClient = ReturnType<typeof generateClient<Schema>>;
export type UserProfile = Schema['UserProfile']['type'];

const VALID_HANDLE = /^[a-z0-9._-]{3,32}$/;

export function isValidMessengerHandle(handle: string): boolean {
  const normalized = handle.trim().toLowerCase();
  return VALID_HANDLE.test(normalized) && !isCognitoUuid(normalized);
}

export async function listProfilesForUser(
  client: DataClient,
  username: string,
  sub: string,
): Promise<UserProfile[]> {
  const handle = username.trim().toLowerCase();

  const byUsername = await client.models.UserProfile.list({
    filter: { username: { eq: handle } },
    authMode: 'iam',
  });

  const merged = new Map<string, UserProfile>();
  for (const profile of byUsername.data) {
    merged.set(profile.id, profile);
  }

  if (sub) {
    const bySub = await client.models.UserProfile.list({
      filter: { cognitoSub: { eq: sub } },
      authMode: 'iam',
    });
    for (const profile of bySub.data) {
      merged.set(profile.id, profile);
    }

    const byLegacyUsername = await client.models.UserProfile.list({
      filter: { username: { eq: sub } },
      authMode: 'iam',
    });
    for (const profile of byLegacyUsername.data) {
      merged.set(profile.id, profile);
    }
  }

  return [...merged.values()];
}

export function pickProfileKeeper(
  profiles: UserProfile[],
  username: string,
  sub: string | null,
): UserProfile {
  const handle = username.trim().toLowerCase();
  return (
    profiles.find((p) => p.username === handle && p.cognitoSub === sub) ??
    profiles.find((p) => p.username === handle && p.cognitoSub) ??
    profiles.find((p) => p.username === handle) ??
    profiles.find((p) => p.cognitoSub === sub) ??
    profiles[0]
  );
}

/** Delete duplicate profile rows for one person; return the canonical row. */
export async function consolidateUserProfiles(
  client: DataClient,
  username: string,
  sub: string,
): Promise<UserProfile | null> {
  const profiles = await listProfilesForUser(client, username, sub);
  if (profiles.length === 0) return null;

  const keeper = pickProfileKeeper(profiles, username, sub);

  for (const profile of profiles) {
    if (profile.id !== keeper.id) {
      await client.models.UserProfile.delete(
        { id: profile.id },
        { authMode: 'iam' },
      );
    }
  }

  return keeper;
}

export type CognitoUserLink = {
  username: string;
  cognitoSub: string | null;
  contactEmail?: string | null;
};

/**
 * Ensure exactly one UserProfile row for a Cognito user.
 * Never creates a second row when one already exists for the handle or sub.
 */
export async function ensureProfileForCognitoUser(
  client: DataClient,
  user: CognitoUserLink,
): Promise<UserProfile | null> {
  const handle = user.username.trim().toLowerCase();
  if (!isValidMessengerHandle(handle)) return null;

  const sub = user.cognitoSub ?? '';
  const existing = await listProfilesForUser(client, handle, sub);

  if (existing.length > 0) {
    const keeper = await consolidateUserProfiles(client, handle, sub);
    if (!keeper) return null;

    const rawTitle = keeper.displayName?.trim();
    const displayName =
      rawTitle && !isCognitoUuid(rawTitle) ? rawTitle : handle;

    const { data: updated } = await client.models.UserProfile.update(
      {
        id: keeper.id,
        username: handle,
        cognitoSub: user.cognitoSub ?? keeper.cognitoSub,
        displayName,
        contactEmail: user.contactEmail?.trim() || keeper.contactEmail,
      },
      { authMode: 'iam' },
    );
    return updated ?? keeper;
  }

  if (user.cognitoSub) {
    const bySubOnly = await client.models.UserProfile.list({
      filter: { cognitoSub: { eq: user.cognitoSub } },
      authMode: 'iam',
    });
    if (bySubOnly.data.length > 0) {
      const keeper = await consolidateUserProfiles(client, handle, sub);
      return keeper;
    }
  }

  const { data: created } = await client.models.UserProfile.create(
    {
      username: handle,
      cognitoSub: user.cognitoSub,
      displayName: handle,
      role: 'user',
      contactEmail: user.contactEmail?.trim() || null,
      avatarColor: '#64b5f6',
    },
    { authMode: 'iam' },
  );
  return created ?? null;
}
