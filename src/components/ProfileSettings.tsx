import { useEffect, useRef, useState } from 'react';

import {
  getAlertPrefs,
  getNotificationPermission,
  isNotificationSupported,
  requestNotificationPermission,
  setAlertPrefs,
  unlockNotificationSound,
} from '../lib/app-notifications';

import {
  DEFAULT_MESSAGE_BUBBLE_COLOR,
  MESSAGE_BUBBLE_COLORS,
  bubbleStyleForColor,
  normalizeMessageBubbleColor,
} from '../lib/message-bubble-colors';

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

import {
  scrollElementIntoComfortableView,
  useVisualViewportBottomInset,
} from '../lib/visual-viewport';

import { NoSaveField } from './NoSaveCredentials';

type Props = {
  user: SessionUser;
  onClose: () => void;
  onSaved: (update: ProfileUpdate) => void;
};

export default function ProfileSettings({ user, onClose, onSaved }: Props) {
  const [contactEmail, setContactEmail] = useState(user.contactEmail ?? '');
  const [messageBubbleColor, setMessageBubbleColor] = useState(
    () =>
      normalizeMessageBubbleColor(user.messageBubbleColor) ??
      DEFAULT_MESSAGE_BUBBLE_COLOR,
  );
  const [alertPrefs, setAlertPrefsState] = useState(getAlertPrefs);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismissOnBackdropClick = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const keyboardInset = useVisualViewportBottomInset();

  useEffect(() => {
    if (keyboardInset === 0) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !panelRef.current?.contains(active)) {
      return;
    }
    requestAnimationFrame(() => scrollElementIntoComfortableView(active));
  }, [keyboardInset]);

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
        messageBubbleColor,
      });

      setContactEmail(saved.contactEmail ?? '');
      setMessageBubbleColor(
        normalizeMessageBubbleColor(saved.messageBubbleColor) ??
          DEFAULT_MESSAGE_BUBBLE_COLOR,
      );
      onSaved({
        contactEmail: saved.contactEmail,
        messageBubbleColor: saved.messageBubbleColor,
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
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 sm:items-center sm:justify-center sm:p-4"
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className="w-full max-w-sm overflow-y-auto overscroll-contain rounded-t-2xl bg-[var(--color-panel)] p-6 sm:max-h-[min(90dvh,100%)] sm:rounded-2xl"
        style={{
          maxHeight:
            keyboardInset > 0
              ? `calc(100dvh - ${keyboardInset}px - 0.5rem)`
              : 'min(90dvh, 100%)',
          marginBottom: keyboardInset > 0 ? keyboardInset : undefined,
          scrollPaddingBlock: '1.5rem',
        }}
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

        <form
          onSubmit={(e) => void save(e)}
          className="space-y-4"
          autoComplete="off"
          data-no-save-password="true"
        >
          <NoSaveField
            label="Email address (optional)"
            type="email"
            value={contactEmail}
            onChange={setContactEmail}
            placeholder="you@example.com"
            keepInViewOnFocus
          />
          <p className="text-xs text-[var(--color-muted)]">
            When saved, new messages email you from {`Private Messenger Service`}
            with a link to open that message. Do not reply to those emails — they
            are sent automatically.
          </p>

          <section className="space-y-3 border-t border-white/10 pt-4">
            <div>
              <h3 className="text-sm font-medium">Your message color</h3>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                Pick the bubble color other people see on messages you send.
              </p>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {MESSAGE_BUBBLE_COLORS.map((option) => {
                const selected = messageBubbleColor === option.background;
                const preview = bubbleStyleForColor(option.background, true);
                return (
                  <button
                    key={option.id}
                    type="button"
                    title={option.label}
                    aria-label={option.label}
                    aria-pressed={selected}
                    onClick={() => setMessageBubbleColor(option.background)}
                    className={`flex h-11 items-center justify-center rounded-xl border text-xs font-medium transition ${
                      selected
                        ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/40'
                        : 'border-white/10 hover:border-white/25'
                    }`}
                    style={{
                      background: preview.backgroundColor,
                      color: preview.color,
                    }}
                  >
                    Aa
                  </button>
                );
              })}
            </div>
          </section>

          {isNotificationSupported() && (
            <section className="space-y-3 border-t border-white/10 pt-4">
              <div>
                <h3 className="text-sm font-medium">Message alerts</h3>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                  Sound and pop-ups on any screen while Messenger is open. Unread
                  counts also appear on each chat in the list.
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
                  <span className="font-medium">Pop-up when a message arrives</span>
                  <span className="mt-0.5 block text-[var(--color-muted)]">
                    Shows a system notification for each new message on any screen
                    while Messenger is open. Your browser will ask for permission
                    the first time.
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
                    Play a short chime for every new incoming message on any screen
                    while Messenger is open.
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
