import type { MessageModel } from './amplify';

/** Add or update messages by id (does not remove stale or deleted rows). */
export function mergeMessages(
  existing: MessageModel[],
  incoming: MessageModel[],
): MessageModel[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()];
}

/**
 * Merge subscription rows for one conversation without dropping optimistic sends
 * that are not yet in the subscription snapshot.
 */
export function mergeConversationMessages(
  existing: MessageModel[],
  conversationId: string,
  incoming: MessageModel[],
  retainMessageIds: ReadonlySet<string> = new Set(),
): MessageModel[] {
  const others = existing.filter(
    (message) => message.conversationId !== conversationId,
  );
  const incomingIds = new Set(incoming.map((message) => message.id));
  const conversationExisting = existing.filter(
    (message) => message.conversationId === conversationId,
  );
  const byId = new Map(conversationExisting.map((message) => [message.id, message]));

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  for (const id of [...byId.keys()]) {
    if (!incomingIds.has(id) && !retainMessageIds.has(id)) {
      byId.delete(id);
    }
  }

  return [...others, ...byId.values()];
}

/**
 * Apply a server list snapshot without erasing messages that just arrived via
 * subscription (AppSync list can lag a moment behind live create events).
 */
export function applyGlobalMessageSnapshot(
  existing: MessageModel[],
  snapshot: MessageModel[],
  optimisticIds: ReadonlySet<string>,
  optimisticMessages: ReadonlyMap<string, MessageModel> = new Map(),
  options: { retainNewerThanMs?: number; nowMs?: number } = {},
): MessageModel[] {
  const retainNewerThanMs = options.retainNewerThanMs ?? 15_000;
  const nowMs = options.nowMs ?? Date.now();
  const byId = new Map(snapshot.map((message) => [message.id, message]));

  for (const message of existing) {
    if (byId.has(message.id)) continue;
    if (optimisticIds.has(message.id)) {
      byId.set(message.id, message);
      continue;
    }
    const createdMs = message.createdAt
      ? new Date(message.createdAt).getTime()
      : NaN;
    if (
      !Number.isNaN(createdMs) &&
      nowMs - createdMs <= retainNewerThanMs
    ) {
      // Keep freshly subscribed messages until the next poll catches up.
      byId.set(message.id, message);
    }
  }

  for (const id of optimisticIds) {
    if (!byId.has(id) && optimisticMessages.has(id)) {
      byId.set(id, optimisticMessages.get(id)!);
    }
  }
  return [...byId.values()];
}

export function removeMessageById(
  messages: MessageModel[],
  messageId: string,
): MessageModel[] {
  return messages.filter((message) => message.id !== messageId);
}
