import type { ConversationModel, MessageModel } from './amplify';
import { countUnreadMessages, getLastReadAt } from './read-state';

/** Synchronous unread counts from in-memory messages (no stale API races). */
export function computeUnreadCounts(
  conversations: ConversationModel[],
  allMessages: MessageModel[],
  selectedId: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
): Map<string, number> {
  const messagesByConversation = new Map<string, MessageModel[]>();
  for (const message of allMessages) {
    if (!message.conversationId) continue;
    const bucket = messagesByConversation.get(message.conversationId);
    if (bucket) bucket.push(message);
    else messagesByConversation.set(message.conversationId, [message]);
  }

  const counts = new Map<string, number>();
  for (const conversation of conversations) {
    if (conversation.id === selectedId) {
      counts.set(conversation.id, 0);
      continue;
    }
    const lastReadAt = getLastReadAt(mySub, myUsername, conversation.id);
    const messages = messagesByConversation.get(conversation.id) ?? [];
    counts.set(
      conversation.id,
      countUnreadMessages(
        messages,
        lastReadAt,
        myUsername,
        mySub,
        subToUsername,
      ),
    );
  }
  return counts;
}

export function totalUnreadCount(counts: Map<string, number>): number {
  return Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
}
