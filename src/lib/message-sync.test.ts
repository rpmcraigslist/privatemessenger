import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConversationModel, MessageModel } from './amplify';
import {
  createMessageAlertState,
  processIncomingMessageAlerts,
} from './message-sync';
import type { SessionUser } from './session';
import { isWebPushRegisteredLocally } from './web-push';

vi.mock('./amplify', () => ({
  client: { models: { Message: { list: vi.fn() } } },
}));

const playMessageSound = vi.fn();
const showMessageNotification = vi.fn();

vi.mock('./app-notifications', () => ({
  getAlertPrefs: () => ({ browserNotifications: true, soundEnabled: true }),
  playMessageSound: (...args: unknown[]) => playMessageSound(...args),
  showMessageNotification: (...args: unknown[]) => showMessageNotification(...args),
  unlockNotificationSound: vi.fn(),
}));

vi.mock('./web-push', () => ({
  isWebPushRegisteredLocally: vi.fn(() => false),
}));

const user: SessionUser = {
  username: 'alice',
  cognitoSub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  isAdmin: false,
  contactEmail: null,
  profileId: null,
  messageBubbleColor: null,
};

function message(
  id: string,
  conversationId: string,
  sender = 'bob',
  createdAt = '2026-06-20T12:00:00.000Z',
): MessageModel {
  return {
    id,
    conversationId,
    senderUsername: sender,
    participantUsernames: [user.cognitoSub, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    createdAt,
    updatedAt: createdAt,
  } as MessageModel;
}

describe('processIncomingMessageAlerts', () => {
  beforeEach(() => {
    playMessageSound.mockClear();
    showMessageNotification.mockClear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('does not alert for messages in the login baseline', () => {
    const alertState = createMessageAlertState();
    establishBaseline(alertState, [message('m1', 'conv-b')]);

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-b')],
      alertState,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
    });

    expect(playMessageSound).not.toHaveBeenCalled();
  });

  it('alerts for a new message after baseline is established', () => {
    const alertState = createMessageAlertState();
    establishBaseline(alertState, [message('old', 'conv-b', 'bob', '2026-06-20T11:00:00.000Z')]);

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-b')],
      alertState,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
    });

    expect(playMessageSound).toHaveBeenCalledTimes(1);
    expect(showMessageNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'm1',
        conversationId: 'conv-b',
      }),
    );
  });

  it('alerts while viewing the same chat', () => {
    const alertState = createMessageAlertState();
    establishBaseline(alertState, []);

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-a')],
      alertState,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
    });

    expect(playMessageSound).toHaveBeenCalledTimes(1);
    expect(showMessageNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'm1',
        conversationId: 'conv-a',
      }),
    );
  });

  it('keeps alerting new messages after token-style resync without re-baselining', () => {
    const alertState = createMessageAlertState();
    establishBaseline(alertState, [message('old', 'conv-b')]);

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-b'), message('m2', 'conv-b', 'bob', '2026-06-20T12:01:00.000Z')],
      alertState,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
    });
    expect(playMessageSound).toHaveBeenCalledTimes(2);
    playMessageSound.mockClear();

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-b'), message('m2', 'conv-b', 'bob', '2026-06-20T12:01:00.000Z')],
      markBaselineComplete: true,
      alertState,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
    });
    expect(playMessageSound).not.toHaveBeenCalled();

    processIncomingMessageAlerts({
      items: [message('m3', 'conv-b', 'bob', '2026-06-20T12:02:00.000Z')],
      alertState,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
    });
    expect(playMessageSound).toHaveBeenCalledTimes(1);
  });

  it('skips in-app pop-up when Web Push is registered locally', () => {
    vi.mocked(isWebPushRegisteredLocally).mockReturnValue(true);

    const alertState = createMessageAlertState();
    establishBaseline(alertState, []);

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-b')],
      alertState,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
    });

    expect(playMessageSound).toHaveBeenCalledTimes(1);
    expect(showMessageNotification).not.toHaveBeenCalled();

    vi.mocked(isWebPushRegisteredLocally).mockReturnValue(false);
  });
});

function establishBaseline(
  alertState: ReturnType<typeof createMessageAlertState>,
  items: MessageModel[],
): void {
  processIncomingMessageAlerts({
    items,
    markBaselineComplete: true,
    alertState,
    user,
    selectedConversationId: null,
    conversations: new Map<string, ConversationModel>(),
    subToUsername: new Map(),
  });
}
