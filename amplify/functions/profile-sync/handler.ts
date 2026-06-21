import type { AppSyncResolverHandler } from 'aws-lambda';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/profile-sync';
import {
  isAdminGroupMember,
  isCognitoUuid,
  normalizeContactEmail,
  parseIdentity,
  resolveUsernameFromPool,
} from '../shared/cognito';
import {
  conversationIncludesUser,
  repairParticipantList,
} from '../shared/participant-repair';
import {
  consolidateUserProfiles,
  type DataClient,
} from '../shared/profile-consolidation';

type Handler = Schema['syncMyProfile']['functionHandler'];

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

  const { contactEmail: emailArg } = event.arguments;
  const isAdmin = isAdminGroupMember(event.identity);
  const client = await dataClientPromise;

  const existing = await consolidateUserProfiles(client, username, sub);

  let contactEmail = existing?.contactEmail ?? null;
  if (emailArg !== undefined && emailArg !== null) {
    const trimmed = emailArg.trim();
    if (!trimmed) {
      contactEmail = null;
    } else {
      contactEmail = normalizeContactEmail(trimmed);
      if (!contactEmail) {
        throw new Error('Enter a valid email address');
      }
    }
  }

  if (!existing) {
    const created = await client.models.UserProfile.create(
      {
        username,
        cognitoSub: sub,
        displayName: username,
        role: isAdmin ? 'admin' : 'user',
        contactEmail,
        smsNotificationsEnabled: false,
        avatarColor: isAdmin ? '#00a884' : '#64b5f6',
      },
      { authMode: 'iam' },
    );
    await consolidateUserProfiles(client, username, sub);
    await repairMembershipRecords(client, username, sub);
    return {
      profileId: created.data?.id ?? '',
      username,
      cognitoSub: sub,
      role: isAdmin ? 'admin' : 'user',
      contactEmail,
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
      contactEmail,
    },
    { authMode: 'iam' },
  );

  await repairMembershipRecords(client, username, sub);

  return {
    profileId: existing.id,
    username,
    cognitoSub: sub,
    role,
    contactEmail,
  };
};
