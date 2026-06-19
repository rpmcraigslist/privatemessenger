import { useRef, useState } from 'react';

import {
  formatPhoneDisplay,
  formatUserHandle,
  normalizePhone,
  phoneError,
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
  const [phoneNumber, setPhoneNumber] = useState(
    user.phoneNumber ? formatPhoneDisplay(user.phoneNumber) : '',
  );
  const [smsEnabled, setSmsEnabled] = useState(user.smsNotificationsEnabled);
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

  function formatPhoneInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return normalizePhone(trimmed);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const phoneErr = phoneError(phoneNumber);
      if (phoneErr) {
        setError(phoneErr);
        return;
      }

      const normalized = formatPhoneInput(phoneNumber);
      if (smsEnabled && !normalized) {
        setError('Add a phone number to enable SMS notifications.');
        return;
      }

      const saved = await syncMyProfile({
        phoneNumber: normalized,
        smsNotificationsEnabled: smsEnabled,
      });

      if (saved.phoneNumber) {
        setPhoneNumber(formatPhoneDisplay(saved.phoneNumber));
      } else {
        setPhoneNumber('');
      }
      setSmsEnabled(saved.smsNotificationsEnabled);

      onSaved({
        phoneNumber: saved.phoneNumber,
        smsNotificationsEnabled: saved.smsNotificationsEnabled,
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
              Cell phone for SMS alerts
            </span>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              onBlur={() => {
                const normalized = formatPhoneInput(phoneNumber);
                if (normalized) {
                  setPhoneNumber(formatPhoneDisplay(normalized));
                }
              }}
              placeholder="8013684783 or (801) 368-4783"
              inputMode="tel"
              autoComplete="tel"
              className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 outline-none"
            />
          </label>

          <label className="flex items-start gap-3 rounded-lg bg-[var(--color-panel-2)] px-3 py-3">
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={(e) => setSmsEnabled(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium">SMS notifications</span>
              <span className="mt-0.5 block text-[var(--color-muted)]">
                Text me when someone sends a new message. Standard SMS rates
                apply.
              </span>
            </span>
          </label>

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
