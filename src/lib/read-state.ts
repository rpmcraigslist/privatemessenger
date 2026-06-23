import { client, type MessageModel } from './amplify';
import {
  getServerLastReadAt,
  mergeServerLastReadAt,
} from './read-state-sync';
import {
  directConversationPeerKey,
  isMessageFromSelf,
  type ConversationLike,
} from './util';

const PREFIX = 'messenger:read:';

export function maxIsoTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) return right ?? null;
  if (!right) return left;
  const leftMs = new Date(left).getTime();
  const rightMs = new Date(right).getTime();
  if (Number.isNaN(leftMs)) return right;
  if (Number.isNaN(rightMs)) return left;
  return leftMs >= rightMs ? left : right;
}

/** Stable key for read cursors: peer pair for 1:1, conversation id for groups. */
export function resolveReadScopeKey(
  conversation: ConversationLike,
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): string {
  const peerKey = directConversationPeerKey(
    conversation,
    myUsername,
    mySub,
    handleToSub,
  );
  if (peerKey) return `peer:${peerKey}`;
  return `conv:${conversation.id}`;
}

function storageKeys(
  sub: string,
  username: string,
  readScopeKey: string,
  conversationId?: string,
): string[] {
  const handle = username.trim().toLowerCase();
  const keys = new Set<string>([
    `${PREFIX}${sub}:${readScopeKey}`,
    `${PREFIX}user:${handle}:${readScopeKey}`,
  ]);

  if (conversationId) {
    keys.add(`${PREFIX}${sub}:${conversationId}`);
    keys.add(`${PREFIX}user:${handle}:${conversationId}`);
  }

  return [...keys];
}

function readLocalLastReadAt(
  sub: string,
  username: string,
  readScopeKey: string,
  conversationId?: string,
): string | null {
  let latest: string | null = null;
  for (const key of storageKeys(sub, username, readScopeKey, conversationId)) {
    const value = localStorage.getItem(key);
    if (!value) continue;
    latest = maxIsoTimestamp(latest, value);
  }
  return latest;
}

export function getLastReadAt(
  sub: string,
  username: string,
  readScopeKey: string,
  conversationId?: string,
): string | null {
  const local = readLocalLastReadAt(sub, username, readScopeKey, conversationId);
  const server = getServerLastReadAt(sub, readScopeKey);
  return maxIsoTimestamp(local, server);
}

export function markConversationRead(
  sub: string,
  username: string,
  readScopeKey: string,
  readAtIso: string,
  conversationId?: string,
): boolean {
  const previous = getLastReadAt(sub, username, readScopeKey, conversationId);
  const merged = maxIsoTimestamp(previous, readAtIso);
  if (!merged || merged === previous) return false;

  for (const key of storageKeys(sub, username, readScopeKey, conversationId)) {
    localStorage.setItem(key, merged);
  }

  mergeServerLastReadAt(sub, readScopeKey, merged);
  return true;
}

/** True when lastReadAt covers messageCreatedAt (timestamp-safe). */
export function isReadThrough(
  lastReadAt: string | null,
  messageCreatedAt: string,
): boolean {
  if (!lastReadAt) return false;
  const readMs = new Date(lastReadAt).getTime();
  const messageMs = new Date(messageCreatedAt).getTime();
  if (Number.isNaN(readMs) || Number.isNaN(messageMs)) return false;
  return readMs >= messageMs;
}

export function latestMessageTimestamp(
  messages: readonly { createdAt?: string | null }[],
): string | null {
  let latest: string | null = null;
  for (const message of messages) {
    const createdAt = message.createdAt;
    if (!createdAt) continue;
    latest = maxIsoTimestamp(latest, createdAt);
  }
  return latest;
}

/** Advance the read cursor through all messages currently in view. */
export function markConversationReadThrough(
  sub: string,
  username: string,
  readScopeKey: string,
  messages: readonly { createdAt?: string | null }[],
  conversationId?: string,
): boolean {
  const latest = latestMessageTimestamp(messages);
  if (!latest) return false;

  const previous = getLastReadAt(sub, username, readScopeKey, conversationId);
  if (isReadThrough(previous, latest)) return false;

  return markConversationRead(sub, username, readScopeKey, latest, conversationId);
}

/** Mark read through a known timestamp (e.g. conversation.lastMessageAt). */
export function markConversationReadAt(
  sub: string,
  username: string,
  readScopeKey: string,
  readAtIso: string,
  conversationId?: string,
): boolean {
  if (!readAtIso) return false;
  return markConversationRead(sub, username, readScopeKey, readAtIso, conversationId);
}

export function countUnreadMessages(
  messages: MessageModel[],
  lastReadAt: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
  handleToSub: Map<string, string>,
): number {
  return messages.filter((message) => {
    if (
      isMessageFromSelf(
        message.senderUsername,
        myUsername,
        mySub,
        subToUsername,
        handleToSub,
        {
          isGroup: (message.participantUsernames?.length ?? 0) > 2,
          participants: message.participantUsernames ?? [],
        },
      )
    ) {
      return false;
    }
    if (!message.createdAt) return false;
    return !isReadThrough(lastReadAt, message.createdAt);
  }).length;
}

/** First unread message from others (messages must be sorted oldest-first). */
export function findFirstUnreadMessage(
  messages: MessageModel[],
  lastReadAt: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
  handleToSub: Map<string, string>,
): MessageModel | null {
  for (const message of messages) {
    if (
      isMessageFromSelf(
        message.senderUsername,
        myUsername,
        mySub,
        subToUsername,
        handleToSub,
        {
          isGroup: (message.participantUsernames?.length ?? 0) > 2,
          participants: message.participantUsernames ?? [],
        },
      )
    ) {
      continue;
    }
    if (!message.createdAt) continue;
    if (!isReadThrough(lastReadAt, message.createdAt)) {
      return message;
    }
  }
  return null;
}

/** Newest unread message from others (messages must be sorted oldest-first). */
export function findLastUnreadMessage(
  messages: MessageModel[],
  lastReadAt: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
  handleToSub: Map<string, string>,
): MessageModel | null {
  let lastUnread: MessageModel | null = null;
  for (const message of messages) {
    if (
      isMessageFromSelf(
        message.senderUsername,
        myUsername,
        mySub,
        subToUsername,
        handleToSub,
        {
          isGroup: (message.participantUsernames?.length ?? 0) > 2,
          participants: message.participantUsernames ?? [],
        },
      )
    ) {
      continue;
    }
    if (!message.createdAt) continue;
    if (!isReadThrough(lastReadAt, message.createdAt)) {
      lastUnread = message;
    }
  }
  return lastUnread;
}

/** @deprecated Prefer computeUnreadCounts with in-memory messages. */
export async function fetchUnreadCount(
  conversationId: string,
  lastReadAt: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
  handleToSub: Map<string, string>,
): Promise<number> {
  const { data, errors } = await client.models.Message.list({
    filter: { conversationId: { eq: conversationId } },
  });
  if (errors?.length) return 0;
  return countUnreadMessages(
    data,
    lastReadAt,
    myUsername,
    mySub,
    subToUsername,
    handleToSub,
  );
}

/** Latest read cursor for a conversation (max of stored cursor and message timestamps). */
export function readCursorForMessages(
  lastReadAt: string | null,
  messages: { createdAt?: string | null }[],
): string | null {
  return maxIsoTimestamp(lastReadAt, latestMessageTimestamp(messages));
}

/** All conversation ids that share the same read cursor (duplicate 1:1 threads). */
export function collectConversationIdsForReadScope(
  conversation: ConversationLike,
  allConversations: readonly ConversationLike[],
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): string[] {
  const scope = resolveReadScopeKey(
    conversation,
    myUsername,
    mySub,
    handleToSub,
  );
  const ids = new Set<string>([conversation.id]);
  for (const candidate of allConversations) {
    if (
      resolveReadScopeKey(candidate, myUsername, mySub, handleToSub) === scope
    ) {
      ids.add(candidate.id);
    }
  }
  return [...ids];
}

export function messagesForReadScope(
  conversation: ConversationLike,
  allConversations: readonly ConversationLike[],
  allMessages: readonly MessageModel[],
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): MessageModel[] {
  const conversationIds = new Set(
    collectConversationIdsForReadScope(
      conversation,
      allConversations,
      myUsername,
      mySub,
      handleToSub,
    ),
  );
  return allMessages.filter(
    (message) =>
      !!message.conversationId && conversationIds.has(message.conversationId),
  );
}

/** Best read-through timestamp for a thread using stored cursor and loaded messages. */
export function effectiveLastReadAt(
  sub: string,
  username: string,
  conversation: ConversationLike,
  allConversations: readonly ConversationLike[],
  allMessages: readonly MessageModel[],
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): string | null {
  const readScopeKey = resolveReadScopeKey(
    conversation,
    myUsername,
    mySub,
    handleToSub,
  );
  const stored = getLastReadAt(sub, username, readScopeKey, conversation.id);
  const scopedMessages = messagesForReadScope(
    conversation,
    allConversations,
    allMessages,
    myUsername,
    mySub,
    handleToSub,
  );
  return readCursorForMessages(stored, scopedMessages);
}
