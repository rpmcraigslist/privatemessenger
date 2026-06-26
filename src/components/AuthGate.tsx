import { useEffect, useState } from 'react';

import { client } from '../lib/amplify';

import {

  completeNewPassword,

  ensureValidSession,

  rememberSignInHandle,

  resolveCurrentUserOrThrow,

  signInWithUsername,

  signOutAndClear,

} from '../lib/session';

import {

  mapAuthError,

  normalizeUsername,

  contactEmailError,

  usernameError,

} from '../lib/util';

import { NoSaveField, NoSaveForm } from './NoSaveCredentials';

import { APP_VERSION } from '../lib/app-version';



type Props = {

  children: (signOut: () => void) => React.ReactNode;

};



type Mode = 'checking' | 'bootstrap' | 'signIn' | 'requestAccount' | 'newPassword' | 'authed';



export default function AuthGate({ children }: Props) {

  const [mode, setMode] = useState<Mode>('checking');

  const [username, setUsername] = useState('');

  const [password, setPassword] = useState('');

  const [newPassword, setNewPassword] = useState('');

  const [contactEmail, setContactEmail] = useState('');

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [bootstrapMessage, setBootstrapMessage] = useState<string | null>(null);

  const [requestAccountEmail, setRequestAccountEmail] = useState('');

  const [requestAccountUsername, setRequestAccountUsername] = useState('');

  const [requestAccountMessage, setRequestAccountMessage] = useState<string | null>(null);



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
            'Could not check setup status. Confirm the Amplify main build succeeded, then hard-refresh or clear site data.',
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
          'Could not reach the backend. Confirm the Amplify deploy finished in us-east-2, then hard-refresh or clear site data.',
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

          contactEmail: contactEmail.trim() || undefined,

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

      await resolveCurrentUserOrThrow();

      setMode('authed');

    } catch (err) {

      setError(mapAuthError(err));

    } finally {

      setBusy(false);

    }

  }



  async function handleRequestAccount(e: React.FormEvent) {

    e.preventDefault();

    setError(null);

    setRequestAccountMessage(null);

    const usernameValidation = usernameError(requestAccountUsername);

    if (usernameValidation) {

      setError(usernameValidation);

      return;

    }

    const emailErr = contactEmailError(requestAccountEmail);

    if (emailErr) {

      setError(emailErr);

      return;

    }



    setBusy(true);

    try {

      const { data, errors } = await client.mutations.requestAccountAccess(

        {

          username: normalizeUsername(requestAccountUsername),

          contactEmail: requestAccountEmail.trim(),

          appUrl: window.location.origin,

        },

        { authMode: 'apiKey' },

      );

      if (errors?.length || !data) {

        throw new Error(errors?.[0]?.message ?? 'Could not submit your request');

      }

      if (!data.notified) {

        console.warn('account request did not notify admin', data);

      }

      setRequestAccountMessage(data.message);

      setRequestAccountEmail('');

      setRequestAccountUsername('');

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

      await resolveCurrentUserOrThrow();

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

        <NoSaveForm

          onSubmit={(e) => void handleBootstrap(e)}

          className="space-y-4"

        >

          <NoSaveField label="Admin username" value={username} onChange={setUsername} />

          <NoSaveField

            label="Password"

            type="password"

            value={password}

            onChange={setPassword}

          />

          <NoSaveField

            label="Email address (optional)"

            value={contactEmail}

            onChange={setContactEmail}

          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Submit busy={busy} label="Create admin account" />

        </NoSaveForm>

      </AuthShell>

    );

  }



  if (mode === 'newPassword') {

    return (

      <AuthShell

        title="Set a new password"

        subtitle="Your admin assigned a temporary password. Choose a new one."

      >

        <NoSaveForm

          onSubmit={(e) => void handleNewPassword(e)}

          className="space-y-4"

        >

          <NoSaveField

            label="New password"

            type="password"

            value={newPassword}

            onChange={setNewPassword}

          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Submit busy={busy} label="Save password & continue" />

        </NoSaveForm>

      </AuthShell>

    );

  }



  if (mode === 'requestAccount') {

    return (

      <AuthShell

        title="Request account or password reset"

        subtitle="New here or forgot your password? Enter your username and email. An administrator will review your request and reply with login details or a reset."

      >

        <NoSaveForm

          onSubmit={(e) => void handleRequestAccount(e)}

          className="space-y-4"

        >

          <NoSaveField

            label="Desired username"

            value={requestAccountUsername}

            onChange={setRequestAccountUsername}

            placeholder="yourname"

          />

          <NoSaveField

            label="Your email address"

            type="email"

            value={requestAccountEmail}

            onChange={setRequestAccountEmail}

            placeholder="you@example.com"

            keepInViewOnFocus

          />

          {requestAccountMessage && (

            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                requestAccountMessage.includes('failed to send')
                  ? 'bg-red-500/10 text-red-300'
                  : 'bg-[var(--color-panel-2)] text-[var(--color-accent)]'
              }`}
            >

              {requestAccountMessage}

            </p>

          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Submit busy={busy} label="Submit request" />

        </NoSaveForm>

        <p className="mt-4 text-center text-sm">

          <button

            type="button"

            className="text-[var(--color-accent)] hover:underline"

            onClick={() => {

              setMode('signIn');

              setError(null);

              setRequestAccountMessage(null);

              setRequestAccountUsername('');

            }}

          >

            Back to sign in

          </button>

        </p>

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

      <NoSaveForm onSubmit={(e) => void handleSignIn(e)} className="space-y-4">

        <NoSaveField label="Username" value={username} onChange={setUsername} />

        <NoSaveField

          label="Password"

          type="password"

          value={password}

          onChange={setPassword}

          showPasswordToggle

        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Submit busy={busy} label="Sign in" />

      </NoSaveForm>

      <p className="mt-4 text-center text-sm text-[var(--color-muted)]">

        <button

          type="button"

          className="text-[var(--color-accent)] hover:underline"

          onClick={() => {

            setMode('requestAccount');

            setError(null);

            setRequestAccountMessage(null);

            setRequestAccountUsername('');

          }}

        >

          Create New or Forgot Password Account

        </button>

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

        <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
          Version {APP_VERSION}
        </p>

      </div>

    </div>

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


