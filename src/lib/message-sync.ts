import { useEffect, useState } from 'react';
import { Hub } from 'aws-amplify/utils';

import { client, type ConversationModel, type MessageModel } from './amplify';
import {
  getAlertPrefs,
  playMessageSound,
  showMessageNotification,
  unlockNotificationSound,
} from './app-notifications';
import type { SessionUser } from './session';
import { conversationTitle, isSameMessengerUser, messageListPreview } from './util';

/** Tracks which messages existed at first sync vs which have already triggered an alert. */
export type MessageAlertState = {
  baselineMessageIds: Set<string>;
  alertedMessageIds: Set<string>;
  baselineReady: boolean;
};

export function createMessageAlertState(): MessageAlertState {
  return {
    baselineMessageIds: new Set(),
    alertedMessageIds: new Set(),
    baselineReady: false,
  };
}

export type IncomingMessageAlertContext = {
  items: MessageModel[];
  alertState: MessageAlertState;
  /** True when the snapshot is complete (initial sync or server poll). */
  markBaselineComplete?: boolean;
  user: SessionUser;
  selectedConversationId: string | null;
  conversations: Map<string, ConversationModel>;
  subToUsername: Map<string, string>;
};

function establishAlertBaseline(
  state: MessageAlertState,
  items: MessageModel[],
): void {
  for (const message of items) {
    if (message.id) {
      state.baselineMessageIds.add(message.id);
    }
  }
  state.baselineReady = true;
}

/** Play sound / show browser notification for newly arrived incoming messages. */
export function processIncomingMessageAlerts(ctx: IncomingMessageAlertContext): void {
  if (!ctx.alertState.baselineReady) {
    if (!ctx.markBaselineComplete) {
      return;
    }
    establishAlertBaseline(ctx.alertState, ctx.items);
    return;
  }

  const prefs = getAlertPrefs();

  for (const message of ctx.items) {
    if (!message.id || !message.conversationId) continue;
    if (ctx.alertState.baselineMessageIds.has(message.id)) continue;
    if (ctx.alertState.alertedMessageIds.has(message.id)) continue;

    if (
      isSameMessengerUser(
        message.senderUsername,
        ctx.user.username,
        ctx.user.cognitoSub,
        ctx.subToUsername,
      )
    ) {
      ctx.alertState.alertedMessageIds.add(message.id);
      continue;
    }

    ctx.alertState.alertedMessageIds.add(message.id);

    const conversation = ctx.conversations.get(message.conversationId);
    const title = conversation
      ? conversationTitle(
          conversation.participants,
          conversation.name,
          ctx.user.cognitoSub,
          ctx.user.username,
          ctx.subToUsername,
        )
      : 'New message';

    if (prefs.soundEnabled) {
      playMessageSound();
    }

    if (prefs.browserNotifications) {
      showMessageNotification({
        messageId: message.id,
        conversationId: message.conversationId,
        title,
        body: messageListPreview(message),
      });
    }
  }
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

/** Keep mobile audio unlocked after user interaction. */
export function useNotificationSoundUnlock(): void {
  useEffect(() => {
    const unlock = () => unlockNotificationSound();

    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        unlock();
      }
    });

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);
}
