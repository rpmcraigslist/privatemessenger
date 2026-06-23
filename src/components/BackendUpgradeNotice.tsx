export default function BackendUpgradeNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-6 py-12">
      <h1 className="text-2xl font-semibold">Backend needs redeploy</h1>

      <p className="text-[var(--color-muted)]">
        The app cannot find the bootstrap API in <code>amplify_outputs.json</code>.
        That usually means the hosted backend deploy did not finish or the browser
        is still using an old build.
      </p>

      <ol className="space-y-3 rounded-2xl bg-[var(--color-panel)] p-5 text-sm leading-relaxed">
        <li>
          <span className="font-semibold text-[var(--color-accent)]">1.</span>{' '}
          Amplify Console (Ohio) → your app → confirm the latest <code>main</code>{' '}
          build is green (backend + frontend).
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">2.</span>{' '}
          Build log should show <code>Deploying backend to AWS region us-east-2</code>{' '}
          and a successful <code>ampx pipeline-deploy</code>.
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">3.</span>{' '}
          Hard-refresh the app or clear site data (PWA cache keeps old versions).
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">4.</span>{' '}
          Local dev only: <code>npm run sandbox</code> with{' '}
          <code>$env:AWS_REGION = &quot;us-east-2&quot;</code>.
        </li>
      </ol>
    </div>
  );
}
