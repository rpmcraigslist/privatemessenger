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
};

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
    ctx.knownMessageIds.add(message.id);
    if (!message.conversationId) continue;

    if (
      isSameMessengerUser(
        message.senderUsername,
        ctx.user.username,
        ctx.user.cognitoSub,
        ctx.subToUsername,
      )
    ) {
      continue;
    }

    if (
      !shouldAlertForIncomingMessage({
        conversationId: ctx.resolveConversationId
          ? ctx.resolveConversationId(message.conversationId)
          : message.conversationId,
        selectedConversationId: ctx.selectedConversationId
          ? ctx.resolveConversationId
            ? ctx.resolveConversationId(ctx.selectedConversationId)
            : ctx.selectedConversationId
          : null,
      })
    ) {
      continue;
    }

    const resolvedConversationId = ctx.resolveConversationId
      ? ctx.resolveConversationId(message.conversationId)
      : message.conversationId;
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
