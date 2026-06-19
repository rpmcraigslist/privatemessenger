import { useEffect, useState } from 'react';
import { client } from '../lib/amplify';
import {
  completeNewPassword,
  ensureValidSession,
  rememberSignInHandle,
  signInWithUsername,
  signOutAndClear,
} from '../lib/session';
import {
  mapAuthError,
  normalizeUsername,
  usernameError,
} from '../lib/util';

type Props = {
  children: (signOut: () => void) => React.ReactNode;
};

type Mode = 'checking' | 'bootstrap' | 'signIn' | 'newPassword' | 'authed';

export default function AuthGate({ children }: Props) {
  const [mode, setMode] = useState<Mode>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: needsBootstrap, errors } =
          await client.queries.bootstrapRequired({
            authMode: 'apiKey',
          });
        if (errors?.length) {
          console.error('bootstrapRequired failed', errors);
          setError(
            'Could not check setup status. Redeploy the sandbox and refresh.',
          );
          setMode('signIn');
          return;
        }
        if (needsBootstrap) {
          setMode('bootstrap');
          return;
        }
        const ok = await ensureValidSession();
        setMode(ok ? 'authed' : 'signIn');
      } catch (err) {
        console.error('auth gate init failed', err);
        setError(
          'Could not reach the backend. Confirm sandbox deploy finished, then refresh.',
        );
        setMode('signIn');
      }
    })();
  }, []);

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validation = usernameError(username);
    if (validation) {
      setError(validation);
      return;
    }
    if (!password) {
      setError('Enter a password for the admin account.');
      return;
    }

    setBusy(true);
    try {
      const { data, errors } = await client.mutations.bootstrapAdmin(
        {
          username: normalizeUsername(username),
          password,
          phoneNumber: phoneNumber.trim() || undefined,
        },
        { authMode: 'apiKey' },
      );
      if (errors?.length || !data) {
        throw new Error(errors?.[0]?.message ?? 'Bootstrap failed');
      }
      setBootstrapMessage(data.message);
      rememberSignInHandle(normalizeUsername(username));
      setPassword('');
      setMode('signIn');
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validation = usernameError(username);
    if (validation) {
      setError(validation);
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setBusy(true);
    try {
      rememberSignInHandle(normalizeUsername(username));
      const result = await signInWithUsername(username, password);
      if (
        result.nextStep.signInStep ===
        'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'
      ) {
        setMode('newPassword');
        return;
      }
      const ok = await ensureValidSession();
      if (!ok) throw new Error('Could not start a session.');
      setMode('authed');
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newPassword) {
      setError('Enter a new password.');
      return;
    }
    setBusy(true);
    try {
      await completeNewPassword(newPassword);
      const ok = await ensureValidSession();
      if (!ok) throw new Error('Could not start a session.');
      setMode('authed');
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'checking') {
    return (
      <div className="grid min-h-dvh place-items-center text-[var(--color-muted)]">
        Loading…
      </div>
    );
  }

  if (mode === 'authed') {
    return (
      <>
        {children(async () => {
          await signOutAndClear();
          setMode('signIn');
          setPassword('');
          setNewPassword('');
        })}
      </>
    );
  }

  if (mode === 'bootstrap') {
    return (
      <AuthShell
        title="First-time setup"
        subtitle="No users exist yet. Create the admin account."
      >
        <form onSubmit={(e) => void handleBootstrap(e)} className="space-y-4">
          <Field label="Admin username" value={username} onChange={setUsername} />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <Field
            label="Cell phone (optional, E.164 e.g. +15551234567)"
            value={phoneNumber}
            onChange={setPhoneNumber}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Submit busy={busy} label="Create admin account" />
        </form>
      </AuthShell>
    );
  }

  if (mode === 'newPassword') {
    return (
      <AuthShell
        title="Set a new password"
        subtitle="Your admin assigned a temporary password. Choose a new one."
      >
        <form onSubmit={(e) => void handleNewPassword(e)} className="space-y-4">
          <Field
            label="New password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Submit busy={busy} label="Save password & continue" />
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Private Messenger" subtitle="Sign in with your username">
      {bootstrapMessage && (
        <p className="mb-4 rounded-lg bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-accent)]">
          {bootstrapMessage}
        </p>
      )}
      <form onSubmit={(e) => void handleSignIn(e)} className="space-y-4">
        <Field label="Username" value={username} onChange={setUsername} />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Submit busy={busy} label="Sign in" />
      </form>
      <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
        Need an account? Ask your administrator to create one for you.
      </p>
    </AuthShell>
  );
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--color-app-bg)] px-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--color-panel)] p-6 shadow-lg">
        <h1 className="mb-1 text-xl font-semibold">{title}</h1>
        <p className="mb-6 text-sm text-[var(--color-muted)]">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-[var(--color-muted)]">{label}</span>
      <input
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 outline-none"
      />
    </label>
  );
}

function Submit({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-full py-3 font-medium text-white disabled:opacity-50"
      style={{ background: 'var(--color-accent)' }}
    >
      {busy ? 'Please wait…' : label}
    </button>
  );
}
