# Region migration (us-east-1 → us-east-2)

One-time move of Cognito users, DynamoDB rows, and S3 attachments from the old Virginia backend to Ohio.

**Why this is not fully automatic inside `pipeline-deploy`:** AWS has no native “move stack” API. Export must run while the old stack still exists; import runs after the new Ohio stack exists. Teardown runs only after you verify the app.

## Prerequisites

- AWS CLI credentials with admin access (`aws sts get-caller-identity` works)
- `cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-2` already done
- Amplify env vars set (`MESSENGER_FROM_EMAIL`, etc.)

## Steps

### 1. Export Virginia data (local, once)

```powershell
$env:AWS_REGION = "us-east-1"
npm run migrate:export
```

Writes `scripts/region-migration/data/export/` (gitignored).

### 2. Deploy Ohio backend

Push to `main`. Amplify runs `pipeline-deploy` with `AWS_REGION=us-east-2` (see `amplify.yml`).

Wait for the build to finish. Download or copy the new `amplify_outputs.json` — it must show `aws_region: "us-east-2"` and a pool id like `us-east-2_...`.

### 3. Import into Ohio (local, once)

```powershell
$env:AWS_REGION = "us-east-2"
$env:MIGRATION_TEMP_PASSWORD = "ChangeMeNow1!"
npm run migrate:import -- amplify_outputs.json
```

- Recreates Cognito users with a **temporary password** (passwords cannot be migrated).
- Remaps Cognito `sub` values in conversations, messages, profiles, and read state.
- Copies S3 attachment objects.

### 4. Verify production

- Sign in at `https://main.d332i3bk71so1w.amplifyapp.com`
- Open existing chats, messages, attachments
- Send a test message + email alert

### 5. Delete Virginia stack

```powershell
$env:AWS_REGION = "us-east-1"
$env:MIGRATION_TEARDOWN_CONFIRM = "DELETE_US_EAST_1"
npm run migrate:teardown
```

Confirm in CloudFormation (N. Virginia) that the old stack is deleted.

## Optional: import during Amplify build

Only if export data is committed or uploaded to S3 and you know what you are doing:

```yaml
# amplify.yml — not enabled by default
- export RUN_REGION_MIGRATION_IMPORT=true
```

Prefer running `migrate:import` locally so you can verify before teardown.

## Email env vars (separate from migration)

| Name | Purpose |
| ---- | ------- |
| `MESSENGER_FROM_EMAIL` | Verified sender address in SES (e.g. `noreply@yourdomain.com`) |
| `MESSENGER_FROM_DISPLAY_NAME` | Optional friendly name (default: `Private Messenger Service`) |
| `MESSENGER_APP_URL` | Link base for alert emails |

The display name does **not** change when you set the from email unless you also set `MESSENGER_FROM_DISPLAY_NAME`.
