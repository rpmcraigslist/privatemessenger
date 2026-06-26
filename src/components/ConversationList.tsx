import { useMemo, useState } from 'react';
import { type ConversationModel } from '../lib/amplify';
import { conversationTitle, formatListTime, formatUserHandle } from '../lib/util';
import Avatar from './Avatar';

type Props = {
  myUsername: string;
  mySub: string;
  subToUsername: Map<string, string>;
  isAdmin: boolean;
  conversations: ConversationModel[];
  latestByConversation: Map<string, { preview: string; at: string }>;
  selectedId: string | null;
  loading: boolean;
  directoryLoading: boolean;
  unreadCounts: Map<string, number>;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onOpenAdmin: () => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
};

export default function ConversationList({
  myUsername,
  mySub,
  subToUsername,
  isAdmin,
  conversations,
  latestByConversation,
  selectedId,
  loading,
  directoryLoading,
  unreadCounts,
  onSelect,
  onNewChat,
  onOpenAdmin,
  onOpenProfile,
  onSignOut,
}: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      conversationTitle(
        c.participants,
        c.name,
        mySub,
        myUsername,
        subToUsername,
        { directoryLoading },
      )
        .toLowerCase()
        .includes(q),
    );
  }, [conversations, directoryLoading, query, mySub, myUsername, subToUsername]);

  return (
    <>
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <h1 className="text-lg font-semibold">Chats</h1>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <button
              onClick={onOpenAdmin}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-muted)] transition hover:bg-white/10 hover:text-white"
              title="Admin"
              aria-label="Admin settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <button
            onClick={onOpenProfile}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-muted)] transition hover:bg-white/10 hover:text-white"
            title="Profile"
            aria-label="Profile settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 21a8 8 0 0 0-16 0"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button
            onClick={onNewChat}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-muted)] transition hover:bg-white/10 hover:text-white"
            title="New chat"
            aria-label="New chat"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            onClick={onSignOut}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-muted)] transition hover:bg-white/10 hover:text-white"
            title="Sign out"
            aria-label="Sign out"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-panel-2)] px-3 py-2">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            className="text-[var(--color-muted)]"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path
              d="m20 20-3-3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-muted)]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-6 text-sm text-[var(--color-muted)]">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--color-muted)]">
            <p>No conversations yet.</p>
            <button
              onClick={onNewChat}
              className="mt-3 rounded-full px-4 py-2 font-medium text-white"
              style={{ background: 'var(--color-accent)' }}
            >
              Start a chat
            </button>
          </div>
        ) : (
          filtered.map((c) => {
            const title = conversationTitle(
              c.participants,
              c.name,
              mySub,
              myUsername,
              subToUsername,
              { directoryLoading },
            );
            const active = c.id === selectedId;
            const unread = unreadCounts.get(c.id) ?? 0;
            const latest = latestByConversation.get(c.id);
            const previewText =
              latest?.preview ?? c.lastMessage ?? 'Tap to start chatting';
            const previewTime = latest?.at ?? c.lastMessageAt;
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/5 ${
                  active ? 'bg-white/10' : ''
                }`}
              >
                <div className="relative shrink-0">
                  <Avatar label={title} colorKey={c.id} />
                  {unread > 0 && (
                    <span
                      className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
                      style={{ background: 'var(--color-accent)' }}
                      aria-label={`${unread} unread messages`}
                    >
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 border-b border-white/5 pb-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`truncate ${unread > 0 ? 'font-semibold' : 'font-medium'}`}
                    >
                      {title}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--color-muted)]">
                      {formatListTime(previewTime)}
                    </span>
                  </div>
                  <p
                    className={`truncate text-sm ${unread > 0 ? 'font-medium text-white' : 'text-[var(--color-muted)]'}`}
                  >
                    {previewText}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>

      <footer className="truncate px-4 py-2 text-xs text-[var(--color-muted)]">
        Signed in as {formatUserHandle(myUsername)}
      </footer>
    </>
  );
}
