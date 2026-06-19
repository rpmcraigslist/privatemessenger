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

export function countUnreadMessages(
  messages: MessageModel[],
  lastReadAt: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
): number {
  const lastReadMs = lastReadAt ? new Date(lastReadAt).getTime() : 0;
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
    return new Date(message.createdAt).getTime() > lastReadMs;
  }).length;
}

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
