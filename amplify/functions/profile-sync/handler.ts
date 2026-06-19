import type { AppSyncResolverHandler } from 'aws-lambda';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/profile-sync';
import {
  isAdminGroupMember,
  isCognitoUuid,
  normalizePhoneE164,
  parseIdentity,
  resolveUsernameFromPool,
} from '../shared/cognito';
import {
  conversationIncludesUser,
  repairParticipantList,
} from '../shared/participant-repair';

type Handler = Schema['syncMyProfile']['functionHandler'];
type DataClient = ReturnType<typeof generateClient<Schema>>;
type UserProfile = Schema['UserProfile']['type'];

const dataClientPromise = getAmplifyDataClientConfig(
  env as Parameters<typeof getAmplifyDataClientConfig>[0],
).then(({ resourceConfig, libraryOptions }) => {
  Amplify.configure(resourceConfig, libraryOptions);
  return generateClient<Schema>();
});

async function repairMembershipRecords(
  client: DataClient,
  username: string,
  sub: string,
): Promise<void> {
  const conversations = await client.models.Conversation.list({ authMode: 'iam' });
  for (const conversation of conversations.data) {
    const participants = conversation.participants ?? [];
    if (!conversationIncludesUser(participants, username, sub)) continue;

    const { values, changed } = repairParticipantList(
      participants,
      username,
      sub,
    );
    if (changed) {
      await client.models.Conversation.update(
        { id: conversation.id, participants: values },
        { authMode: 'iam' },
      );
    }
  }

  const messages = await client.models.Message.list({ authMode: 'iam' });
  for (const message of messages.data) {
    const participantUsernames = message.participantUsernames ?? [];
    if (!conversationIncludesUser(participantUsernames, username, sub)) {
      continue;
    }

    const { values, changed } = repairParticipantList(
      participantUsernames,
      username,
      sub,
    );
    if (changed) {
      await client.models.Message.update(
        { id: message.id, participantUsernames: values },
        { authMode: 'iam' },
      );
    }
  }
}

async function listProfilesForUser(
  client: DataClient,
  username: string,
  sub: string,
): Promise<UserProfile[]> {
  const byUsername = await client.models.UserProfile.list({
    filter: { username: { eq: username } },
    authMode: 'iam',
  });
  const bySub = await client.models.UserProfile.list({
    filter: { cognitoSub: { eq: sub } },
    authMode: 'iam',
  });
  const byLegacyUsername = await client.models.UserProfile.list({
    filter: { username: { eq: sub } },
    authMode: 'iam',
  });

  const merged = new Map<string, UserProfile>();
  for (const profile of [
    ...byUsername.data,
    ...bySub.data,
    ...byLegacyUsername.data,
  ]) {
    merged.set(profile.id, profile);
  }
  return [...merged.values()];
}

async function consolidateProfiles(
  client: DataClient,
  username: string,
  sub: string,
): Promise<UserProfile | null> {
  const profiles = await listProfilesForUser(client, username, sub);
  if (profiles.length === 0) return null;

  const keeper =
    profiles.find((p) => p.username === username && p.cognitoSub === sub) ??
    profiles.find((p) => p.username === username && p.cognitoSub) ??
    profiles.find((p) => p.username === username) ??
    profiles.find((p) => p.cognitoSub === sub) ??
    profiles[0];

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

export const handler: Handler = async (event) => {
  let { username, sub } = parseIdentity(event.identity);
  if (!sub) {
    throw new Error('Unauthorized');
  }
  if (!username || isCognitoUuid(username)) {
    username = await resolveUsernameFromPool(sub);
  }
  if (!username) {
    throw new Error('Could not resolve username from Cognito profile');
  }

  const { phoneNumber: phoneArg, smsNotificationsEnabled: smsArg } =
    event.arguments;
  const isAdmin = isAdminGroupMember(event.identity);
  const client = await dataClientPromise;

  const existing = await consolidateProfiles(client, username, sub);

  let phone = existing?.phoneNumber ?? null;
  if (phoneArg !== undefined && phoneArg !== null) {
    const trimmed = phoneArg.trim();
    if (!trimmed) {
      phone = null;
    } else {
      phone = normalizePhoneE164(trimmed);
      if (!phone) {
        throw new Error('Enter a valid phone number');
      }
    }
  }

  let smsEnabled = existing?.smsNotificationsEnabled ?? false;
  if (smsArg !== undefined && smsArg !== null) {
    smsEnabled = smsArg === true;
  }
  if (smsEnabled && !phone) {
    throw new Error('Add a phone number to enable SMS notifications');
  }

  if (!existing) {
    const created = await client.models.UserProfile.create(
      {
        username,
        cognitoSub: sub,
        displayName: username,
        role: isAdmin ? 'admin' : 'user',
        phoneNumber: phone,
        smsNotificationsEnabled: smsEnabled,
        avatarColor: isAdmin ? '#00a884' : '#64b5f6',
      },
      { authMode: 'iam' },
    );
    await repairMembershipRecords(client, username, sub);
    return {
      profileId: created.data?.id ?? '',
      username,
      cognitoSub: sub,
      role: isAdmin ? 'admin' : 'user',
      phoneNumber: phone,
      smsNotificationsEnabled: smsEnabled,
    };
  }

  const role =
    existing.role === 'admin' || isAdmin ? 'admin' : (existing.role ?? 'user');

  await client.models.UserProfile.update(
    {
      id: existing.id,
      username,
      cognitoSub: sub,
      role,
      phoneNumber: phone,
      smsNotificationsEnabled: smsEnabled,
    },
    { authMode: 'iam' },
  );

  await repairMembershipRecords(client, username, sub);

  return {
    profileId: existing.id,
    username,
    cognitoSub: sub,
    role,
    phoneNumber: phone,
    smsNotificationsEnabled: smsEnabled,
  };
};
