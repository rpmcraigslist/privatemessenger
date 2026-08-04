import type { ConversationModel, MessageModel } from './amplify';
import { directConversationPeerKey } from './util';

export type DedupeConversationActivity = {
  preview: string;
  at: string;
};

/** Prefer the thread with the most messages, then the most recent activity. */
export function pickPreferredDirectConversation(
  candidates: ConversationModel[],
  messageCountByConversation: Map<string, number>,
  latestByConversation: Map<string, DedupeConversationActivity>,
): ConversationModel {
  const ranked = [...candidates].sort((a, b) => {
    const countDiff =
      (messageCountByConversation.get(b.id) ?? 0) -
      (messageCountByConversation.get(a.id) ?? 0);
    if (countDiff !== 0) return countDiff;

    const aAt =
      latestByConversation.get(a.id)?.at ??
      a.lastMessageAt ??
      a.createdAt ??
      '';
    const bAt =
      latestByConversation.get(b.id)?.at ??
      b.lastMessageAt ??
      b.createdAt ??
      '';
    const timeDiff = new Date(bAt).getTime() - new Date(aAt).getTime();
    if (timeDiff !== 0) return timeDiff;

    return a.id.localeCompare(b.id);
  });
  return ranked[0]!;
}

/**
 * Collapse duplicate 1:1 rows that map to the same peer key so the sidebar
 * shows one chat per person.
 */
export function dedupeDirectConversations(
  conversations: ConversationModel[],
  myUsername: string,
  mySub: string,
  handleToSub: Map<string, string>,
  messages: MessageModel[],
  latestByConversation: Map<string, DedupeConversationActivity>,
): {
  conversations: ConversationModel[];
  aliasToCanonicalId: Map<string, string>;
} {
  const messageCountByConversation = new Map<string, number>();
  for (const message of messages) {
    if (!message.conversationId) continue;
    messageCountByConversation.set(
      message.conversationId,
      (messageCountByConversation.get(message.conversationId) ?? 0) + 1,
    );
  }

  const groups = new Map<string, ConversationModel[]>();
  const passthrough: ConversationModel[] = [];

  for (const conversation of conversations) {
    const peerKey = directConversationPeerKey(
      conversation,
      myUsername,
      mySub,
      handleToSub,
    );
    if (!peerKey) {
      passthrough.push(conversation);
      continue;
    }
    const bucket = groups.get(peerKey) ?? [];
    bucket.push(conversation);
    groups.set(peerKey, bucket);
  }

  const aliasToCanonicalId = new Map<string, string>();
  const deduped: ConversationModel[] = [...passthrough];

  for (const bucket of groups.values()) {
    const keeper = pickPreferredDirectConversation(
      bucket,
      messageCountByConversation,
      latestByConversation,
    );
    deduped.push(keeper);
    for (const conversation of bucket) {
      aliasToCanonicalId.set(conversation.id, keeper.id);
    }
  }

  return { conversations: deduped, aliasToCanonicalId };
}
