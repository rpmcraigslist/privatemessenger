export default function BackendUpgradeNotice() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 px-6 py-12">
      <h1 className="text-2xl font-semibold">Backend needs redeploy</h1>

      <p className="text-[var(--color-muted)]">
        Your <code>amplify_outputs.json</code> is from an older version of this
        app (before admin bootstrap). The sign-in page cannot detect an empty user
        pool until the new backend is deployed.
      </p>

      <p className="text-sm text-[var(--color-muted)]">
        DynamoDB profile rows are not the issue — first-time setup checks{' '}
        <strong>Cognito users</strong> via a new API that is missing from your
        current outputs file.
      </p>

      <ol className="space-y-3 rounded-2xl bg-[var(--color-panel)] p-5 text-sm leading-relaxed">
        <li>
          <span className="font-semibold text-[var(--color-accent)]">1.</span>{' '}
          Confirm AWS credentials: <code>aws sts get-caller-identity</code>
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">2.</span>{' '}
          Redeploy:{' '}
          <code>npm run sandbox -- --stream-function-logs</code>
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">3.</span>{' '}
          Wait for <strong>Deployment completed</strong> and a refreshed{' '}
          <code>amplify_outputs.json</code> (look for{' '}
          <code>bootstrapRequired</code> and <code>api_key</code> in the data
          section).
        </li>
        <li>
          <span className="font-semibold text-[var(--color-accent)]">4.</span>{' '}
          Restart <code>npm run dev</code> and hard-refresh the browser.
        </li>
      </ol>

      <p className="text-xs text-[var(--color-muted)]">
        Optional clean slate: <code>npx ampx sandbox delete</code> then redeploy.
        That removes Cognito users and DynamoDB tables from the sandbox stack.
      </p>
    </div>
  );
}
