import { useEffect, useRef, useState } from 'react';

import { client, type ConversationModel } from '../lib/amplify';
import {
  conversationTitle,
  formatUserHandle,
  participantDisplayName,
} from '../lib/util';

type Props = {
  conversation: ConversationModel;
  myUsername: string;
  mySub: string;
  subToUsername: Map<string, string>;
  directoryLoading?: boolean;
  onClose: () => void;
  onRenamed: (name: string | null) => void;
};

export default function ChatGroupPanel({
  conversation,
  myUsername,
  mySub,
  subToUsername,
  directoryLoading = false,
  onClose,
  onRenamed,
}: Props) {
  const [groupName, setGroupName] = useState(conversation.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissOnBackdropClick = useRef(false);

  useEffect(() => {
    setGroupName(conversation.name ?? '');
  }, [conversation.id, conversation.name]);

  const members = conversation.participants.filter(Boolean) as string[];
  const isGroup = conversation.isGroup || members.length > 2;

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = groupName.trim();
      const { errors } = await client.models.Conversation.update({
        id: conversation.id,
        name: trimmed || null,
      });
      if (errors?.length) throw new Error(errors[0].message);
      onRenamed(trimmed || null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save group name');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onPointerDown={(e) => {
        dismissOnBackdropClick.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (dismissOnBackdropClick.current && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-sm flex-col rounded-t-2xl bg-[var(--color-panel)] sm:rounded-2xl"
        onPointerDown={(e) => {
          dismissOnBackdropClick.current = false;
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-semibold">Chat details</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className="mb-1 text-sm text-[var(--color-muted)]">Chat name</p>
          <p className="mb-4 font-medium">
            {conversationTitle(
              conversation.participants,
              conversation.name,
              mySub,
              myUsername,
              subToUsername,
              { directoryLoading },
            )}
          </p>

          {isGroup && (
            <form onSubmit={(e) => void saveName(e)} className="mb-6 space-y-2">
              <label className="block text-sm text-[var(--color-muted)]">
                Group name
              </label>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Project team"
                className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-accent)' }}
              >
                Save name
              </button>
            </form>
          )}

          <h3 className="mb-2 text-sm font-medium text-[var(--color-muted)]">
            People ({members.length})
          </h3>
          <ul className="space-y-2">
            {members.map((participant) => {
              const label = participantDisplayName(participant, subToUsername, {
                directoryLoading,
              });
              const handle =
                subToUsername.get(participant) ??
                (participant === mySub ? myUsername : null);
              const isMe =
                participant === mySub ||
                handle === myUsername ||
                participant === myUsername;
              return (
                <li
                  key={participant}
                  className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm"
                >
                  <p className="font-medium">
                    {label}
                    {isMe ? ' (you)' : ''}
                  </p>
                  {handle && (
                    <p className="text-xs text-[var(--color-muted)]">
                      @{formatUserHandle(handle)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  );
}
