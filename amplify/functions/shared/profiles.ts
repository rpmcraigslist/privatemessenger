import type { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { fromLoginId, isCognitoUuid, resolveUsernameFromPool } from './cognito';

type DataClient = ReturnType<typeof generateClient<Schema>>;
type UserProfile = Schema['UserProfile']['type'];

function participantHandle(participantId: string): string {
  const value = participantId.trim().toLowerCase();
  if (isCognitoUuid(value)) return value;
  if (value.includes('@')) return fromLoginId(value);
  return value;
}

/** Resolve a conversation/message participant id to a UserProfile row. */
export async function findProfileForParticipant(
  client: DataClient,
  participantId: string,
): Promise<UserProfile | null> {
  const raw = participantId.trim();
  if (!raw) return null;

  if (isCognitoUuid(raw)) {
    const bySub = await client.models.UserProfile.list({
      filter: { cognitoSub: { eq: raw } },
      authMode: 'iam',
    });
    const exact = bySub.data.find((profile) => profile.cognitoSub === raw);
    if (exact) return exact;

    const handle = await resolveUsernameFromPool(raw);
    if (handle) {
      const byUsername = await client.models.UserProfile.list({
        filter: { username: { eq: handle } },
        authMode: 'iam',
      });
      if (byUsername.data[0]) return byUsername.data[0];
    }
  }

  const handle = participantHandle(raw);
  if (!isCognitoUuid(handle)) {
    const byUsername = await client.models.UserProfile.list({
      filter: { username: { eq: handle } },
      authMode: 'iam',
    });
    if (byUsername.data[0]) return byUsername.data[0];
  }

  // Legacy profile rows keyed by internal Cognito id in username.
  if (isCognitoUuid(raw)) {
    const byLegacy = await client.models.UserProfile.list({
      filter: { username: { eq: raw } },
      authMode: 'iam',
    });
    if (byLegacy.data[0]) return byLegacy.data[0];
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

export function profileSmsTarget(
  profile: UserProfile | null | undefined,
): { phone: string } | null {
  if (!profile || profile.smsNotificationsEnabled !== true) return null;
  const phone = profile.phoneNumber?.trim();
  if (!phone) return null;
  return { phone };
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
