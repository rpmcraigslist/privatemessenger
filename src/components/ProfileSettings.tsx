import { useRef, useState } from 'react';

import {
  getAlertPrefs,
  getNotificationPermission,
  isNotificationSupported,
  requestNotificationPermission,
  setAlertPrefs,
  unlockNotificationSound,
} from '../lib/app-notifications';

import {
  contactEmailError,
  formatUserHandle,
  normalizeContactEmail,
} from '../lib/util';

import {
  syncMyProfile,
  type ProfileUpdate,
  type SessionUser,
} from '../lib/session';

type Props = {
  user: SessionUser;
  onClose: () => void;
  onSaved: (update: ProfileUpdate) => void;
};

export default function ProfileSettings({ user, onClose, onSaved }: Props) {
  const [contactEmail, setContactEmail] = useState(user.contactEmail ?? '');
  const [alertPrefs, setAlertPrefsState] = useState(getAlertPrefs);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissOnBackdropClick = useRef(false);

  function handleBackdropPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dismissOnBackdropClick.current = e.target === e.currentTarget;
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!dismissOnBackdropClick.current || e.target !== e.currentTarget) return;
    onClose();
  }

  function handlePanelPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dismissOnBackdropClick.current = false;
    e.stopPropagation();
  }

  async function toggleBrowserNotifications(enabled: boolean) {
    setNotifyError(null);
    if (!enabled) {
      setAlertPrefsState(setAlertPrefs({ browserNotifications: false }));
      return;
    }
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      setNotifyError('Browser notifications were blocked. Enable them in your device settings.');
      setAlertPrefsState(setAlertPrefs({ browserNotifications: false }));
      return;
    }
    setAlertPrefsState(setAlertPrefs({ browserNotifications: true }));
  }

  function toggleMessageSound(enabled: boolean) {
    if (enabled) unlockNotificationSound();
    setAlertPrefsState(setAlertPrefs({ soundEnabled: enabled }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const emailErr = contactEmailError(contactEmail);
      if (emailErr) {
        setError(emailErr);
        return;
      }

      const normalized = normalizeContactEmail(contactEmail);
      const saved = await syncMyProfile({
        contactEmail: normalized,
      });

      setContactEmail(saved.contactEmail ?? '');
      onSaved({
        contactEmail: saved.contactEmail,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl bg-[var(--color-panel)] p-6 sm:rounded-2xl"
        onPointerDown={handlePanelPointerDown}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Your profile</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Signed in as <strong>{formatUserHandle(user.username)}</strong>
              {user.isAdmin ? ' (admin)' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-muted)] hover:bg-white/10 hover:text-white"
            aria-label="Close profile settings"
          >
            ✕
          </button>
        </header>

        <form onSubmit={(e) => void save(e)} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--color-muted)]">
              Email address (optional)
            </span>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 outline-none"
            />
          </label>

          {isNotificationSupported() && (
            <section className="space-y-3 border-t border-white/10 pt-4">
              <div>
                <h3 className="text-sm font-medium">Message alerts</h3>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                  Optional pop-up alerts and sound while you use the app.
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-lg bg-[var(--color-panel-2)] px-3 py-3">
                <input
                  type="checkbox"
                  checked={alertPrefs.browserNotifications}
                  onChange={(e) => void toggleBrowserNotifications(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Browser notifications</span>
                  <span className="mt-0.5 block text-[var(--color-muted)]">
                    Notify when a new message arrives while you are away.
                    {getNotificationPermission() === 'denied'
                      ? ' Currently blocked in browser settings.'
                      : ''}
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-lg bg-[var(--color-panel-2)] px-3 py-3">
                <input
                  type="checkbox"
                  checked={alertPrefs.soundEnabled}
                  onChange={(e) => toggleMessageSound(e.target.checked)}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Message sound</span>
                  <span className="mt-0.5 block text-[var(--color-muted)]">
                    Play a short chime for new messages in another chat or while
                    this tab is in the background.
                  </span>
                </span>
              </label>
            </section>
          )}

          {notifyError && <p className="text-sm text-red-400">{notifyError}</p>}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-full border border-white/15 py-3 font-medium text-[var(--color-muted)] hover:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-full py-3 font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--color-accent)' }}
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
