import { useEffect, useState } from 'react';
import { client } from '../lib/amplify';
import {
  normalizePhone,
  normalizeUsername,
  phoneError,
  usernameError,
} from '../lib/util';

type AdminUser = {
  loginId: string;
  username: string;
  phoneNumber?: string | null;
  status: string;
};

type Props = {
  onClose: () => void;
};

export default function AdminPanel({ onClose }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [forceChange, setForceChange] = useState(true);

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

  useEffect(() => {
    void loadUsers();
  }, []);

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
    } catch (err) {
      console.error('adminCreateUser failed', err);
      setError(err instanceof Error ? err.message : 'Create failed');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
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

          <section className="mb-6">
            <h3 className="mb-2 font-medium">Add user</h3>
            <form onSubmit={(e) => void createUser(e)} className="space-y-2">
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username"
                className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm"
              />
              <input
                type="password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Temporary password"
                className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm"
              />
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Cell phone (optional, +15551234567)"
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
            </form>
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
                    className="flex items-center justify-between rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{u.username}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {u.status}
                        {u.phoneNumber ? ` · ${u.phoneNumber}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => void removeUser(u.username)}
                      disabled={busy}
                      className="text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      Remove
                    </button>
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
