import { client, type MessageModel } from './amplify';
import { isSameMessengerUser } from './util';

const PREFIX = 'messenger:read:';

function storageKeys(
  sub: string,
  username: string,
  conversationId: string,
): string[] {
  const handle = username.trim().toLowerCase();
  return [
    `${PREFIX}${sub}:${conversationId}`,
    `${PREFIX}user:${handle}:${conversationId}`,
  ];
}

export function getLastReadAt(
  sub: string,
  username: string,
  conversationId: string,
): string | null {
  let latest: string | null = null;
  for (const key of storageKeys(sub, username, conversationId)) {
    const value = localStorage.getItem(key);
    if (!value) continue;
    if (
      !latest ||
      new Date(value).getTime() > new Date(latest).getTime()
    ) {
      latest = value;
    }
  }
  return latest;
}

export function markConversationRead(
  sub: string,
  username: string,
  conversationId: string,
  readAtIso: string,
): void {
  for (const key of storageKeys(sub, username, conversationId)) {
    localStorage.setItem(key, readAtIso);
  }
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
    if (
      !latest ||
      new Date(createdAt).getTime() > new Date(latest).getTime()
    ) {
      latest = createdAt;
    }
  }
  return latest;
}

/** Advance the read cursor through all messages currently in view. */
export function markConversationReadThrough(
  sub: string,
  username: string,
  conversationId: string,
  messages: readonly { createdAt?: string | null }[],
): boolean {
  const latest = latestMessageTimestamp(messages);
  if (!latest) return false;

  const previous = getLastReadAt(sub, username, conversationId);
  if (isReadThrough(previous, latest)) return false;

  markConversationRead(sub, username, conversationId, latest);
  return true;
}

export function countUnreadMessages(
  messages: MessageModel[],
  lastReadAt: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
): number {
  return messages.filter((message) => {
    if (
      isSameMessengerUser(
        message.senderUsername,
        myUsername,
        mySub,
        subToUsername,
      )
    ) {
      return false;
    }
    if (!message.createdAt) return false;
    return !isReadThrough(lastReadAt, message.createdAt);
  }).length;
}

/** Newest unread message from others (messages must be sorted oldest-first). */
export function findLastUnreadMessage(
  messages: MessageModel[],
  lastReadAt: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
): MessageModel | null {
  let lastUnread: MessageModel | null = null;
  for (const message of messages) {
    if (
      isSameMessengerUser(
        message.senderUsername,
        myUsername,
        mySub,
        subToUsername,
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
  );
}

/** Latest read cursor for a conversation (max of stored cursor and message timestamps). */
export function readCursorForMessages(
  lastReadAt: string | null,
  messages: { createdAt?: string | null }[],
): string | null {
  return latestMessageTimestamp(messages) ?? lastReadAt;
}
