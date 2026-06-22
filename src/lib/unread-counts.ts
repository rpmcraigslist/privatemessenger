import type { ConversationModel, MessageModel } from './amplify';
import {
  countUnreadMessages,
  getLastReadAt,
  latestMessageTimestamp,
  messagesForReadScope,
  resolveReadScopeKey,
} from './read-state';

/** Synchronous unread counts from in-memory messages (no stale API races). */
export function computeUnreadCounts(
  visibleConversations: ConversationModel[],
  allConversations: ConversationModel[],
  allMessages: MessageModel[],
  selectedId: string | null,
  myUsername: string,
  mySub: string,
  subToUsername: Map<string, string>,
  handleToSub: Map<string, string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const conversation of visibleConversations) {
    if (conversation.id === selectedId) {
      counts.set(conversation.id, 0);
      continue;
    }

    const scopedMessages = messagesForReadScope(
      conversation,
      allConversations,
      allMessages,
      myUsername,
      mySub,
      handleToSub,
    );
    const readScopeKey = resolveReadScopeKey(
      conversation,
      myUsername,
      mySub,
      handleToSub,
    );
    const lastReadAt = getLastReadAt(
      mySub,
      myUsername,
      readScopeKey,
      conversation.id,
    );

    counts.set(
      conversation.id,
      countUnreadMessages(
        scopedMessages,
        lastReadAt,
        myUsername,
        mySub,
        subToUsername,
        handleToSub,
      ),
    );
  }
  return counts;
}

export function totalUnreadCount(counts: Map<string, number>): number {
  return Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
}

/** Timestamp to mark a thread fully read from loaded messages. */
export function readThroughTimestampForConversation(
  conversation: ConversationModel,
  allConversations: ConversationModel[],
  allMessages: MessageModel[],
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
): string | null {
  const scopedMessages = messagesForReadScope(
    conversation,
    allConversations,
    allMessages,
    myUsername,
    mySub,
    handleToSub,
  );
  return latestMessageTimestamp(scopedMessages);
}
