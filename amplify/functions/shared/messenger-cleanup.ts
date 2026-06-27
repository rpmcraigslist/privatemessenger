import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Schema } from '../../data/resource';
import type { generateClient } from 'aws-amplify/data';
import { fromLoginId, toLoginId } from './cognito';
import { listProfilesForUser } from './profile-consolidation';
import type { UserParticipantIdentity } from './messenger-reconcile';

export type DataClient = ReturnType<typeof generateClient<Schema>>;

const s3 = new S3Client({});

function storageBucket(): string | null {
  const bucket = process.env.STORAGE_BUCKET_NAME?.trim();
  return bucket || null;
}

export async function deleteStorageObject(
  key: string | null | undefined,
): Promise<boolean> {
  if (!key?.trim()) return false;
  const bucket = storageBucket();
  if (!bucket) return false;

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return true;
  } catch (err) {
    console.error('failed to delete storage object', key, err);
    return false;
  }
}

export async function deleteConversationStoragePrefix(
  conversationId: string,
): Promise<number> {
  const bucket = storageBucket();
  if (!bucket) return 0;

  const prefix = `conversations/${conversationId}/`;
  let deleted = 0;
  let token: string | undefined;

  do {
    const listing = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );

    for (const object of listing.Contents ?? []) {
      if (!object.Key) continue;
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: object.Key,
        }),
      );
      deleted++;
    }

    token = listing.NextContinuationToken;
  } while (token);

  return deleted;
}

export async function deleteMessageStorage(
  message: Pick<Schema['Message']['type'], 'attachmentKey'>,
): Promise<void> {
  await deleteStorageObject(message.attachmentKey);
}

export async function deleteAllReadStates(client: DataClient): Promise<number> {
  const rows = await client.models.ConversationReadState.list({
    authMode: 'iam',
  });
  let deleted = 0;
  for (const row of rows.data ?? []) {
    if (!row.userSub || !row.readScopeKey) continue;
    await client.models.ConversationReadState.delete(
      { userSub: row.userSub, readScopeKey: row.readScopeKey },
      { authMode: 'iam' },
    );
    deleted++;
  }
  return deleted;
}

export async function deleteReadStatesForIdentity(
  client: DataClient,
  identity: UserParticipantIdentity,
): Promise<number> {
  if (!identity.sub) return 0;

  const rows = await client.models.ConversationReadState.list({
    filter: { userSub: { eq: identity.sub } },
    authMode: 'iam',
  });

  let deleted = 0;
  for (const row of rows.data ?? []) {
    if (!row.userSub || !row.readScopeKey) continue;
    await client.models.ConversationReadState.delete(
      { userSub: row.userSub, readScopeKey: row.readScopeKey },
      { authMode: 'iam' },
    );
    deleted++;
  }
  return deleted;
}

function participantMatchesIdentity(
  participant: string,
  identity: UserParticipantIdentity,
): boolean {
  const value = participant.trim().toLowerCase();
  if (identity.ids.has(participant) || identity.ids.has(value)) return true;
  if (identity.sub && value === identity.sub.toLowerCase()) return true;
  if (value === identity.username) return true;
  if (value === toLoginId(identity.username).toLowerCase()) return true;
  if (fromLoginId(value) === identity.username) return true;
  return false;
}

function profileMatchesIdentity(
  profile: Schema['UserProfile']['type'],
  identity: UserParticipantIdentity,
): boolean {
  const handle = profile.username.trim().toLowerCase();
  if (handle === identity.username) return true;
  if (identity.sub && profile.cognitoSub === identity.sub) return true;
  if (identity.sub && handle === identity.sub.toLowerCase()) return true;
  for (const id of identity.ids) {
    const normalized = id.trim().toLowerCase();
    if (handle === normalized) return true;
    if (profile.cognitoSub && profile.cognitoSub === id) return true;
  }
  return false;
}

/** Remove every profile row tied to a person (handle, sub, legacy sub-as-username). */
export async function deleteProfilesForIdentity(
  client: DataClient,
  identity: UserParticipantIdentity,
): Promise<number> {
  const seen = new Set<string>();
  let deleted = 0;

  const linked = await listProfilesForUser(
    client,
    identity.username,
    identity.sub ?? '',
  );
  for (const profile of linked) {
    seen.add(profile.id);
  }

  const allProfiles = await client.models.UserProfile.list({ authMode: 'iam' });
  for (const profile of allProfiles.data) {
    if (!profileMatchesIdentity(profile, identity)) continue;
    seen.add(profile.id);
  }

  for (const profileId of seen) {
    await client.models.UserProfile.delete({ id: profileId }, { authMode: 'iam' });
    deleted++;
  }

  return deleted;
}

export async function deleteMessageRecord(
  client: DataClient,
  message: Schema['Message']['type'],
): Promise<void> {
  await deleteMessageStorage(message);
  await client.models.Message.delete({ id: message.id }, { authMode: 'iam' });
}

export function messageReferencesIdentity(
  message: Schema['Message']['type'],
  identity: UserParticipantIdentity,
): boolean {
  if (
    message.senderUsername &&
    participantMatchesIdentity(message.senderUsername, identity)
  ) {
    return true;
  }

  const participants = (message.participantUsernames ?? []).filter(
    (participant): participant is string => !!participant,
  );
  return participants.some((participant) =>
    participantMatchesIdentity(participant, identity),
  );
}
