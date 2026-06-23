# Fresh start (one region, no migration)

Use this when you **do not** need old users, messages, or attachments.

**Release 1.4** — backend and hosting deploy to **us-east-2 (Ohio) only**.

---

## Recommended region: **us-east-2 (Ohio)**

| Reason | Detail |
| ------ | ------ |
| Amplify Hosting app | Ohio (`d332i3bk71so1w`) |
| Cognito, AppSync, DynamoDB, Lambda, S3 | Ohio (via `amplify.yml`) |
| Amazon SES (email alerts) | **Ohio** — same region as `message-alerts` Lambda |

Do **not** run `ampx sandbox` in **us-east-1** while hosting deploys to Ohio — that recreates the two-region mess.

---

## After AWS cleanup (you are here)

Old CloudFormation stacks deleted in Virginia and Ohio. **CDKToolkit** stays in each region.

### 1. Commit and push

Push `main` with version **1.4**. Amplify runs backend + frontend in Ohio.

### 2. Wait for green build

Build log should include:

- `Deploying backend to AWS region us-east-2`
- `npx ampx pipeline-deploy` succeeds (requires `@aws-amplify/backend-cli` in `package.json`)

First deploy after cleanup often takes **15–25 minutes**.

### 3. Bootstrap on the live URL

1. Open `https://main.d332i3bk71so1w.amplifyapp.com` (hard refresh or clear site data if cached).
2. Login screen shows **Version 1.4**.
3. Complete **bootstrap admin** (empty user pool).
4. Admin panel → create users.

### 4. Email alerts (Ohio only)

| Step | Where |
| ---- | ----- |
| `MESSENGER_FROM_EMAIL` | Amplify → Hosting → Environment variables |
| `MESSENGER_APP_URL` | Same (e.g. `https://main.d332i3bk71so1w.amplifyapp.com`) |
| Verify sender | [SES us-east-2](https://us-east-2.console.aws.amazon.com/ses/home?region=us-east-2) |
| Redeploy | After env vars change, redeploy `main` |

Each user sets **contact email** in Profile (or admin sets it at create time). SES sandbox also requires verifying recipient addresses until you request production access.

### 5. Confirm one backend

After deploy, `amplify_outputs.json` from the build should show:

- `"aws_region": "us-east-2"` everywhere
- `user_pool_id` starting with `us-east-2_`

---

## Lessons from the old setup (avoid repeating)

| Problem | Cause | Fix in 1.4 |
| ------- | ----- | ---------- |
| “More users” in UI than Cognito | Duplicate `UserProfile` rows (UUID login bug) | Fresh DB; consolidation on login/directory |
| Old messages looked unread | Read cursors local-only + duplicate chats | Server read cursors + deduped conversations |
| Email never sent | `MESSENGER_FROM_EMAIL` missing; SES in wrong region | Env var + SES in **Ohio** |
| Two backends / regions | Sandbox in us-east-1, hosting in us-east-2 | Single region pin in `amplify.yml` |

---

## Cleanup reference (already done)

<details>
<summary>Virginia + Ohio stack delete (for reference)</summary>

### Virginia (`us-east-1`)

Delete parent stack `amplify-privatemessenger-*` (not only `-auth` nested). Empty S3 bucket if delete fails.

### Ohio (`us-east-2`)

Delete parent `amplify-d332i3bk71so1w-main-branch-*` before fresh deploy. Leave **CDKToolkit**.

### S3 orphans (CloudFormation often leaves these)

Stack delete does **not** always remove buckets. Check:

- [S3 us-east-1](https://s3.console.aws.amazon.com/s3/buckets?region=us-east-1)
- [S3 us-east-2](https://s3.console.aws.amazon.com/s3/buckets?region=us-east-2)

**Keep (do not delete):**

- `cdk-hnb659fds-assets-*` — **required for every deploy** (CDK staging; schema/Lambda zips)
- `CDKToolkit` CloudFormation stack
- After 1.4 deploy succeeds: the **current** `*messengerattachments*` bucket for the live stack

**Usually safe to delete** (empty first, then delete bucket):

- `*messengerattachments*`
- `amplify-privatemessenger*`
- Old `amplify-d332i3bk71so1w-*` **deployment** buckets from deleted stacks

**Keep:** `cdk-hnb659fds-assets-*` (CDKToolkit). After 1.4 deploy succeeds, keep the **current** attachments bucket the new stack created.

**Never delete `cdk-hnb659fds-assets-*`.** Deploy will fail with “schema from S3 / NoSuchBucket” without it.

List suspects locally:

```powershell
$env:AWS_PROFILE = "personal-admin"
npm run cleanup:list-s3
```

Console: bucket → **Empty** → **Delete bucket**.

</details>

Local migration export (optional delete):

```powershell
Remove-Item -Recurse -Force scripts\region-migration\data\export -ErrorAction SilentlyContinue
```

Ignore `npm run migrate:*` for fresh start.

---

## CDK bootstrap (required if deploy says NoSuchBucket / schema from S3)

If Amplify build fails with **“Error retrieving the schema from S3”** or **NoSuchBucket**, the **CDK assets bucket** is missing. That often happens if `cdk-hnb659fds-assets-*` was deleted during cleanup while **CDKToolkit** still exists.

**Never delete:** `cdk-hnb659fds-assets-*` — every deploy uploads Lambda code and GraphQL schema there.

Fix (Ohio):

```powershell
$env:AWS_PROFILE = "personal-admin"
$env:AWS_REGION = "us-east-2"
aws sts get-caller-identity
npx aws-cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-2
```

Confirm in [S3 Ohio](https://s3.console.aws.amazon.com/s3/buckets?region=us-east-2) that `cdk-hnb659fds-assets-ACCOUNTID-us-east-2` exists.

Then **Amplify → Redeploy `main`**.

## Local sandbox (optional)

Always use Ohio for sandbox if you use sandbox at all:

```powershell
$env:AWS_REGION = "us-east-2"
npm run sandbox
```

Production hosting does **not** share data with sandbox.
