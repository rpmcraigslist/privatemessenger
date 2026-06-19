import { useCallback, useEffect, useMemo, useState } from 'react';
import { client, type ConversationModel } from '../lib/amplify';
import { loadUserDirectory } from '../lib/directory';
import { fetchUnreadCount, getLastReadAt } from '../lib/read-state';
import { resolveCurrentUser, type SessionUser } from '../lib/session';
import { buildParticipantDirectory } from '../lib/util';
import ConversationList from './ConversationList';
import ChatView from './ChatView';
import NewChatModal from './NewChatModal';
import AdminPanel from './AdminPanel';
import ProfileSettings from './ProfileSettings';

type Props = {
  onSignOut: () => void;
};

export default function Messenger({ onSignOut }: Props) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [subToUsername, setSubToUsername] = useState<Map<string, string>>(
    () => new Map(),
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const sessionUser = await resolveCurrentUser();
        if (!active) return;
        setUser(sessionUser);
      } catch (err) {
        console.error('failed to load account', err);
        if (!active) return;
        setBootError('Session expired. Please sign in again.');
        onSignOut();
      }
    })();
    return () => {
      active = false;
    };
  }, [onSignOut]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const profiles = await loadUserDirectory();
        setSubToUsername(buildParticipantDirectory(profiles));
      } catch (err) {
        console.error('failed to load profile directory', err);
      }
    })();
  }, [user?.username]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const sub = client.models.Conversation.observeQuery().subscribe({
      next: ({ items }) => {
        const sorted = [...items].sort(
          (a, b) =>
            new Date(b.lastMessageAt ?? b.createdAt).getTime() -
            new Date(a.lastMessageAt ?? a.createdAt).getTime(),
        );
        setConversations(sorted);
        setLoading(false);
      },
      error: (err) => {
        console.error('conversation subscription error', err);
        setLoading(false);
      },
    });
    return () => sub.unsubscribe();
  }, [user?.username]);

  const refreshUnreadCounts = useCallback(async () => {
    if (!user) return;
    const entries = await Promise.all(
      conversations.map(async (conversation) => {
        if (conversation.id === selectedId) {
          return [conversation.id, 0] as const;
        }
        const count = await fetchUnreadCount(
          conversation.id,
          getLastReadAt(user.cognitoSub, conversation.id),
          user.username,
          user.cognitoSub,
          subToUsername,
        );
        return [conversation.id, count] as const;
      }),
    );
    setUnreadCounts(new Map(entries));
  }, [conversations, selectedId, subToUsername, user]);

  useEffect(() => {
    if (!user || conversations.length === 0) {
      setUnreadCounts(new Map());
      return;
    }
    void refreshUnreadCounts();
  }, [conversations, refreshUnreadCounts, user]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  if (bootError) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center text-sm text-[var(--color-muted)]">
        {bootError}
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
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--color-app-bg)]">
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
          conversations={conversations}
          selectedId={selectedId}
          loading={loading}
          unreadCounts={unreadCounts}
          onSelect={setSelectedId}
          onNewChat={() => setShowNewChat(true)}
          onOpenAdmin={() => setShowAdmin(true)}
          onOpenProfile={() => setShowProfile(true)}
          onSignOut={onSignOut}
        />
      </aside>

      <main
        className={`${
          selectedId ? 'flex' : 'hidden md:flex'
        } h-full min-w-0 flex-1 flex-col`}
      >
        {selected ? (
          <ChatView
            key={selected.id}
            conversation={selected}
            myUsername={user.username}
            mySub={user.cognitoSub}
            subToUsername={subToUsername}
            onBack={() => setSelectedId(null)}
            onConversationUpdated={() => void refreshUnreadCounts()}
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
          existing={conversations}
          onClose={() => setShowNewChat(false)}
          onCreated={(id) => {
            setSelectedId(id);
            setShowNewChat(false);
          }}
        />
      )}

      {showAdmin && user.isAdmin && (
        <AdminPanel onClose={() => setShowAdmin(false)} />
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
