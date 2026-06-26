import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ConversationModel, MessageModel } from './amplify';
import {
  processIncomingMessageAlerts,
  processUnreadCountAlerts,
} from './message-sync';
import type { SessionUser } from './session';

vi.mock('./amplify', () => ({
  client: { models: { Message: { list: vi.fn() } } },
}));

const playMessageSound = vi.fn();
const showMessageNotification = vi.fn();

vi.mock('./app-notifications', () => ({
  playMessageSound: (...args: unknown[]) => playMessageSound(...args),
  showMessageNotification: (...args: unknown[]) => showMessageNotification(...args),
  shouldAlertForIncomingMessage: (options: {
    conversationId: string;
    selectedConversationId: string | null;
  }) => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return true;
    }
    return options.conversationId !== options.selectedConversationId;
  },
}));

const user: SessionUser = {
  username: 'alice',
  cognitoSub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  isAdmin: false,
  contactEmail: null,
  profileId: null,
  messageBubbleColor: null,
};

function message(id: string, conversationId: string, sender = 'bob'): MessageModel {
  return {
    id,
    conversationId,
    senderUsername: sender,
    participantUsernames: [user.cognitoSub, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    createdAt: '2026-06-20T12:00:00.000Z',
    updatedAt: '2026-06-20T12:00:00.000Z',
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

  it('alerts for a new message in another chat', () => {
    const knownMessageIds = new Set<string>();
    processIncomingMessageAlerts({
      items: [message('m1', 'conv-b')],
      seedOnly: false,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
      knownMessageIds,
    });

    expect(playMessageSound).toHaveBeenCalledTimes(1);
    expect(showMessageNotification).toHaveBeenCalledTimes(1);
    expect(knownMessageIds.has('m1')).toBe(true);
  });

  it('does not alert while viewing the same chat', () => {
    const knownMessageIds = new Set<string>();
    processIncomingMessageAlerts({
      items: [message('m1', 'conv-a')],
      seedOnly: false,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
      knownMessageIds,
    });

    expect(playMessageSound).not.toHaveBeenCalled();
    expect(knownMessageIds.has('m1')).toBe(true);
  });

  it('retries alert after a message was seen in another chat without notifying', () => {
    const knownMessageIds = new Set<string>();

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-b')],
      seedOnly: false,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
      knownMessageIds,
    });
    expect(playMessageSound).toHaveBeenCalledTimes(1);
    playMessageSound.mockClear();

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-b')],
      seedOnly: false,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
      knownMessageIds,
    });
    expect(playMessageSound).not.toHaveBeenCalled();
  });

  it('alerts when the tab is hidden even if that chat is selected', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const knownMessageIds = new Set<string>();

    processIncomingMessageAlerts({
      items: [message('m1', 'conv-a')],
      seedOnly: false,
      user,
      selectedConversationId: 'conv-a',
      conversations: new Map<string, ConversationModel>(),
      subToUsername: new Map(),
      knownMessageIds,
    });

    expect(playMessageSound).toHaveBeenCalledTimes(1);
  });
});

describe('processUnreadCountAlerts', () => {
  beforeEach(() => {
    playMessageSound.mockClear();
    showMessageNotification.mockClear();
  });

  it('alerts when unread count increases for a conversation', () => {
    processUnreadCountAlerts({
      previousCounts: new Map([['conv-b', 0]]),
      nextCounts: new Map([['conv-b', 1]]),
      latestByConversation: new Map([
        ['conv-b', { preview: 'Hello there', at: '2026-06-20T12:00:00.000Z' }],
      ]),
      conversations: new Map([
        [
          'conv-b',
          {
            id: 'conv-b',
            participants: [user.cognitoSub, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
            isGroup: false,
          } as ConversationModel,
        ],
      ]),
      user,
      subToUsername: new Map(),
      alertedConversationAt: new Map(),
    });

    expect(playMessageSound).toHaveBeenCalledTimes(1);
    expect(showMessageNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-b',
        body: 'Hello there',
      }),
    );
  });
});
