# Private Messenger

A private, real-time, mobile-first messenger PWA built to run on the **AWS Free Tier**.

It uses **AWS Amplify Gen 2** to provision the exact stack from the spec:

| Concern         | AWS service                              | Free-tier allowance                         |
| --------------- | ---------------------------------------- | ------------------------------------------- |
| Auth            | Amazon Cognito User Pools                | 5,000 monthly active users                  |
| API (real-time) | AWS AppSync (GraphQL + WebSockets)       | 4M operations/month                         |
| Database        | Amazon DynamoDB (on-demand)              | 25 GB storage                               |
| File storage    | Amazon S3                                | 5 GB, 2,000 PUT, 20,000 GET                 |
| Web hosting     | Amazon S3 + Amazon CloudFront            | 1 TB CloudFront data transfer out           |
| Frontend        | React + Vite + TypeScript + Tailwind CSS | free (your code)                            |

> Amplify Gen 2 is the current, code-first replacement for the older
> `amplify init` / `amplify add` CLI flow. The backend is defined in TypeScript
> under `amplify/`, and the CLI is `ampx`.

---

## What you get

- Email sign-up / sign-in / verification / password reset (optional TOTP MFA) via Cognito.
- 1:1 and group conversations with **instant real-time delivery** (AppSync subscriptions).
- Image and file attachments uploaded to conversation-scoped S3 paths; downloads are membership-checked via Lambda.
- A WhatsApp/Telegram-style dark, mobile-first UI.
- Installable **PWA** ("Add to Home Screen" on iOS & Android) with offline app shell.

---

## Prerequisites

- Node.js 18+ (you have 24) and npm.
- An AWS account.
- AWS credentials configured locally: `aws configure` (uses your existing AWS CLI).

---

## 1. Run it locally (cloud sandbox)

`ampx sandbox` deploys a **personal, isolated copy** of the backend to your AWS
account and hot-reloads it as you edit `amplify/`. It writes `amplify_outputs.json`
(the client config) to the project root.

```bash
npm install            # already done if you cloned with node_modules
npm run sandbox        # terminal 1 — provisions Cognito/AppSync/DynamoDB/S3, keep running
npm run dev            # terminal 2 — Vite dev server at http://localhost:5173
```

Open the dev URL, create an account, and start chatting. Open a second browser
(or your phone on the same network) with a different account to see messages
arrive in real time.

When you're done experimenting, tear the sandbox down to avoid leaving resources:

```bash
npx ampx sandbox delete
```

### Docker (optional)

Docker is great for a consistent dev environment on your machine. **It does not
replace AWS** — Cognito, AppSync, DynamoDB, and S3 still run in your Amazon
account. There is no practical, full offline emulator for this Amplify Gen 2
stack (LocalStack's AppSync/Cognito coverage is incomplete for this use case).

```bash
# Copy and edit credential paths for Windows if needed
cp .env.example .env

# Frontend only (backend already deployed / sandbox running on host)
npm run docker:dev
# -> http://localhost:5173

# Frontend + personal AWS sandbox inside Docker (mounts ~/.aws)
npm run docker:aws

# Production-style static build served by nginx (frontend only)
npm run docker:prod
# -> http://localhost:8080
```

For the `aws` profile, set `AWS_CREDENTIALS_DIR` in `.env` (Windows example:
`C:\Users\You\.aws`). The sandbox container provisions real resources in your
account — expect a few cents to a couple dollars per month for light personal use.

---

## 2. Deploy the backend (production)

The cleanest path is Amplify Hosting's Git-based pipeline, which builds the
frontend AND provisions the backend on every push.

**Option A — Amplify Hosting (recommended, includes CloudFront + S3 + CI/CD):**

1. Push this repo to GitHub/GitLab/Bitbucket/CodeCommit.
2. AWS Console → **Amplify** → **Create new app** → connect your repo/branch.
3. Amplify auto-detects Gen 2 and runs `ampx pipeline-deploy` + `npm run build`.
4. You get a live `https://<branch>.<id>.amplifyapp.com` URL on CloudFront with
   free SSL and global caching.

The included `amplify.yml` build spec handles both backend and frontend.

**Option B — Manual S3 + CloudFront hosting:**

```bash
# Provision the backend once and generate amplify_outputs.json
npx ampx pipeline-deploy --branch main --app-id <YOUR_AMPLIFY_APP_ID>
# (or use `npm run sandbox:once` to deploy a sandbox without watching)

npm run build          # outputs static assets to ./dist

# Upload to an S3 bucket configured for static hosting, then point a
# CloudFront distribution at it (origin = the S3 bucket) for HTTPS + caching.
aws s3 sync dist/ s3://<YOUR_BUCKET> --delete
```

For an SPA, set the CloudFront/S3 error document to `index.html` (or a 403/404
→ `/index.html` response) so client-side routes resolve.

---

## 3. Manage users

No admin panel needed — manage, create, disable, or delete users from the
**AWS Console → Cognito → User pools**. In-app, signed-in users are discoverable
through the lightweight `UserProfile` directory so you can start chats by name or
email (or invite a brand-new email).

---

## ⚠️ Cost & safety settings

**Realistic monthly cost for a small personal deployment:** often **$0–$5**.
Amplify Hosting + a lightly used sandbox typically stays near free-tier limits;
a few active users with attachments might land around **$2–$8/month** depending on
region and traffic. Set a budget alert so you are never surprised.

1. **AWS Budgets:** Billing console → Budgets → create a **$5** monthly cost
   budget with an email alert at 80% and 100%.
2. **DynamoDB on-demand:** already configured — you pay per request, so an idle
   app costs ~$0.
3. **S3 lifecycle (optional):** add a rule to expire `conversations/` objects after
   30 days (or move to Glacier Deep Archive) to stay under 5 GB.
4. **Tear down sandboxes** you are not using: `npx ampx sandbox delete`.

---

## Project structure

```
amplify/
  backend.ts            # wires auth + data + storage + attachment Lambda
  auth/resource.ts      # Cognito user pool (email login, optional MFA)
  data/resource.ts      # GraphQL schema + participant-scoped authorization
  storage/resource.ts   # conversation-scoped S3 paths
  functions/attachment-url/  # membership-checked presigned download URLs
docker/
  nginx.conf            # SPA config for production Docker image
Dockerfile              # dev (Vite) + production (nginx) targets
docker-compose.yml      # web dev server + optional AWS sandbox profile
src/
  App.tsx               # Authenticator gate
  components/            # Messenger shell, conversation list, chat view, composer, modal
  lib/amplify.ts        # Amplify.configure + typed GraphQL client
  lib/util.ts           # formatting / avatar helpers
amplify_outputs.json    # generated client config (placeholder committed; real one written on deploy)
vite.config.ts          # React + Tailwind v4 + PWA plugins
```

---

## Security model

Access is enforced in AppSync, not just hidden in the UI:

| Resource | Rule |
| -------- | ---- |
| `Conversation` | `ownersDefinedIn('participants')` with Cognito **email** claim — only listed participants can read/create/update/delete |
| `Message` | `ownersDefinedIn('participantEmails')` — copied from the parent conversation when sent |
| `UserProfile` | Any signed-in user can read the directory; each user owns their own profile row |
| S3 attachments | Uploader writes under `conversations/{id}/...`; other participants fetch via `getAttachmentUrl` Lambda |

**Note:** invited users must sign up before they can see a thread created with their
email. The `UserProfile` directory only lists users who have logged in at least once.

---

## Optional: push notifications (free with FCM)

Per the spec, you can add offline push without SMS costs:

1. Enable **DynamoDB Streams** on the `Message` table.
2. Add an Amplify **function** (`amplify/functions/notify/`) triggered by the
   stream. When a new message is written, look up offline recipients.
3. Send a **Firebase Cloud Messaging (FCM)** web push (100% free, unlimited) —
   register a service worker on the client and store each user's FCM token.

This repo intentionally ships without it to keep the free-tier footprint at zero
until you need it; the hooks (service worker via PWA, `UserProfile` table) are
already in place to extend.

---

Built with AWS Amplify Gen 2, React, Vite, and Tailwind CSS.
