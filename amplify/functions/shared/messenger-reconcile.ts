import type { Schema } from '../../data/resource';
import type { generateClient } from 'aws-amplify/data';
import { fromLoginId, toLoginId } from './cognito';
import {
  consolidateUserProfiles,
  ensureProfileForCognitoUser,
  isValidMessengerHandle,
  type DataClient,
} from './profile-consolidation';

export type CognitoDirectoryUser = {
  loginId: string;
  username: string;
  cognitoSub: string | null;
};

type Conversation = Schema['Conversation']['type'];

export type UserParticipantIdentity = {
  username: string;
  sub: string | null;
  ids: Set<string>;
};

export type AdminAuditResult = {
  cognitoUsers: {
    username: string;
    cognitoSub: string | null;
    status: string;
  }[];
  profileRows: {
    id: string;
    username: string;
    cognitoSub: string | null;
    orphan: boolean;
  }[];
  duplicateProfileHandles: string[];
  duplicateDirectChats: {
    peerKey: string;
    conversationIds: string[];
  }[];
};

export type PurgeDirectChatResult = {
  usernameA: string;
  usernameB: string;
  deletedMessages: number;
  deletedConversations: number;
};

export type PurgeUserMessengerResult = {
  deletedMessages: number;
  deletedConversations: number;
  updatedGroupConversations: number;
};

export type ReconcileMessengerResult = {
  profilesConsolidated: number;
  orphanProfilesRemoved: number;
  duplicateConversationsRemoved: number;
  messagesRemoved: number;
  conversationsNormalized: number;
};

export function buildUserParticipantIdentity(
  user: CognitoDirectoryUser,
  extraSubs: string[] = [],
): UserParticipantIdentity {
  const username = user.username.trim().toLowerCase();
  const ids = new Set<string>();
  ids.add(username);
  ids.add(toLoginId(username).toLowerCase());
  if (user.loginId) ids.add(user.loginId.toLowerCase());
  if (user.cognitoSub) ids.add(user.cognitoSub);
  for (const sub of extraSubs) {
    if (sub) ids.add(sub);
  }
  return { username, sub: user.cognitoSub, ids };
}

export function participantMatchesIdentity(
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

export function isDirectConversationBetween(
  conversation: Pick<Conversation, 'isGroup' | 'participants'>,
  userA: UserParticipantIdentity,
  userB: UserParticipantIdentity,
): boolean {
  if (conversation.isGroup) return false;
  const participants = (conversation.participants ?? []).filter(
    (participant): participant is string => !!participant,
  );
  if (participants.length !== 2) return false;

  let hasA = false;
  let hasB = false;
  for (const participant of participants) {
    const matchesA = participantMatchesIdentity(participant, userA);
    const matchesB = participantMatchesIdentity(participant, userB);
    if (matchesA) hasA = true;
    if (matchesB) hasB = true;
  }
  return hasA && hasB;
}

export function conversationIncludesIdentity(
  conversation: Pick<Conversation, 'participants'>,
  identity: UserParticipantIdentity,
): boolean {
  const participants = (conversation.participants ?? []).filter(
    (participant): participant is string => !!participant,
  );
  return participants.some((participant) =>
    participantMatchesIdentity(participant, identity),
  );
}

function stripIdentityFromParticipants(
  participants: string[],
  identity: UserParticipantIdentity,
): string[] {
  return participants.filter(
    (participant) => !participantMatchesIdentity(participant, identity),
  );
}

function isMessageSentByIdentity(
  message: Schema['Message']['type'],
  identity: UserParticipantIdentity,
): boolean {
  if (!message.senderUsername) return false;
  return participantMatchesIdentity(message.senderUsername, identity);
}

function isMessageAssociatedWithIdentity(
  message: Schema['Message']['type'],
  identity: UserParticipantIdentity,
): boolean {
  if (isMessageSentByIdentity(message, identity)) return true;
  const participants = (message.participantUsernames ?? []).filter(
    (participant): participant is string => !!participant,
  );
  return participants.some((participant) =>
    participantMatchesIdentity(participant, identity),
  );
}

async function listAllProfiles(client: DataClient) {
  const profiles = await client.models.UserProfile.list({ authMode: 'iam' });
  return profiles.data;
}

async function listAllConversations(client: DataClient) {
  const conversations = await client.models.Conversation.list({ authMode: 'iam' });
  return conversations.data;
}

async function listAllMessages(client: DataClient) {
  const messages = await client.models.Message.list({ authMode: 'iam' });
  return messages.data;
}

async function deleteConversationWithMessages(
  client: DataClient,
  conversationId: string,
  messagesByConversation: Map<string, Schema['Message']['type'][]>,
): Promise<number> {
  const messages = messagesByConversation.get(conversationId) ?? [];
  for (const message of messages) {
    await client.models.Message.delete({ id: message.id }, { authMode: 'iam' });
  }
  messagesByConversation.delete(conversationId);
  await client.models.Conversation.delete({ id: conversationId }, { authMode: 'iam' });
  return messages.length;
}

export async function buildParticipantIdentityForHandle(
  client: DataClient,
  cognitoUsers: CognitoDirectoryUser[],
  username: string,
): Promise<UserParticipantIdentity> {
  const handle = username.trim().toLowerCase();
  const cognitoUser = cognitoUsers.find((user) => user.username === handle);
  const profiles = await client.models.UserProfile.list({
    filter: { username: { eq: handle } },
    authMode: 'iam',
  });
  const extraSubs = profiles.data
    .map((profile) => profile.cognitoSub)
    .filter((sub): sub is string => !!sub);

  if (cognitoUser) {
    return buildUserParticipantIdentity(cognitoUser, extraSubs);
  }

  return {
    username: handle,
    sub: extraSubs[0] ?? null,
    ids: new Set([
      handle,
      toLoginId(handle).toLowerCase(),
      ...extraSubs,
    ]),
  };
}

function buildCanonicalSubMap(
  cognitoUsers: CognitoDirectoryUser[],
  profiles: Schema['UserProfile']['type'][],
): Map<string, string> {
  const map = new Map<string, string>();

  for (const user of cognitoUsers) {
    if (!user.cognitoSub) continue;
    const handle = user.username.trim().toLowerCase();
    map.set(user.cognitoSub, user.cognitoSub);
    map.set(handle, user.cognitoSub);
    map.set(toLoginId(handle).toLowerCase(), user.cognitoSub);
    if (user.loginId) map.set(user.loginId.toLowerCase(), user.cognitoSub);
  }

  for (const profile of profiles) {
    if (!profile.cognitoSub) continue;
    const handle = profile.username.trim().toLowerCase();
    map.set(profile.cognitoSub, profile.cognitoSub);
    if (isValidMessengerHandle(handle)) {
      map.set(handle, profile.cognitoSub);
      map.set(toLoginId(handle).toLowerCase(), profile.cognitoSub);
    }
  }

  return map;
}

function resolveCanonicalSub(
  participant: string,
  canonicalSubByParticipant: Map<string, string>,
): string {
  const trimmed = participant.trim();
  const lower = trimmed.toLowerCase();
  return (
    canonicalSubByParticipant.get(trimmed) ??
    canonicalSubByParticipant.get(lower) ??
    canonicalSubByParticipant.get(fromLoginId(lower)) ??
    trimmed
  );
}

function directPeerKey(
  conversation: Pick<Conversation, 'isGroup' | 'participants'>,
  canonicalSubByParticipant: Map<string, string>,
): string | null {
  if (conversation.isGroup) return null;
  const participants = (conversation.participants ?? []).filter(
    (participant): participant is string => !!participant,
  );
  if (participants.length !== 2) return null;
  const subs = [
    ...new Set(
      participants.map((participant) =>
        resolveCanonicalSub(participant, canonicalSubByParticipant),
      ),
    ),
  ];
  if (subs.length !== 2) return null;
  return subs.slice().sort().join(':');
}

function conversationActivityAt(conversation: Conversation): number {
  const at = conversation.lastMessageAt ?? conversation.createdAt;
  return at ? new Date(at).getTime() : 0;
}

export async function auditMessengerData(
  client: DataClient,
  cognitoUsers: CognitoDirectoryUser[],
  cognitoStatuses: Map<string, string>,
): Promise<AdminAuditResult> {
  const validSubs = new Set(
    cognitoUsers.map((user) => user.cognitoSub).filter(Boolean) as string[],
  );
  const validHandles = new Set(
    cognitoUsers.map((user) => user.username.trim().toLowerCase()),
  );

  const profiles = await listAllProfiles(client);
  const conversations = await listAllConversations(client);
  const canonicalSubByParticipant = buildCanonicalSubMap(cognitoUsers, profiles);

  const profilesByHandle = new Map<string, Schema['UserProfile']['type'][]>();
  for (const profile of profiles) {
    const handle = profile.username.trim().toLowerCase();
    const bucket = profilesByHandle.get(handle) ?? [];
    bucket.push(profile);
    profilesByHandle.set(handle, bucket);
  }

  const duplicateProfileHandles = [...profilesByHandle.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([handle]) => handle);

  const chatsByPeer = new Map<string, string[]>();
  for (const conversation of conversations) {
    const key = directPeerKey(conversation, canonicalSubByParticipant);
    if (!key) continue;
    const bucket = chatsByPeer.get(key) ?? [];
    bucket.push(conversation.id);
    chatsByPeer.set(key, bucket);
  }

  const duplicateDirectChats = [...chatsByPeer.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([peerKey, conversationIds]) => ({ peerKey, conversationIds }));

  return {
    cognitoUsers: cognitoUsers.map((user) => ({
      username: user.username,
      cognitoSub: user.cognitoSub,
      status: cognitoStatuses.get(user.username) ?? 'UNKNOWN',
    })),
    profileRows: profiles.map((profile) => {
      const handle = profile.username.trim().toLowerCase();
      const orphan =
        (profile.cognitoSub != null && !validSubs.has(profile.cognitoSub)) ||
        (validHandles.has(handle) &&
          (!profile.cognitoSub ||
            (profile.cognitoSub != null && !validSubs.has(profile.cognitoSub))));
      return {
        id: profile.id,
        username: profile.username,
        cognitoSub: profile.cognitoSub ?? null,
        orphan,
      };
    }),
    duplicateProfileHandles,
    duplicateDirectChats,
  };
}

export async function purgeDirectChatBetween(
  client: DataClient,
  cognitoUsers: CognitoDirectoryUser[],
  usernameA: string,
  usernameB: string,
): Promise<PurgeDirectChatResult> {
  const handleA = usernameA.trim().toLowerCase();
  const handleB = usernameB.trim().toLowerCase();
  if (!isValidMessengerHandle(handleA) || !isValidMessengerHandle(handleB)) {
    throw new Error('Enter valid usernames (letters, numbers, dots, underscores, hyphens).');
  }
  if (handleA === handleB) {
    throw new Error('Choose two different users.');
  }

  const identityA = await buildParticipantIdentityForHandle(client, cognitoUsers, handleA);
  const identityB = await buildParticipantIdentityForHandle(client, cognitoUsers, handleB);

  const conversations = await listAllConversations(client);
  const messages = await listAllMessages(client);
  const messagesByConversation = new Map<string, Schema['Message']['type'][]>();
  for (const message of messages) {
    if (!message.conversationId) continue;
    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  let deletedMessages = 0;
  let deletedConversations = 0;

  for (const conversation of conversations) {
    if (!isDirectConversationBetween(conversation, identityA, identityB)) continue;
    deletedMessages += await deleteConversationWithMessages(
      client,
      conversation.id,
      messagesByConversation,
    );
    deletedConversations++;
  }

  return {
    usernameA: handleA,
    usernameB: handleB,
    deletedMessages,
    deletedConversations,
  };
}

/** Remove a user's chats and messages before deleting their account. */
export async function purgeUserMessengerData(
  client: DataClient,
  identity: UserParticipantIdentity,
): Promise<PurgeUserMessengerResult> {
  const conversations = await listAllConversations(client);
  const messages = await listAllMessages(client);
  const messagesByConversation = new Map<string, Schema['Message']['type'][]>();
  for (const message of messages) {
    if (!message.conversationId) continue;
    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  let deletedMessages = 0;
  let deletedConversations = 0;
  let updatedGroupConversations = 0;

  for (const conversation of conversations) {
    if (!conversationIncludesIdentity(conversation, identity)) continue;

    if (!conversation.isGroup) {
      deletedMessages += await deleteConversationWithMessages(
        client,
        conversation.id,
        messagesByConversation,
      );
      deletedConversations++;
      continue;
    }

    const convMessages = messagesByConversation.get(conversation.id) ?? [];
    const remainingMessages: Schema['Message']['type'][] = [];

    for (const message of convMessages) {
      if (isMessageSentByIdentity(message, identity)) {
        await client.models.Message.delete({ id: message.id }, { authMode: 'iam' });
        deletedMessages++;
        continue;
      }
      remainingMessages.push(message);
    }
    messagesByConversation.set(conversation.id, remainingMessages);

    const remainingParticipants = stripIdentityFromParticipants(
      (conversation.participants ?? []).filter(
        (participant): participant is string => !!participant,
      ),
      identity,
    );

    if (remainingParticipants.length === 0) {
      deletedMessages += await deleteConversationWithMessages(
        client,
        conversation.id,
        messagesByConversation,
      );
      deletedConversations++;
      continue;
    }

    await client.models.Conversation.update(
      { id: conversation.id, participants: remainingParticipants },
      { authMode: 'iam' },
    );
    updatedGroupConversations++;

    for (const message of remainingMessages) {
      const participantUsernames = (message.participantUsernames ?? []).filter(
        (participant): participant is string => !!participant,
      );
      const normalizedParticipants = stripIdentityFromParticipants(
        participantUsernames,
        identity,
      );
      if (normalizedParticipants.length === participantUsernames.length) continue;

      await client.models.Message.update(
        {
          id: message.id,
          participantUsernames: normalizedParticipants,
        },
        { authMode: 'iam' },
      );
    }
  }

  const orphanMessages = [
    ...[...messagesByConversation.values()].flat(),
    ...messages.filter((message) => !message.conversationId),
  ];
  for (const message of orphanMessages) {
    if (!isMessageAssociatedWithIdentity(message, identity)) continue;
    await client.models.Message.delete({ id: message.id }, { authMode: 'iam' });
    deletedMessages++;
  }

  if (identity.sub) {
    const readStates = await client.models.ConversationReadState.list({
      filter: { userSub: { eq: identity.sub } },
      authMode: 'iam',
    });
    for (const row of readStates.data ?? []) {
      if (!row.userSub || !row.readScopeKey) continue;
      await client.models.ConversationReadState.delete(
        { userSub: row.userSub, readScopeKey: row.readScopeKey },
        { authMode: 'iam' },
      );
    }
  }

  return {
    deletedMessages,
    deletedConversations,
    updatedGroupConversations,
  };
}

export async function reconcileMessengerData(
  client: DataClient,
  cognitoUsers: CognitoDirectoryUser[],
): Promise<ReconcileMessengerResult> {
  let profilesConsolidated = 0;
  let orphanProfilesRemoved = 0;

  const validSubs = new Set(
    cognitoUsers.map((user) => user.cognitoSub).filter(Boolean) as string[],
  );
  const validHandles = new Set(
    cognitoUsers.map((user) => user.username.trim().toLowerCase()),
  );

  for (const user of cognitoUsers) {
    if (!user.cognitoSub) continue;
    const before = await listAllProfiles(client);
    await ensureProfileForCognitoUser(client, {
      username: user.username,
      cognitoSub: user.cognitoSub,
    });
    await consolidateUserProfiles(client, user.username, user.cognitoSub);
    const after = await listAllProfiles(client);
    if (after.length < before.length) {
      profilesConsolidated += before.length - after.length;
    }
  }

  let profiles = await listAllProfiles(client);
  for (const profile of profiles) {
    const handle = profile.username.trim().toLowerCase();
    const staleSub =
      profile.cognitoSub != null && !validSubs.has(profile.cognitoSub);
    const orphanStub = validHandles.has(handle) && !profile.cognitoSub;
    const orphanStale = validHandles.has(handle) && staleSub;
    const legacyUuidUsername =
      profile.cognitoSub != null && profile.username === profile.cognitoSub;
    const duplicateHandle =
      validHandles.has(handle) &&
      profile.cognitoSub != null &&
      !legacyUuidUsername &&
      profiles.filter(
        (other) =>
          other.id !== profile.id &&
          other.username === profile.username &&
          other.cognitoSub != null &&
          validSubs.has(other.cognitoSub),
      ).length > 0 &&
      (staleSub || !validSubs.has(profile.cognitoSub));

    if (orphanStub || orphanStale || duplicateHandle || legacyUuidUsername) {
      await client.models.UserProfile.delete({ id: profile.id }, { authMode: 'iam' });
      orphanProfilesRemoved++;
    }
  }

  profiles = await listAllProfiles(client);
  const canonicalSubByParticipant = buildCanonicalSubMap(cognitoUsers, profiles);

  let conversations = await listAllConversations(client);
  let messages = await listAllMessages(client);
  const messagesByConversation = new Map<string, Schema['Message']['type'][]>();
  for (const message of messages) {
    if (!message.conversationId) continue;
    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  let duplicateConversationsRemoved = 0;
  let messagesRemoved = 0;
  const conversationsByPeer = new Map<string, Conversation[]>();
  for (const conversation of conversations) {
    const key = directPeerKey(conversation, canonicalSubByParticipant);
    if (!key) continue;
    const bucket = conversationsByPeer.get(key) ?? [];
    bucket.push(conversation);
    conversationsByPeer.set(key, bucket);
  }

  for (const peerConversations of conversationsByPeer.values()) {
    if (peerConversations.length <= 1) continue;
    peerConversations.sort(
      (a, b) => conversationActivityAt(b) - conversationActivityAt(a),
    );
    const [, ...staleConversations] = peerConversations;
    for (const conversation of staleConversations) {
      messagesRemoved += await deleteConversationWithMessages(
        client,
        conversation.id,
        messagesByConversation,
      );
      duplicateConversationsRemoved++;
    }
  }

  conversations = await listAllConversations(client);
  let conversationsNormalized = 0;
  for (const conversation of conversations) {
    const participants = (conversation.participants ?? []).filter(
      (participant): participant is string => !!participant,
    );
    const normalized = [
      ...new Set(
        participants.map((participant) =>
          resolveCanonicalSub(participant, canonicalSubByParticipant),
        ),
      ),
    ];
    const changed =
      normalized.length !== participants.length ||
      normalized.some((value, index) => value !== participants[index]);
    if (!changed) continue;

    await client.models.Conversation.update(
      { id: conversation.id, participants: normalized },
      { authMode: 'iam' },
    );
    conversationsNormalized++;

    const conversationMessages = messagesByConversation.get(conversation.id) ?? [];
    for (const message of conversationMessages) {
      const participantUsernames = (message.participantUsernames ?? []).filter(
        (participant): participant is string => !!participant,
      );
      const normalizedParticipants = [
        ...new Set(
          participantUsernames.map((participant) =>
            resolveCanonicalSub(participant, canonicalSubByParticipant),
          ),
        ),
      ];
      const messageChanged =
        normalizedParticipants.length !== participantUsernames.length ||
        normalizedParticipants.some(
          (value, index) => value !== participantUsernames[index],
        );
      if (!messageChanged) continue;
      await client.models.Message.update(
        {
          id: message.id,
          participantUsernames: normalizedParticipants,
        },
        { authMode: 'iam' },
      );
    }
  }

  return {
    profilesConsolidated,
    orphanProfilesRemoved,
    duplicateConversationsRemoved,
    messagesRemoved,
    conversationsNormalized,
  };
}
