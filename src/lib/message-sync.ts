import { useEffect, useState } from 'react';
import { Hub } from 'aws-amplify/utils';

import { client, type ConversationModel, type MessageModel } from './amplify';
import {
  playMessageSound,
  shouldAlertForIncomingMessage,
  showMessageNotification,
} from './app-notifications';
import type { SessionUser } from './session';
import { conversationTitle, isSameMessengerUser, messageListPreview } from './util';

export type IncomingMessageAlertContext = {
  items: MessageModel[];
  seedOnly: boolean;
  user: SessionUser;
  selectedConversationId: string | null;
  conversations: Map<string, ConversationModel>;
  subToUsername: Map<string, string>;
  knownMessageIds: Set<string>;
  resolveConversationId?: (conversationId: string) => string;
  alertedConversationAt?: Map<string, string>;
};

export type UnreadCountAlertContext = {
  previousCounts: Map<string, number>;
  nextCounts: Map<string, number>;
  latestByConversation: Map<string, { preview: string; at: string }>;
  conversations: Map<string, ConversationModel>;
  user: SessionUser;
  subToUsername: Map<string, string>;
  alertedConversationAt: Map<string, string>;
};

function resolveConversationId(
  conversationId: string,
  resolver?: (conversationId: string) => string,
): string {
  return resolver?.(conversationId) ?? conversationId;
}

function isViewingConversation(
  messageConversationId: string,
  selectedConversationId: string | null,
  resolver?: (conversationId: string) => string,
): boolean {
  if (!selectedConversationId) return false;
  return (
    resolveConversationId(messageConversationId, resolver) ===
    resolveConversationId(selectedConversationId, resolver)
  );
}

/** Load every message the signed-in user can read (fallback when live sync stalls). */
export async function fetchAllMessages(): Promise<MessageModel[]> {
  const merged: MessageModel[] = [];
  let nextToken: string | undefined;

  for (;;) {
    const page = await client.models.Message.list({
      authMode: 'userPool',
      limit: 200,
      nextToken,
    });
    if (page.errors?.length) {
      throw new Error(page.errors[0]?.message ?? 'Could not refresh messages');
    }
    merged.push(...page.data);
    if (!page.nextToken) break;
    nextToken = page.nextToken;
  }

  return merged;
}

/** Play sound / show browser notification for newly seen incoming messages. */
export function processIncomingMessageAlerts(ctx: IncomingMessageAlertContext): void {
  if (ctx.seedOnly) {
    for (const message of ctx.items) {
      ctx.knownMessageIds.add(message.id);
    }
    return;
  }

  for (const message of ctx.items) {
    if (ctx.knownMessageIds.has(message.id)) continue;
    if (!message.conversationId) continue;

    if (
      isSameMessengerUser(
        message.senderUsername,
        ctx.user.username,
        ctx.user.cognitoSub,
        ctx.subToUsername,
      )
    ) {
      ctx.knownMessageIds.add(message.id);
      continue;
    }

    const resolvedConversationId = resolveConversationId(
      message.conversationId,
      ctx.resolveConversationId,
    );
    const resolvedSelectedId = ctx.selectedConversationId
      ? resolveConversationId(ctx.selectedConversationId, ctx.resolveConversationId)
      : null;
    const tabHidden =
      typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const viewingSameChat =
      !tabHidden &&
      isViewingConversation(
        message.conversationId,
        ctx.selectedConversationId,
        ctx.resolveConversationId,
      );

    if (viewingSameChat) {
      ctx.knownMessageIds.add(message.id);
      continue;
    }

    if (
      !shouldAlertForIncomingMessage({
        conversationId: resolvedConversationId,
        selectedConversationId: resolvedSelectedId,
      })
    ) {
      continue;
    }

    ctx.knownMessageIds.add(message.id);

    const conversation =
      ctx.conversations.get(resolvedConversationId) ??
      ctx.conversations.get(message.conversationId);
    const title = conversation
      ? conversationTitle(
          conversation.participants,
          conversation.name,
          ctx.user.cognitoSub,
          ctx.user.username,
          ctx.subToUsername,
        )
      : 'New message';

    playMessageSound();
    showMessageNotification({
      conversationId: resolvedConversationId,
      title,
      body: messageListPreview(message),
    });
    ctx.alertedConversationAt?.set(resolvedConversationId, message.createdAt);
  }
}

/** Backup alert path when unread counts increase (covers mobile poll + badge updates). */
export function processUnreadCountAlerts(ctx: UnreadCountAlertContext): void {
  for (const [conversationId, nextCount] of ctx.nextCounts) {
    const previousCount = ctx.previousCounts.get(conversationId) ?? 0;
    if (nextCount <= previousCount || nextCount <= 0) continue;

    const latest = ctx.latestByConversation.get(conversationId);
    if (!latest) continue;

    const lastAlertAt = ctx.alertedConversationAt.get(conversationId);
    if (lastAlertAt && lastAlertAt >= latest.at) continue;

    ctx.alertedConversationAt.set(conversationId, latest.at);

    const conversation = ctx.conversations.get(conversationId);
    const title = conversation
      ? conversationTitle(
          conversation.participants,
          conversation.name,
          ctx.user.cognitoSub,
          ctx.user.username,
          ctx.subToUsername,
        )
      : 'New message';

    playMessageSound();
    showMessageNotification({
      conversationId,
      title,
      body: latest.preview,
    });
  }
}

/** Bump when auth tokens refresh or network returns — restarts AppSync subscriptions. */
export function useRealtimeSyncEpoch(): number {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const bump = () => setEpoch((value) => value + 1);

    const hubCancel = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'tokenRefresh' || payload.event === 'signedIn') {
        bump();
      }
    });

    window.addEventListener('online', bump);
    return () => {
      hubCancel();
      window.removeEventListener('online', bump);
    };
  }, []);

  return epoch;
}

/** Poll messages when the tab becomes visible again (WebSocket may have gone idle). */
export function useRefreshMessagesOnVisible(
  enabled: boolean,
  refresh: () => void | Promise<void>,
): void {
  useEffect(() => {
    if (!enabled) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, refresh]);
}

const MESSAGE_POLL_INTERVAL_MS = 5000;

/** Fallback poll while the tab is open — live AppSync sync should be ~1–2s; poll caps delay at 5s. */
export function usePeriodicMessageRefresh(
  enabled: boolean,
  refresh: () => void | Promise<void>,
  intervalMs = MESSAGE_POLL_INTERVAL_MS,
): void {
  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, refresh]);
}
