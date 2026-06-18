export default function SetupNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-6 py-12">
      <div className="flex items-center gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: 'var(--color-accent)' }}
        >
          <ChatGlyph />
        </div>
        <h1 className="text-2xl font-semibold">Private Messenger</h1>
      </div>

      <p className="text-[var(--color-muted)]">
        The frontend is ready, but it isn't connected to an AWS backend yet. Deploy
        the Amplify backend to generate <code>amplify_outputs.json</code>, then this
        screen will be replaced by the sign-in page.
      </p>

      <ol className="space-y-3 rounded-2xl bg-[var(--color-panel)] p-5 text-sm leading-relaxed">
        <li>
          <span className="font-semibold text-[var(--color-accent)]">1.</span>{' '}
          Configure AWS credentials once: <code>aws configure</code>
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">2.</span>{' '}
          Start a personal cloud sandbox: <code>npm run sandbox</code>
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">3.</span>{' '}
          Leave it running. It provisions Cognito, AppSync, DynamoDB &amp; S3 and
          writes <code>amplify_outputs.json</code>.
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">4.</span>{' '}
          In a second terminal run <code>npm run dev</code> and refresh.
        </li>
      </ol>

      <p className="text-xs text-[var(--color-muted)]">
        See <code>README.md</code> for the full free-tier deployment guide
        (CloudFront + S3 hosting and budget safety alerts).
      </p>
    </div>
  );
}

function ChatGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5H9l-4 4v-4H5.5C4.67 16 4 15.33 4 14.5v-9Z"
        fill="white"
      />
    </svg>
  );
}
