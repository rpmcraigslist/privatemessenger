type Props = {
  label?: string;
};

export default function BusyOverlay({ label = 'Working…' }: Props) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-[var(--color-panel)] px-6 py-5 shadow-xl">
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <p className="text-center text-sm text-[var(--color-muted)]">{label}</p>
      </div>
    </div>
  );
}
