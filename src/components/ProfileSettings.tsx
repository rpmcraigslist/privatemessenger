import { useState } from 'react';
import { normalizePhone, phoneError } from '../lib/util';
import { syncMyProfile, type SessionUser } from '../lib/session';

type Props = {
  user: SessionUser;
  onClose: () => void;
  onSaved: (phoneNumber: string | null) => void;
};

export default function ProfileSettings({ user, onClose, onSaved }: Props) {
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const value = normalizePhone(phoneNumber);
      await syncMyProfile(value);
      onSaved(value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--color-panel)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold">Your profile</h2>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          Signed in as <strong>{user.username}</strong>
          {user.isAdmin ? ' (admin)' : ''}
        </p>
        <form onSubmit={(e) => void save(e)} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-[var(--color-muted)]">
              Cell phone for SMS alerts (E.164, e.g. +15551234567)
            </span>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+15551234567"
              className="w-full rounded-lg bg-[var(--color-panel-2)] px-3 py-2.5 outline-none"
            />
          </label>
          <p className="text-xs text-[var(--color-muted)]">
            You receive a text when someone sends you a new message. SMS rates
            apply via AWS.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full py-3 font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-accent)' }}
          >
            Save
          </button>
        </form>
      </div>
    </div>
  );
}
