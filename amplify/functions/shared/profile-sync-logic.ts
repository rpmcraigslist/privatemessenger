import { normalizeContactEmail } from './cognito';

export type ContactEmailUpdate = {
  existing: string | null | undefined;
  emailArg: string | null | undefined;
};

/** Resolve contact email after syncMyProfile mutation input (pure, testable). */
export function resolveContactEmailAfterSync({
  existing,
  emailArg,
}: ContactEmailUpdate): string | null {
  if (emailArg === undefined || emailArg === null) {
    return existing ?? null;
  }
  const trimmed = emailArg.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeContactEmail(trimmed);
  if (!normalized) {
    throw new Error('Enter a valid email address');
  }
  return normalized;
}

export type SyncProfileResponse = {
  profileId: string;
  username: string;
  cognitoSub: string;
  role: string;
  contactEmail: string | null;
  messageBubbleColor: string;
};

export function buildSyncProfileResponse(
  profileId: string,
  username: string,
  cognitoSub: string,
  role: string,
  contactEmail: string | null,
  messageBubbleColor: string,
): SyncProfileResponse {
  if (!profileId.trim()) {
    throw new Error('Profile row was not created');
  }
  return {
    profileId,
    username,
    cognitoSub,
    role,
    contactEmail,
    messageBubbleColor,
  };
}
