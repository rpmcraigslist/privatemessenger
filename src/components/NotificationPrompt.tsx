import { useState } from 'react';
import {
  dismissNotifyPrompt,
  getNotificationPermission,
  isNotificationSupported,
  isNotifyPromptDismissed,
  requestNotificationPermission,
  setAlertPrefs,
} from '../lib/app-notifications';

type Props = {
  onEnabled?: () => void;
};

export default function NotificationPrompt({ onEnabled }: Props) {
  const [hidden, setHidden] = useState(
    () =>
      !isNotificationSupported() ||
      isNotifyPromptDismissed() ||
      getNotificationPermission() !== 'default',
  );
  const [busy, setBusy] = useState(false);

  if (hidden) return null;

  async function enable() {
    setBusy(true);
    try {
      const permission = await requestNotificationPermission();
      if (permission === 'granted') {
        setAlertPrefs({ browserNotifications: true });
        onEnabled?.();
      }
      dismissNotifyPrompt();
      setHidden(true);
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    dismissNotifyPrompt();
    setHidden(true);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 sm:p-4">
      <div className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-2xl border border-white/10 bg-[var(--color-panel)] p-4 shadow-2xl sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Pop-up message alerts</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Get a small system notification when someone messages you and you are
            not looking at that chat. Not SMS — free in the browser.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="rounded-full px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-white/5 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy}
            className="rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            Enable
          </button>
        </div>
      </div>
    </div>
  );
}
