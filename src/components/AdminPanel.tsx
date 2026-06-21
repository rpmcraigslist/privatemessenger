import { useCallback, useEffect, useState } from 'react';
import { client } from '../lib/amplify';
import {
  formatUserHandle,
  normalizePhone,
  normalizeUsername,
  phoneError,
  usernameError,
} from '../lib/util';
import { NoSaveField, NoSaveForm } from './NoSaveCredentials';

type AdminUser = {
  loginId: string;
  username: string;
  phoneNumber?: string | null;
  status: string;
};

type AuditResult = {
  cognitoUsers: {
    username: string;
    cognitoSub?: string | null;
    status: string;
  }[];
  profileRows: {
    id: string;
    username: string;
    cognitoSub?: string | null;
    orphan: boolean;
  }[];
  duplicateProfileHandles: string[];
  duplicateDirectChats: {
    peerKey: string;
    conversationIds: string[];
  }[];
};

type Props = {
  onClose: () => void;
  onDataRepaired?: () => void;
};

export default function AdminPanel({ onClose, onDataRepaired }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [forceChange, setForceChange] = useState(true);
  const [purgeUserA, setPurgeUserA] = useState('paul');
  const [purgeUserB, setPurgeUserB] = useState('lena');

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const { data, errors } = await client.queries.adminListUsers();
      if (errors?.length) throw new Error(errors[0].message);
      setUsers((data ?? []) as AdminUser[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setError(null);
    try {
      const { data, errors } = await client.queries.adminAuditMessenger();
      if (errors?.length) throw new Error(errors[0].message);
      setAudit((data ?? null) as AuditResult | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to audit messenger data');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadAudit();
  }, [loadAudit]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const handle = normalizeUsername(newUsername);
    const userErr = usernameError(handle);
    if (userErr) {
      setError(userErr);
      return;
    }
    if (!tempPassword) {
      setError('Enter a temporary password.');
      return;
    }
    const phoneErr = phoneError(newPhone);
    if (phoneErr) {
      setError(phoneErr);
      return;
    }
    const phone = normalizePhone(newPhone);

    setBusy(true);
    try {
      const { data, errors } = await client.mutations.adminCreateUser({
        username: handle,
        temporaryPassword: tempPassword,
        phoneNumber: phone ?? undefined,
        forcePasswordChange: forceChange,
      });
      if (errors?.length) throw new Error(errors[0].message);
      if (!data?.username) {
        throw new Error('Create failed — no response from server.');
      }
      setMessage(
        `Created ${data.username}. They must sign in and ${forceChange ? 'set a new password' : 'use the assigned password'}.`,
      );
      setNewUsername('');
      setTempPassword('');
      setNewPhone('');
      await loadUsers();
      await loadAudit();
    } catch (err) {
      console.error('adminCreateUser failed', err);
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function forcePasswordChange(username: string) {
    const temp = prompt(
      `Temporary password for "${username}"\n\nThey must change it on next sign-in.`,
    );
    if (!temp?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data, errors } = await client.mutations.adminForcePasswordChange({
        username,
        temporaryPassword: temp,
      });
      if (errors?.length) throw new Error(errors[0].message);
      setMessage(data?.message ?? `Password reset for ${username}.`);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(username: string) {
    if (!confirm(`Remove user "${username}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const { errors } = await client.mutations.adminDeleteUser({ username });
      if (errors?.length) throw new Error(errors[0].message);
      setMessage(`Removed ${username}`);
      await loadUsers();
      await loadAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function purgeUsers() {
    if (
      !confirm(
        'Delete ALL users except yourself? This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, errors } = await client.mutations.adminPurgeUsers();
      if (errors?.length) throw new Error(errors[0].message);
      setMessage(`Removed ${data?.deleted ?? 0} user(s).`);
      await loadUsers();
      await loadAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purge failed');
    } finally {
      setBusy(false);
    }
  }

  async function clearMessages() {
    if (!confirm('Delete every message in the system?')) return;
    setBusy(true);
    setError(null);
    try {
      const { data, errors } = await client.mutations.adminClearMessages();
      if (errors?.length) throw new Error(errors[0].message);
      setMessage(
        `Cleared ${data?.deletedMessages ?? 0} message(s) and removed ${data?.deletedConversations ?? 0} conversation(s).`,
      );
      await loadAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  }

  async function purgeDirectChat() {
    const usernameA = normalizeUsername(purgeUserA);
    const usernameB = normalizeUsername(purgeUserB);
    const errA = usernameError(usernameA);
    const errB = usernameError(usernameB);
    if (errA || errB) {
      setError(errA ?? errB);
      return;
    }
    if (
      !confirm(
        `Delete every direct message and conversation between ${usernameA} and ${usernameB}?`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, errors } = await client.mutations.adminPurgeDirectChat({
        usernameA,
        usernameB,
      });
      if (errors?.length) throw new Error(errors[0].message);
      setMessage(
        `Removed ${data?.deletedMessages ?? 0} message(s) and ${data?.deletedConversations ?? 0} direct chat(s) between ${usernameA} and ${usernameB}. Refreshing…`,
      );
      onDataRepaired?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Direct chat purge failed');
    } finally {
      setBusy(false);
    }
  }

  async function reconcileMessenger() {
    if (
      !confirm(
        'Consolidate duplicate profiles, remove duplicate 1:1 chats, and normalize participant ids?',
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { data, errors } = await client.mutations.adminReconcileMessenger();
      if (errors?.length) throw new Error(errors[0].message);
      setMessage(
        [
          `Profiles consolidated: ${data?.profilesConsolidated ?? 0}.`,
          `Orphan profiles removed: ${data?.orphanProfilesRemoved ?? 0}.`,
          `Duplicate chats removed: ${data?.duplicateConversationsRemoved ?? 0}.`,
          `Messages removed with duplicate chats: ${data?.messagesRemoved ?? 0}.`,
          `Conversations normalized: ${data?.conversationsNormalized ?? 0}.`,
          'Refreshing…',
        ].join(' '),
      );
      onDataRepaired?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconcile failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-[var(--color-panel)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-lg font-semibold">Admin</h2>
          <button
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-white"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {message && (
            <p className="mb-3 rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-accent)]">
              {message}
            </p>
          )}
          {error && (
            <p className="mb-3 text-sm text-red-400">{error}</p>
          )}

          <section className="mb-6 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-panel-2)] px-3 py-3">
            <h3 className="mb-1 font-medium text-[var(--color-accent)]">
              Fix duplicate chats
            </h3>
            <p className="mb-3 text-sm text-[var(--color-muted)]">
              If you see two conversations with the same person, run reconcile to
              merge duplicate threads in the database, then refresh everyone&apos;s
              app. Use purge direct chat to wipe messages between two users only.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void reconcileMessenger()}
                disabled={busy}
                className="w-full rounded-lg px-3 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                style={{ background: 'var(--color-accent)' }}
              >
                Reconcile profiles and chats
              </button>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={purgeUserA}
                  onChange={(e) => setPurgeUserA(e.target.value)}
                  placeholder="Username A"
                  autoComplete="off"
                  className="rounded-lg bg-[var(--color-app-bg)] px-3 py-2 text-sm outline-none"
                />
                <input
                  value={purgeUserB}
                  onChange={(e) => setPurgeUserB(e.target.value)}
                  placeholder="Username B"
                  autoComplete="off"
                  className="rounded-lg bg-[var(--color-app-bg)] px-3 py-2 text-sm outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => void purgeDirectChat()}
                disabled={busy}
                className="w-full rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-amber-300 hover:bg-amber-400/10 disabled:opacity-40"
              >
                Purge direct chat between two users
              </button>
            </div>
          </section>

          <section className="mb-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-medium">Data audit</h3>
              <button
                type="button"
                onClick={() => void loadAudit()}
                disabled={busy || auditLoading}
                className="text-sm text-[var(--color-accent)] hover:underline disabled:opacity-40"
              >
                Refresh
              </button>
            </div>
            {auditLoading && !audit ? (
              <p className="text-sm text-[var(--color-muted)]">Checking data…</p>
            ) : audit ? (
              <div className="space-y-2 rounded-lg bg-[var(--color-panel-2)] px-3 py-3 text-sm">
                <p>
                  Cognito accounts: <strong>{audit.cognitoUsers.length}</strong>
                </p>
                <p>
                  Profile rows in database: <strong>{audit.profileRows.length}</strong>
                </p>
                {audit.duplicateProfileHandles.length > 0 ? (
                  <p className="text-amber-300">
                    Duplicate profile handles:{' '}
                    {audit.duplicateProfileHandles.join(', ')}
                  </p>
                ) : (
                  <p className="text-[var(--color-muted)]">
                    No duplicate profile handles found.
                  </p>
                )}
                {audit.duplicateDirectChats.length > 0 ? (
                  <p className="text-amber-300">
                    Duplicate 1:1 chats: {audit.duplicateDirectChats.length} pair(s)
                  </p>
                ) : (
                  <p className="text-[var(--color-muted)]">
                    No duplicate 1:1 chats found.
                  </p>
                )}
                {audit.profileRows.some((row) => row.orphan) && (
                  <p className="text-amber-300">
                    Orphan profile rows detected. Run reconcile to remove them.
                  </p>
                )}
              </div>
            ) : null}
          </section>

          <section className="mb-6">
            <h3 className="mb-2 font-medium">Add user</h3>
            <NoSaveForm onSubmit={(e) => void createUser(e)} className="space-y-2">
              <NoSaveField
                value={newUsername}
                onChange={setNewUsername}
                placeholder="Username"
                className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none"
              />
              <NoSaveField
                type="password"
                value={tempPassword}
                onChange={setTempPassword}
                placeholder="Temporary password"
                className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none"
              />
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Cell phone (optional, +15551234567)"
                autoComplete="off"
                className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                <input
                  type="checkbox"
                  checked={forceChange}
                  onChange={(e) => setForceChange(e.target.checked)}
                />
                Require password change on first sign-in
              </label>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-accent)' }}
              >
                Add user
              </button>
            </NoSaveForm>
          </section>

          <section className="mb-6">
            <h3 className="mb-2 font-medium">Users</h3>
            {loading ? (
              <p className="text-sm text-[var(--color-muted)]">Loading…</p>
            ) : (
              <ul className="space-y-2">
                {users.map((u) => (
                  <li
                    key={u.loginId}
                    className="rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{formatUserHandle(u.username)}</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {u.status === 'FORCE_CHANGE_PASSWORD'
                            ? 'Must change password on login'
                            : u.status}
                          {u.phoneNumber ? ` · ${u.phoneNumber}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => void forcePasswordChange(u.username)}
                          disabled={busy}
                          className="text-[var(--color-accent)] hover:underline disabled:opacity-40"
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeUser(u.username)}
                          disabled={busy}
                          className="text-red-400 hover:text-red-300 disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-medium text-red-400">Danger zone</h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => void clearMessages()}
                disabled={busy}
                className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 disabled:opacity-40"
              >
                Clear all messages
              </button>
              <button
                onClick={() => void purgeUsers()}
                disabled={busy}
                className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 disabled:opacity-40"
              >
                Remove all users (except you)
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
