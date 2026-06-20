import { client, type MessageModel } from './amplify';
import { isSameMessengerUser } from './util';

const PREFIX = 'messenger:read:';

function storageKey(sub: string, conversationId: string): string {
  return `${PREFIX}${sub}:${conversationId}`;
}

export function getLastReadAt(
  sub: string,
  conversationId: string,
): string | null {
  return localStorage.getItem(storageKey(sub, conversationId));
}

export function markConversationRead(
  sub: string,
  conversationId: string,
  readAtIso: string,
): void {
  localStorage.setItem(storageKey(sub, conversationId), readAtIso);
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
  if (messages.length === 0) return lastReadAt;
  const latest = messages[messages.length - 1]?.createdAt;
  if (!latest) return lastReadAt;
  if (!lastReadAt) return latest;
  return new Date(latest).getTime() >= new Date(lastReadAt).getTime()
    ? latest
    : lastReadAt;
}
