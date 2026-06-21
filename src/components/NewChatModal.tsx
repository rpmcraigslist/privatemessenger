import { useEffect, useMemo, useState } from 'react';

import { client, type ConversationModel, type UserProfileModel } from '../lib/amplify';
import { loadUserDirectory } from '../lib/directory';
import {
  displayName,
  graphqlErrorMessage,
  isValidUsername,
  normalizeUsername,
  profileDisplayLabel,
  repairParticipantSubs,
  usernameError,
} from '../lib/util';

import Avatar from './Avatar';

type Props = {
  open: boolean;
  mySub: string;
  myUsername: string;
  handleToSub: Map<string, string>;
  existing: ConversationModel[];
  onClose: () => void;
  onCreated: (conversationId: string, conversation: ConversationModel) => void;
};

export default function NewChatModal({
  open,
  mySub,
  myUsername,
  handleToSub,
  existing,
  onClose,
  onCreated,
}: Props) {
  const [directory, setDirectory] = useState<UserProfileModel[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected([]);
    setGroupName('');
    setError(null);

    (async () => {
      try {
        const profiles = await loadUserDirectory();
        setDirectory(profiles.filter((p) => p.username !== myUsername));
      } catch (err) {
        console.error('failed to load directory', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load users. Try signing out and back in.',
        );
      }
    })();
  }, [open, myUsername]);

  const typed = normalizeUsername(query);
  const filtered = useMemo(() => {
    const q = typed;
    const signedInHandles = new Set(
      directory.filter((p) => p.cognitoSub).map((p) => p.username),
    );
    return directory.filter(
      (p) =>
        !selected.includes(p.username) &&
        (!signedInHandles.has(p.username) || p.cognitoSub) &&
        (q === '' ||
          p.username.includes(q) ||
          (p.displayName ?? '').toLowerCase().includes(q)),
    );
  }, [directory, typed, selected]);

  const canAddTyped =
    isValidUsername(typed) &&
    typed !== myUsername &&
    !selected.includes(typed) &&
    !directory.some((p) => p.username === typed);

  function profileFor(username: string) {
    return directory.find((p) => p.username === normalizeUsername(username));
  }

  function subsForUsernames(handles: string[]): string[] | null {
    const subs: string[] = [];
    for (const handle of handles) {
      const profile = profileFor(handle);
      if (!profile?.cognitoSub) return null;
      subs.push(profile.cognitoSub);
    }
    return subs;
  }

  function addUser(name: string) {
    setSelected((s) => [...s, normalizeUsername(name)]);
    setQuery('');
    setError(null);
  }

  function removeUser(name: string) {
    setSelected((s) => s.filter((e) => e !== name));
  }

  async function start() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const selectedSubs = subsForUsernames(selected);
      if (!selectedSubs) {
        setError(
          'Each person must sign in at least once before you can start a chat with them.',
        );
        return;
      }
      const participants = [mySub, ...selectedSubs];

      if (selected.length === 1) {
        const match = existing.find((c) => {
          if (c.isGroup) return false;
          const normalized = repairParticipantSubs(
            c.participants.filter((p): p is string => !!p),
            myUsername,
            mySub,
            handleToSub,
          );
          return (
            normalized.length === 2 &&
            normalized.includes(mySub) &&
            normalized.includes(selectedSubs[0])
          );
        });
        if (match) {
          onCreated(match.id, match);
          return;
        }
      }

      const isGroup = selected.length > 1;
      const created = await client.models.Conversation.create({
        participants,
        isGroup,
        name: isGroup ? groupName.trim() || null : null,
        lastMessage: null,
        lastMessageAt: new Date().toISOString(),
      });

      if (created.errors?.length) {
        throw created;
      }
      if (created.data) {
        onCreated(created.data.id, created.data);
      } else {
        setError('Could not create the conversation (empty response).');
      }
    } catch (err) {
      console.error('failed to create conversation', err);
      setError(graphqlErrorMessage(err, 'Could not create the conversation.'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-[var(--color-panel)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3">
          <h2 className="text-lg font-semibold">New chat</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {selected.map((name) => (
              <span
                key={name}
                className="flex items-center gap-1 rounded-full bg-[var(--color-panel-2)] px-3 py-1 text-sm"
              >
                {displayName(name)}
                <button
                  onClick={() => removeUser(name)}
                  className="text-[var(--color-muted)] hover:text-white"
                  aria-label={`Remove ${name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="px-4 pb-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canAddTyped) addUser(typed);
            }}
            placeholder="Search or enter a username"
            className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--color-muted)]"
          />
          {query && !canAddTyped && usernameError(query) && (
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {usernameError(query)}
            </p>
          )}
        </div>

        {selected.length > 1 && (
          <div className="px-4 pb-2">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Name this group (optional)"
              className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--color-muted)]"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {canAddTyped && (
            <button
              onClick={() => addUser(typed)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-white/5"
            >
              <Avatar label={typed} size={40} />
              <div>
                <p className="text-sm font-medium">Chat with {typed}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  They must sign in at least once
                </p>
              </div>
            </button>
          )}
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => addUser(p.username)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-white/5"
            >
              <Avatar
                label={profileDisplayLabel(p.username, p.displayName)}
                colorKey={p.username}
                size={40}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {profileDisplayLabel(p.username, p.displayName)}
                </p>
                <p className="truncate text-xs text-[var(--color-muted)]">
                  @{p.username}
                  {!p.cognitoSub ? ' · not signed in yet' : ''}
                </p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && !canAddTyped && (
            <p className="px-3 py-6 text-center text-sm text-[var(--color-muted)]">
              {directory.length === 0
                ? 'No other users yet. Enter a username to start a chat.'
                : 'No matches.'}
            </p>
          )}
        </div>

        {error && <p className="px-4 pb-2 text-xs text-red-400">{error}</p>}

        <footer className="px-4 py-3">
          <button
            onClick={() => void start()}
            disabled={selected.length === 0 || busy}
            className="w-full rounded-full py-3 font-medium text-white transition disabled:opacity-40"
            style={{ background: 'var(--color-accent)' }}
          >
            {busy
              ? 'Starting…'
              : selected.length > 1
                ? `Start group (${selected.length})`
                : 'Start chat'}
          </button>
        </footer>
      </div>
    </div>
  );
}
