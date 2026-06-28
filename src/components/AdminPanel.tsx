import { useCallback, useEffect, useState } from 'react';
import { client } from '../lib/amplify';
import {
  contactEmailError,
  formatUserHandle,
  normalizeContactEmail,
  normalizeUsername,
  usernameError,
} from '../lib/util';
import BusyOverlay from './BusyOverlay';
import { NoSaveField, NoSaveForm } from './NoSaveCredentials';

type AdminUser = {
  loginId: string;
  username: string;
  contactEmail?: string | null;
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
  const [busyLabel, setBusyLabel] = useState('Working…');

  const [newUsername, setNewUsername] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [forceChange, setForceChange] = useState(true);
  const [purgeUserA, setPurgeUserA] = useState('paul');
  const [purgeUserB, setPurgeUserB] = useState('lena');
  const [emailTargetUsername, setEmailTargetUsername] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

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

  useEffect(() => {
    if (emailTargetUsername) return;
    const first = users.find((user) => user.contactEmail);
    if (first) setEmailTargetUsername(first.username);
  }, [users, emailTargetUsername]);

  const emailableUsers = users.filter((user) => user.contactEmail);

  async function runBusy<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    setBusyLabel(label);
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  }

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
    const emailErr = contactEmailError(newEmail);
    if (emailErr) {
      setError(emailErr);
      return;
    }
    const email = normalizeContactEmail(newEmail);

    await runBusy('Creating user…', async () => {
      try {
        const { data, errors } = await client.mutations.adminCreateUser({
          username: handle,
          temporaryPassword: tempPassword,
          contactEmail: email ?? undefined,
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
        setNewEmail('');
        await loadUsers();
        await loadAudit();
      } catch (err) {
        console.error('adminCreateUser failed', err);
        setError(err instanceof Error ? err.message : 'Create failed');
      }
    });
  }

  async function sendAdminEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!emailTargetUsername) {
      setError('Choose a user with a contact email.');
      return;
    }
    if (!emailSubject.trim()) {
      setError('Enter a subject.');
      return;
    }
    if (!emailBody.trim()) {
      setError('Enter a message.');
      return;
    }

    await runBusy('Sending email…', async () => {
      try {
        const { data, errors } = await client.mutations.adminSendUserEmail({
          username: emailTargetUsername,
          subject: emailSubject.trim(),
          bodyText: emailBody.trim(),
        });
        if (errors?.length) throw new Error(errors[0].message);
        if (!data) throw new Error('Send failed — no response from server.');

        if (data.sent) {
          setMessage(data.message);
          setEmailSubject('');
          setEmailBody('');
        } else {
          setError(data.message);
        }
      } catch (err) {
        console.error('adminSendUserEmail failed', err);
        setError(err instanceof Error ? err.message : 'Send failed');
      }
    });
  }

  async function forcePasswordChange(username: string) {
    const temp = prompt(
      `Temporary password for "${username}"\n\nThey must change it on next sign-in.`,
    );
    if (!temp?.trim()) return;
    setBusyLabel('Resetting password…');
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
    if (
      !confirm(
        `Remove user "${username}" and delete their conversations and messages?`,
      )
    ) {
      return;
    }
    setBusyLabel(`Removing ${username}…`);
    setBusy(true);
    setError(null);
    try {
      const { data, errors } = await client.mutations.adminDeleteUser({ username });
      if (errors?.length) throw new Error(errors[0].message);
      const deletedMessages = data?.deletedMessages ?? 0;
      const deletedConversations = data?.deletedConversations ?? 0;
      setMessage(
        `Removed ${username}. Deleted ${deletedMessages} message(s), ${deletedConversations} conversation(s), and all related profile data.`,
      );
      await loadUsers();
      await loadAudit();
      onDataRepaired?.();
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
    setBusyLabel('Removing users…');
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
    setBusyLabel('Clearing all messages…');
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

    setBusyLabel('Purging direct chat…');
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

  return (
    <>
      {busy && <BusyOverlay label={busyLabel} />}
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
              Direct chat cleanup
            </h3>
            <p className="mb-3 text-sm text-[var(--color-muted)]">
              Wipe every message and conversation between two users. User removal
              in the list below already deletes their data cleanly.
            </p>
            <div className="flex flex-col gap-2">
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
                    Orphan profile rows detected. Remove the affected user to
                    clean them up.
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
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email address (optional)"
                autoComplete="email"
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
            <h3 className="mb-2 font-medium">Send email</h3>
            <p className="mb-3 text-xs text-[var(--color-muted)]">
              Sends through Amazon SES to the user&apos;s Profile contact email.
              Requires MESSENGER_FROM_EMAIL in Amplify (Ohio).
            </p>
            {emailableUsers.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">
                No users have a contact email yet. Add one when creating a user
                or in Profile settings.
              </p>
            ) : (
              <form onSubmit={(e) => void sendAdminEmail(e)} className="space-y-2">
                <select
                  value={emailTargetUsername}
                  onChange={(e) => setEmailTargetUsername(e.target.value)}
                  className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none"
                >
                  {emailableUsers.map((user) => (
                    <option key={user.loginId} value={user.username}>
                      {formatUserHandle(user.username)} · {user.contactEmail}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject"
                  className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none"
                />
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  placeholder="Message"
                  rows={5}
                  className="w-full resize-y rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-full py-2 text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--color-accent)' }}
                >
                  Send email
                </button>
              </form>
            )}
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
                          {u.contactEmail ? ` · ${u.contactEmail}` : ''}
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
    </>
  );
}
