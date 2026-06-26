import type { AppSyncResolverHandler } from 'aws-lambda';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/profile-sync';
import {
  isAdminGroupMember,
  isCognitoUuid,
  parseIdentity,
  resolveUsernameFromPool,
} from '../shared/cognito';
import {
  buildSyncProfileResponse,
  resolveContactEmailAfterSync,
} from '../shared/profile-sync-logic';
import {
  DEFAULT_MESSAGE_BUBBLE_COLOR,
  resolveMessageBubbleColorAfterSync,
} from '../shared/message-bubble-colors';
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

  const { contactEmail: emailArg, messageBubbleColor: bubbleColorArg } =
    event.arguments;
  const isAdmin = isAdminGroupMember(event.identity);
  const client = await dataClientPromise;

  const existing = await consolidateUserProfiles(client, username, sub);
  const contactEmail = resolveContactEmailAfterSync({
    existing: existing?.contactEmail,
    emailArg,
  });
  const messageBubbleColor = resolveMessageBubbleColorAfterSync({
    existing: existing?.messageBubbleColor,
    colorArg: bubbleColorArg,
  });

  const role =
    existing?.role === 'admin' || isAdmin ? 'admin' : (existing?.role ?? 'user');

  if (!existing) {
    const { data: created, errors } = await client.models.UserProfile.create(
      {
        username,
        cognitoSub: sub,
        displayName: username,
        role,
        contactEmail,
        smsNotificationsEnabled: false,
        avatarColor: isAdmin ? '#00a884' : '#64b5f6',
        messageBubbleColor: DEFAULT_MESSAGE_BUBBLE_COLOR,
      },
      { authMode: 'iam' },
    );
    if (errors?.length) {
      throw new Error(errors[0].message ?? 'Could not create profile');
    }
    if (!created?.id) {
      throw new Error('Could not create profile');
    }

    await consolidateUserProfiles(client, username, sub);
    try {
      await repairMembershipRecords(client, username, sub);
    } catch (err) {
      console.error('membership repair failed after profile create', err);
    }

    return buildSyncProfileResponse(
      created.id,
      username,
      sub,
      role,
      contactEmail,
      messageBubbleColor,
    );
  }

  const { errors } = await client.models.UserProfile.update(
    {
      id: existing.id,
      username,
      cognitoSub: sub,
      role,
      contactEmail,
      messageBubbleColor,
    },
    { authMode: 'iam' },
  );
  if (errors?.length) {
    throw new Error(errors[0].message ?? 'Could not update profile');
  }

  try {
    await repairMembershipRecords(client, username, sub);
  } catch (err) {
    console.error('membership repair failed after profile update', err);
  }

  return buildSyncProfileResponse(
    existing.id,
    username,
    sub,
    role,
    contactEmail,
    messageBubbleColor,
  );
};
