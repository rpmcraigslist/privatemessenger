import type { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { fromLoginId, isCognitoUuid, resolveUsernameFromPool } from './cognito';
import { listProfilesForUser, pickProfileKeeper } from './profile-consolidation';

type DataClient = ReturnType<typeof generateClient<Schema>>;
type UserProfile = Schema['UserProfile']['type'];

function participantHandle(participantId: string): string {
  const value = participantId.trim().toLowerCase();
  if (isCognitoUuid(value)) return value;
  if (value.includes('@')) return fromLoginId(value);
  return value;
}

/** Prefer a profile row that actually has a contact email (duplicate-row safe). */
export function pickProfileForEmailAlerts(
  profiles: UserProfile[],
  username: string | null,
  sub: string | null,
): UserProfile | null {
  if (profiles.length === 0) return null;

  const withEmail = profiles.filter((profile) => profileEmailTarget(profile));
  if (withEmail.length > 0) {
    if (username) {
      return pickProfileKeeper(withEmail, username, sub);
    }
    return withEmail[0];
  }

  if (username) {
    return pickProfileKeeper(profiles, username, sub);
  }

  return profiles[0];
}

async function profilesForSub(
  client: DataClient,
  sub: string,
): Promise<UserProfile[]> {
  const bySub = await client.models.UserProfile.list({
    filter: { cognitoSub: { eq: sub } },
    authMode: 'iam',
  });
  const byLegacy = await client.models.UserProfile.list({
    filter: { username: { eq: sub } },
    authMode: 'iam',
  });
  const merged = new Map<string, UserProfile>();
  for (const profile of [...bySub.data, ...byLegacy.data]) {
    merged.set(profile.id, profile);
  }
  return [...merged.values()];
}

/** Resolve a conversation/message participant id to a UserProfile row. */
export async function findProfileForParticipant(
  client: DataClient,
  participantId: string,
): Promise<UserProfile | null> {
  const raw = participantId.trim();
  if (!raw) return null;

  if (isCognitoUuid(raw)) {
    const handle = await resolveUsernameFromPool(raw);
    if (handle) {
      const profiles = await listProfilesForUser(client, handle, raw);
      return pickProfileForEmailAlerts(profiles, handle, raw);
    }

    const profiles = await profilesForSub(client, raw);
    return pickProfileForEmailAlerts(profiles, null, raw);
  }

  const handle = participantHandle(raw);
  if (!isCognitoUuid(handle)) {
    const profiles = await listProfilesForUser(client, handle, '');
    return pickProfileForEmailAlerts(profiles, handle, null);
  }

  return null;
}

export function isParticipantSender(
  participantId: string,
  callerSub: string | null,
  callerUsername: string | null,
): boolean {
  const raw = participantId.trim();
  if (!raw) return false;
  if (callerSub && raw === callerSub) return true;
  if (!callerUsername) return false;

  const caller = callerUsername.toLowerCase();
  const handle = participantHandle(raw);
  return handle === caller;
}

/** Real-world email saved on profile for new-message alerts. */
export function profileEmailTarget(
  profile: UserProfile | null | undefined,
): { email: string } | null {
  if (!profile) return null;
  const email = profile.contactEmail?.trim();
  if (!email) return null;
  if (email.toLowerCase().endsWith('@messenger.local')) return null;
  return { email };
}
