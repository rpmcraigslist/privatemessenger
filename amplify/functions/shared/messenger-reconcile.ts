import type { Schema } from '../../data/resource';
import type { generateClient } from 'aws-amplify/data';
import { fromLoginId, toLoginId } from './cognito';
import {
  deleteConversationStoragePrefix,
  deleteMessageRecord,
  deleteReadStatesForIdentity,
} from './messenger-cleanup';
import {
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

export type MergeDuplicateDirectChatsResult = {
  mergedGroups: number;
  deletedConversations: number;
  movedMessages: number;
  keeperConversationIds: string[];
};

export type PurgeUserMessengerResult = {
  deletedMessages: number;
  deletedConversations: number;
  updatedGroupConversations: number;
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
    await deleteMessageRecord(client, message);
  }
  messagesByConversation.delete(conversationId);
  await deleteConversationStoragePrefix(conversationId);
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

/**
 * Merge duplicate 1:1 conversations that share a canonical peer key.
 * Keeps the thread with the most messages (then most recent activity).
 * Optionally limit to groups that include onlyInvolvingSub.
 */
export async function mergeDuplicateDirectChats(
  client: DataClient,
  cognitoUsers: CognitoDirectoryUser[],
  options: { onlyInvolvingSub?: string | null } = {},
): Promise<MergeDuplicateDirectChatsResult> {
  const profiles = await listAllProfiles(client);
  const conversations = await listAllConversations(client);
  const messages = await listAllMessages(client);
  const canonicalSubByParticipant = buildCanonicalSubMap(cognitoUsers, profiles);
  const onlySub = options.onlyInvolvingSub?.trim() || null;

  const messagesByConversation = new Map<string, Schema['Message']['type'][]>();
  for (const message of messages) {
    if (!message.conversationId) continue;
    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  const chatsByPeer = new Map<string, Conversation[]>();
  for (const conversation of conversations) {
    const key = directPeerKey(conversation, canonicalSubByParticipant);
    if (!key) continue;
    if (onlySub) {
      const participants = (conversation.participants ?? []).filter(
        (participant): participant is string => !!participant,
      );
      const involvesCaller = participants.some((participant) => {
        const resolved = resolveCanonicalSub(participant, canonicalSubByParticipant);
        return resolved === onlySub || participant === onlySub;
      });
      if (!involvesCaller) continue;
    }
    const bucket = chatsByPeer.get(key) ?? [];
    bucket.push(conversation);
    chatsByPeer.set(key, bucket);
  }

  let mergedGroups = 0;
  let deletedConversations = 0;
  let movedMessages = 0;
  const keeperConversationIds: string[] = [];

  for (const bucket of chatsByPeer.values()) {
    if (bucket.length < 2) continue;
    mergedGroups++;

    const ranked = [...bucket].sort((a, b) => {
      const countDiff =
        (messagesByConversation.get(b.id)?.length ?? 0) -
        (messagesByConversation.get(a.id)?.length ?? 0);
      if (countDiff !== 0) return countDiff;
      const timeDiff = conversationActivityAt(b) - conversationActivityAt(a);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });
    const keeper = ranked[0]!;
    const losers = ranked.slice(1);
    keeperConversationIds.push(keeper.id);

    const canonicalParticipants = [
      ...new Set(
        (keeper.participants ?? [])
          .filter((participant): participant is string => !!participant)
          .map((participant) =>
            resolveCanonicalSub(participant, canonicalSubByParticipant),
          ),
      ),
    ];

    for (const loser of losers) {
      const loserMessages = messagesByConversation.get(loser.id) ?? [];
      for (const message of loserMessages) {
        await client.models.Message.update(
          {
            id: message.id,
            conversationId: keeper.id,
            participantUsernames: canonicalParticipants,
          },
          { authMode: 'iam' },
        );
        movedMessages++;
        const keeperBucket = messagesByConversation.get(keeper.id) ?? [];
        keeperBucket.push({ ...message, conversationId: keeper.id });
        messagesByConversation.set(keeper.id, keeperBucket);
      }
      messagesByConversation.set(loser.id, []);
      await deleteConversationWithMessages(client, loser.id, messagesByConversation);
      deletedConversations++;
    }

    const keeperMessages = messagesByConversation.get(keeper.id) ?? [];
    let latest: Schema['Message']['type'] | null = null;
    let latestMs = -1;
    for (const message of keeperMessages) {
      const createdAt = message.createdAt;
      if (!createdAt) continue;
      const ms = new Date(createdAt).getTime();
      if (Number.isNaN(ms) || ms < latestMs) continue;
      latestMs = ms;
      latest = message;
    }

    const previewBody = latest?.content?.trim()
      ? latest.content.trim().slice(0, 120)
      : latest?.type === 'image'
        ? '📷 Photo'
        : latest?.attachmentName
          ? `📎 ${latest.attachmentName}`.slice(0, 120)
          : keeper.lastMessage ?? null;

    await client.models.Conversation.update(
      {
        id: keeper.id,
        participants: canonicalParticipants,
        lastMessage: previewBody,
        lastMessageAt:
          latest?.createdAt ?? keeper.lastMessageAt ?? new Date().toISOString(),
      },
      { authMode: 'iam' },
    );
  }

  return {
    mergedGroups,
    deletedConversations,
    movedMessages,
    keeperConversationIds,
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
        await deleteMessageRecord(client, message);
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
    await deleteMessageRecord(client, message);
    deletedMessages++;
  }

  await deleteReadStatesForIdentity(client, identity);

  return {
    deletedMessages,
    deletedConversations,
    updatedGroupConversations,
  };
}
