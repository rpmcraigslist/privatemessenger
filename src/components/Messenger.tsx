import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { client, type ConversationModel, type MessageModel } from '../lib/amplify';

import {

  clearUnreadIndicators,

  setNotificationClickHandler,

  syncUnreadIndicators,

  unlockNotificationSound,

} from '../lib/app-notifications';

import { loadUserDirectory } from '../lib/directory';

import { resolveCurrentUser, type SessionUser } from '../lib/session';

import { loadServerReadState, installReadStateFlushHooks } from '../lib/read-state-sync';

import { consumePendingDeepLink } from '../lib/deep-link';

import { computeUnreadCounts, totalUnreadCount } from '../lib/unread-counts';

import {

  applyGlobalMessageSnapshot,

  mergeMessages,

  removeMessageById,

} from '../lib/message-merge';

import {

  fetchAllMessages,

  processIncomingMessageAlerts,

  useRealtimeSyncEpoch,

  useRefreshMessagesOnVisible,

} from '../lib/message-sync';

import {

  buildParticipantDirectory,

  buildHandleToSubDirectory,

  dedupeDirectConversations,

  messageListPreview,

} from '../lib/util';

import ConversationList from './ConversationList';

import ChatView from './ChatView';

import NewChatModal from './NewChatModal';

import AdminPanel from './AdminPanel';

import ProfileSettings from './ProfileSettings';

import NotificationPrompt from './NotificationPrompt';

import {

  useSystemBackNavigation,

} from '../lib/back-navigation';

import type { ChatBackHandle } from './ChatView';



type Props = {

  onSignOut: () => void;

};



type LatestMessagePreview = {

  preview: string;

  at: string;

};



function conversationActivityAt(

  conversation: ConversationModel,

  latestByConversation: Map<string, LatestMessagePreview>,

): string {

  return (

    latestByConversation.get(conversation.id)?.at ??

    conversation.lastMessageAt ??

    conversation.createdAt

  );

}



export default function Messenger({ onSignOut }: Props) {

  const [user, setUser] = useState<SessionUser | null>(null);

  const [bootError, setBootError] = useState<string | null>(null);
  const [bootRetrying, setBootRetrying] = useState(false);

  const [conversations, setConversations] = useState<ConversationModel[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);

  const [showNewChat, setShowNewChat] = useState(false);

  const [showAdmin, setShowAdmin] = useState(false);

  const [showProfile, setShowProfile] = useState(false);

  const [loading, setLoading] = useState(true);

  const [readRevision, setReadRevision] = useState(0);

  const [subToUsername, setSubToUsername] = useState<Map<string, string>>(

    () => new Map(),

  );

  const [handleToSub, setHandleToSub] = useState<Map<string, string>>(

    () => new Map(),

  );

  const [latestByConversation, setLatestByConversation] = useState<

    Map<string, LatestMessagePreview>

  >(() => new Map());

  const [allMessages, setAllMessages] = useState<MessageModel[]>([]);

  const [messagesSynced, setMessagesSynced] = useState(false);

  const [optimisticConversations, setOptimisticConversations] = useState<

    ConversationModel[]

  >([]);



  const selectedIdRef = useRef<string | null>(null);

  const userRef = useRef<SessionUser | null>(null);

  const subToUsernameRef = useRef(subToUsername);

  const conversationsRef = useRef<Map<string, ConversationModel>>(new Map());

  const knownMessageIdsRef = useRef(new Set<string>());

  const pendingOptimisticMessagesRef = useRef(new Map<string, MessageModel>());

  const messageSyncReadyRef = useRef(false);

  const realtimeSyncEpoch = useRealtimeSyncEpoch();

  const chatBackRef = useRef<ChatBackHandle | null>(null);

  const uiStateRef = useRef({

    showNewChat: false,

    showAdmin: false,

    showProfile: false,

    selectedId: null as string | null,

  });



  selectedIdRef.current = selectedId;

  userRef.current = user;

  subToUsernameRef.current = subToUsername;

  conversationsRef.current = new Map(conversations.map((c) => [c.id, c]));

  uiStateRef.current = {

    showNewChat,

    showAdmin,

    showProfile,

    selectedId,

  };



  useSystemBackNavigation(() => {

    if (chatBackRef.current?.handleBack()) {
      return { handled: true, keepLayer: true };
    }

    const ui = uiStateRef.current;

    if (ui.showNewChat) {

      setShowNewChat(false);

      return {
        handled: true,
        keepLayer: !!(ui.selectedId || ui.showAdmin || ui.showProfile),
      };

    }

    if (ui.showProfile) {

      setShowProfile(false);

      return {
        handled: true,
        keepLayer: !!(ui.selectedId || ui.showNewChat || ui.showAdmin),
      };

    }

    if (ui.showAdmin) {

      setShowAdmin(false);

      return {
        handled: true,
        keepLayer: !!(ui.selectedId || ui.showNewChat || ui.showProfile),
      };

    }

    if (ui.selectedId) {

      setSelectedId(null);

      return { handled: true, keepLayer: false };

    }

    return false;

  }, !!(selectedId || showNewChat || showAdmin || showProfile));



  const reloadDirectory = useCallback(async () => {

    try {

      const profiles = await loadUserDirectory();

      setSubToUsername(buildParticipantDirectory(profiles));

      setHandleToSub(buildHandleToSubDirectory(profiles));

    } catch (err) {

      console.error('failed to load profile directory', err);

    }

  }, []);



  const loadAccount = useCallback(async () => {

    const sessionUser = await resolveCurrentUser();

    await loadServerReadState(sessionUser.cognitoSub, sessionUser.username);

    setUser(sessionUser);

    setBootError(null);

    return sessionUser;

  }, []);



  useEffect(() => {

    let active = true;

    (async () => {

      try {

        await loadAccount();

        if (!active) return;

      } catch (err) {

        console.error('failed to load account', err);

        if (!active) return;

        const message =

          err instanceof Error

            ? err.message

            : 'Could not load your profile. Try again or hard-refresh after deploy.';

        setBootError(message);

      }

    })();

    return () => {

      active = false;

    };

  }, [loadAccount]);



  useEffect(() => {

    if (!user) return;

    void reloadDirectory();

  }, [user?.username, reloadDirectory]);



  useEffect(() => {

    if (!user) return;

    return installReadStateFlushHooks();

  }, [user?.cognitoSub]);



  useEffect(() => {

    if (!user) return;

    const pending = consumePendingDeepLink();

    if (!pending) return;

    setSelectedId(pending.conversationId);

    setFocusMessageId(pending.messageId ?? null);

  }, [user?.cognitoSub]);



  useEffect(() => {

    if (!user) return;

    setLoading(true);

    const sub = client.models.Conversation.observeQuery().subscribe({

      next: ({ items }) => {

        setConversations(items);

        setLoading(false);

      },

      error: (err) => {

        console.error('conversation subscription error', err);

        setLoading(false);

      },

    });

    return () => sub.unsubscribe();

  }, [user?.cognitoSub, realtimeSyncEpoch]);



  const refreshMessagesFromServer = useCallback(async () => {

    if (!userRef.current) return;

    try {

      const items = await fetchAllMessages();

      setAllMessages((prev) =>

        applyGlobalMessageSnapshot(

          prev,

          items,

          knownMessageIdsRef.current,

          pendingOptimisticMessagesRef.current,

        ),

      );

      setMessagesSynced(true);

      processIncomingMessageAlerts({

        items,

        seedOnly: !messageSyncReadyRef.current,

        user: userRef.current,

        selectedConversationId: selectedIdRef.current,

        conversations: conversationsRef.current,

        subToUsername: subToUsernameRef.current,

        knownMessageIds: knownMessageIdsRef.current,

      });

      messageSyncReadyRef.current = true;

    } catch (err) {

      console.error('message refresh failed', err);

    }

  }, []);



  useRefreshMessagesOnVisible(Boolean(user), refreshMessagesFromServer);



  useEffect(() => {

    if (!user || realtimeSyncEpoch === 0) return;

    void refreshMessagesFromServer();

  }, [realtimeSyncEpoch, refreshMessagesFromServer, user]);



  useEffect(() => {

    setOptimisticConversations((prev) =>

      prev.filter(

        (conversation) =>

          !conversations.some((existing) => existing.id === conversation.id),

      ),

    );

  }, [conversations]);



  const mergedConversations = useMemo(() => {

    const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));

    for (const conversation of optimisticConversations) {

      if (!byId.has(conversation.id)) {

        byId.set(conversation.id, conversation);

      }

    }

    const merged = [...byId.values()];

    if (!user) return merged;

    return dedupeDirectConversations(

      merged,

      (conversation) => conversationActivityAt(conversation, latestByConversation),

      user.username,

      user.cognitoSub,

      handleToSub,

    );

  }, [

    conversations,

    handleToSub,

    latestByConversation,

    optimisticConversations,

    user,

  ]);



  useEffect(() => {

    if (!user) return;

    knownMessageIdsRef.current.clear();

    pendingOptimisticMessagesRef.current.clear();

    messageSyncReadyRef.current = false;



    const sub = client.models.Message.observeQuery().subscribe({

      next: ({ items, isSynced }) => {

        if (isSynced) {

          for (const message of items) {

            pendingOptimisticMessagesRef.current.delete(message.id);

          }

        }

        setAllMessages((prev) =>

          isSynced

            ? applyGlobalMessageSnapshot(

                prev,

                items,

                knownMessageIdsRef.current,

                pendingOptimisticMessagesRef.current,

              )

            : mergeMessages(prev, items),

        );

        setMessagesSynced(isSynced);



        const next = new Map<string, LatestMessagePreview>();

        const merged = mergeMessages([], items);

        for (const message of merged) {

          if (!message.conversationId) continue;

          const current = next.get(message.conversationId);

          if (

            current &&

            new Date(current.at).getTime() >= new Date(message.createdAt).getTime()

          ) {

            continue;

          }

          next.set(message.conversationId, {

            preview: messageListPreview(message),

            at: message.createdAt,

          });

        }

        setLatestByConversation(next);



        if (!isSynced) return;



        const currentUser = userRef.current;

        if (!currentUser) return;



        if (!messageSyncReadyRef.current) {

          processIncomingMessageAlerts({

            items,

            seedOnly: true,

            user: currentUser,

            selectedConversationId: selectedIdRef.current,

            conversations: conversationsRef.current,

            subToUsername: subToUsernameRef.current,

            knownMessageIds: knownMessageIdsRef.current,

          });

          messageSyncReadyRef.current = true;

          return;

        }

        processIncomingMessageAlerts({

          items,

          seedOnly: false,

          user: currentUser,

          selectedConversationId: selectedIdRef.current,

          conversations: conversationsRef.current,

          subToUsername: subToUsernameRef.current,

          knownMessageIds: knownMessageIdsRef.current,

        });

      },

      error: (err) => {

        console.error('message preview subscription error', err);

      },

    });

    return () => sub.unsubscribe();

  }, [user?.cognitoSub, realtimeSyncEpoch]);



  const conversationsForList = useMemo(

    () =>

      [...mergedConversations].sort(

        (a, b) =>

          new Date(conversationActivityAt(b, latestByConversation)).getTime() -

          new Date(conversationActivityAt(a, latestByConversation)).getTime(),

      ),

    [mergedConversations, latestByConversation],

  );



  const unreadCounts = useMemo(() => {

    if (!user || mergedConversations.length === 0) {

      return new Map<string, number>();

    }

    return computeUnreadCounts(

      mergedConversations,

      conversations,

      allMessages,

      selectedId,

      user.username,

      user.cognitoSub,

      subToUsername,

      handleToSub,

    );

  }, [

    allMessages,

    conversations,

    handleToSub,

    mergedConversations,

    readRevision,

    selectedId,

    subToUsername,

    user,

  ]);



  const handleConversationUpdated = useCallback(() => {

    setReadRevision((revision) => revision + 1);

  }, []);



  const handleSelectConversation = useCallback(

    (conversationId: string) => {

      setSelectedId(conversationId);

    },

    [],

  );



  const handleMessageCreated = useCallback((message: MessageModel) => {

    if (!message.id) return;

    const normalized =

      message.createdAt != null

        ? message

        : { ...message, createdAt: new Date().toISOString() };

    knownMessageIdsRef.current.add(normalized.id);

    pendingOptimisticMessagesRef.current.set(normalized.id, normalized);

    setAllMessages((prev) => mergeMessages(prev, [normalized]));

    if (normalized.conversationId) {

      setLatestByConversation((prev) => {

        const next = new Map(prev);

        const current = next.get(normalized.conversationId!);

        if (

          current &&

          new Date(current.at).getTime() >= new Date(normalized.createdAt).getTime()

        ) {

          return prev;

        }

        next.set(normalized.conversationId!, {

          preview: messageListPreview(normalized),

          at: normalized.createdAt,

        });

        return next;

      });

    }

  }, []);



  const handleMessageDeleted = useCallback((messageId: string) => {

    knownMessageIdsRef.current.delete(messageId);

    pendingOptimisticMessagesRef.current.delete(messageId);

    setAllMessages((prev) => removeMessageById(prev, messageId));

  }, []);



  const handleConversationRenamed = useCallback(

    (conversationId: string, name: string | null) => {

      setConversations((prev) =>

        prev.map((c) => (c.id === conversationId ? { ...c, name } : c)),

      );

    },

    [],

  );



  const totalUnread = useMemo(

    () => totalUnreadCount(unreadCounts),

    [unreadCounts],

  );



  useEffect(() => {

    void syncUnreadIndicators(totalUnread);

  }, [totalUnread]);



  useEffect(() => {

    setNotificationClickHandler((conversationId) => {

      handleSelectConversation(conversationId);

    });

    return () => {

      setNotificationClickHandler(null);

      void clearUnreadIndicators();

    };

  }, [handleSelectConversation]);



  useEffect(() => {

    function unlockOnInteraction() {

      unlockNotificationSound();

    }

    window.addEventListener('pointerdown', unlockOnInteraction, { once: true });

    return () => window.removeEventListener('pointerdown', unlockOnInteraction);

  }, []);



  const selected = useMemo(

    () => mergedConversations.find((c) => c.id === selectedId) ?? null,

    [mergedConversations, selectedId],

  );



  const selectedMessages = useMemo(() => {

    if (!selectedId) return [];

    return allMessages

      .filter((message) => message.conversationId === selectedId)

      .sort(

        (a, b) =>

          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),

      );

  }, [allMessages, selectedId]);



  if (bootError) {

    return (

      <div className="grid min-h-dvh place-items-center px-6 text-center">

        <div className="max-w-sm space-y-4">

          <p className="text-sm text-red-400">{bootError}</p>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">

            <button

              type="button"

              disabled={bootRetrying}

              onClick={() => {

                setBootRetrying(true);

                void loadAccount()

                  .catch((err) => {

                    const message =

                      err instanceof Error

                        ? err.message

                        : 'Could not load your profile.';

                    setBootError(message);

                  })

                  .finally(() => setBootRetrying(false));

              }}

              className="rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-50"

              style={{ background: 'var(--color-accent)' }}

            >

              {bootRetrying ? 'Retrying…' : 'Try again'}

            </button>

            <button

              type="button"

              onClick={() => onSignOut()}

              className="rounded-full border border-white/20 px-4 py-2 text-sm text-[var(--color-muted)] hover:text-white"

            >

              Sign out

            </button>

          </div>

        </div>

      </div>

    );

  }



  if (!user) {

    return (

      <div className="grid min-h-dvh place-items-center text-[var(--color-muted)]">

        Loading your account…

      </div>

    );

  }



  return (

    <div className="app-viewport flex bg-[var(--color-app-bg)]">

      <aside

        className={`${

          selectedId ? 'hidden md:flex' : 'flex'

        } h-full w-full flex-col border-r border-black/30 bg-[var(--color-panel)] md:w-[380px] md:shrink-0`}

      >

        <ConversationList

          myUsername={user.username}

          mySub={user.cognitoSub}

          subToUsername={subToUsername}

          isAdmin={user.isAdmin}

          conversations={conversationsForList}

          latestByConversation={latestByConversation}

          selectedId={selectedId}

          loading={loading}

          unreadCounts={unreadCounts}

          onSelect={handleSelectConversation}

          onNewChat={() => setShowNewChat(true)}

          onOpenAdmin={() => setShowAdmin(true)}

          onOpenProfile={() => setShowProfile(true)}

          onSignOut={onSignOut}

        />

      </aside>



      <main

        className={`${

          selectedId ? 'flex' : 'hidden md:flex'

        } h-full min-h-0 max-h-full min-w-0 flex-1 flex-col overflow-hidden`}

      >

        {selected ? (

          <ChatView

            key={selected.id}

            conversation={selected}

            messages={selectedMessages}

            messagesSynced={messagesSynced}

            myUsername={user.username}

            mySub={user.cognitoSub}

            handleToSub={handleToSub}

            subToUsername={subToUsername}

            chatBackRef={chatBackRef}

            onBack={() => {

              if (chatBackRef.current?.handleBack()) return;

              setSelectedId(null);

            }}

            onConversationUpdated={handleConversationUpdated}

            onConversationRenamed={(name) =>

              handleConversationRenamed(selected.id, name)

            }

            onMessageCreated={handleMessageCreated}

            onMessageDeleted={handleMessageDeleted}

            focusMessageId={focusMessageId}

            onFocusMessageHandled={() => setFocusMessageId(null)}

          />

        ) : (

          <EmptyState />

        )}

      </main>



      {showNewChat && (

        <NewChatModal

          open={showNewChat}

          mySub={user.cognitoSub}

          myUsername={user.username}

          handleToSub={handleToSub}

          existing={mergedConversations}

          onClose={() => setShowNewChat(false)}

          onCreated={(id, conversation) => {

            setOptimisticConversations((prev) => {

              if (prev.some((c) => c.id === id)) return prev;

              return [...prev, conversation];

            });

            setSelectedId(id);

            setShowNewChat(false);

          }}

        />

      )}



        {showAdmin && user.isAdmin && (

        <AdminPanel

          onClose={() => {

            setShowAdmin(false);

            void reloadDirectory();

          }}

          onDataRepaired={() => {

            window.location.reload();

          }}

        />

      )}



      {showProfile && (

        <ProfileSettings

          user={user}

          onClose={() => setShowProfile(false)}

          onSaved={(update) =>

            setUser((prev) => (prev ? { ...prev, ...update } : prev))

          }

        />

      )}



      <NotificationPrompt />

    </div>

  );

}



function EmptyState() {

  return (

    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">

      <div

        className="flex h-20 w-20 items-center justify-center rounded-full"

        style={{ background: 'var(--color-panel-2)' }}

      >

        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden>

          <path

            d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5H9l-4 4v-4H5.5C4.67 16 4 15.33 4 14.5v-9Z"

            fill="var(--color-accent)"

          />

        </svg>

      </div>

      <h2 className="text-xl font-medium">Private Messenger</h2>

      <p className="max-w-sm text-sm text-[var(--color-muted)]">

        Select a conversation or start a new one.

      </p>

    </div>

  );

}


