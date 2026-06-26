# Private Messenger

A private, real-time, mobile-first messenger PWA built to run on the **AWS Free Tier**.

It uses **AWS Amplify Gen 2** (code-first backend under `amplify/`, CLI is `ampx`).

| Concern         | AWS service                              | Free-tier allowance (approx.)               |
| --------------- | ---------------------------------------- | ------------------------------------------- |
| Auth            | Amazon Cognito User Pools                | 5,000 monthly active users                  |
| API (real-time) | AWS AppSync (GraphQL + WebSockets)       | 4M operations/month                         |
| Database        | Amazon DynamoDB (on-demand)              | 25 GB storage                               |
| File storage    | Amazon S3                                | 5 GB, 2,000 PUT, 20,000 GET                 |
| Email alerts      | Amazon SES (via Lambda)                  | Verify sender in **us-east-2** |
| Web hosting     | Amazon S3 + CloudFront (Amplify Hosting) | 1 TB CloudFront data transfer out           |
| Frontend        | React + Vite + TypeScript + Tailwind CSS | free (your code)                            |

---

## What you get

- **Admin-controlled accounts** — no public sign-up in the UI. First visit to an empty user pool runs one-time **bootstrap admin** setup; after that, admins create users from the in-app **Admin panel**.
- **Username login** — users sign in with a handle like `steve`. Cognito stores a synthetic login id `{user}@messenger.local` (email-shaped, required by Amplify).
- **Temporary passwords** — new users must set a new password on first sign-in (`CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED`).
- **1:1 and group chat** with real-time delivery (AppSync `observeQuery` subscriptions).
- **Attachments** — images/files in S3; other participants download via the `getAttachmentUrl` Lambda (membership checked).
- **Email alerts** — if a user saves a **contact email** in Profile, new messages send a one-way notification via **Amazon SES** (`sendMessageAlerts`) with a link to open the chat.
- **In-app alerts** — optional sound and pop-up notifications while Messenger is open (Profile → Message alerts).
- **Delete your messages** — tap ··· on your own message → Delete; removed for all participants.
- **Dark mobile-first UI** and an installable **PWA** shell (offline app shell only — messaging requires network).

**Not included:** forgot-password flow, email verification UX, TOTP MFA (disabled in pool config), message edit, read receipts, SMS/text alerts, or background push notifications.

---

## Prerequisites

- Node.js 18+ and npm
- An AWS account with credentials: `aws configure`
- Git (for Amplify Hosting deploys)

---

## 1. Run locally (personal sandbox)

`ampx sandbox` deploys an isolated backend to **your** AWS account and writes `amplify_outputs.json`.

```bash
npm install
npm run sandbox        # terminal 1 — keep running
npm run dev            # terminal 2 — http://localhost:5173
```

**First launch:** create the bootstrap admin account when prompted.

**Add users:** sign in as admin → **Admin panel** → create users.

**Test two accounts:** use two separate browser profiles — e.g. Chrome + Firefox, or two **Incognito** windows. Each window holds one session. Sign out before switching users in the same normal window.

**Tear down** when done experimenting:

```bash
npx ampx sandbox delete
```

> **Sandbox ≠ production.** Amplify Hosting deploys a separate Cognito pool and DynamoDB tables. Users and messages from localhost do not carry over to the hosted URL.

### Docker (optional)

Docker runs the UI locally; Cognito, AppSync, DynamoDB, and S3 still live in AWS.

```bash
npm run docker:dev     # UI only (sandbox must already be running)
npm run docker:aws     # UI + sandbox inside container (mounts ~/.aws)
npm run docker:prod    # static build on http://localhost:8080
```

See `docs/AWS-GETTING-STARTED.md` for architecture notes and troubleshooting. See **`docs/ARCHITECTURE.md`** for service map, diagrams, and step-by-step workflows.

---

## 2. Deploy for others (Amplify Hosting)

**Region:** everything deploys to **us-east-2 (Ohio)** — Amplify app, backend, and SES. See `docs/FRESH-START.md` if you reset AWS from scratch.

Recommended path: connect GitHub to **Amplify Hosting**. The repo’s `amplify.yml` runs backend + frontend on each push.

1. Push this repo to GitHub.
2. AWS Console → **Amplify** → **Create new app** → connect repo, branch `main`.
3. Wait for the first build (often 10–20 minutes).
4. Open the `https://main.<id>.amplifyapp.com` URL.
5. **Bootstrap admin again** on the production URL (empty pool).
6. Create users in **Admin panel**; share the URL.

```bash
git add .
git commit -m "Your change"
git push                 # Amplify rebuilds automatically
```

**HTTPS + PAT** is the most reliable way to push from corporate networks (SSH port 22 is often blocked). See git troubleshooting in `docs/AWS-GETTING-STARTED.md`.

**Manual static hosting** (frontend only, after backend is deployed separately) is possible via `npm run build` + S3/CloudFront, but Amplify Hosting is simpler for this stack.

---

## 3. Manage users

| Task | How |
| ---- | --- |
| Create user | Signed-in admin → **Admin panel** → username + temporary password (+ optional phone) |
| Delete user | Admin panel (cannot delete yourself while signed in) |
| Purge all users | Admin panel (keeps current admin) |
| Clear all messages | Admin panel (deletes all messages **and** conversations) |
| Forgot password | Admin sets a new temporary password in Cognito console or re-creates the user |
| First admin | Automatic **bootstrap** form when the user pool is empty |

After admin creates a user, they appear in **New chat** immediately. They must **sign in at least once** before someone can start a real-time chat with them (`cognitoSub` is set on first login via `syncMyProfile`).

---

## Project structure

```
amplify/
  backend.ts                 # auth + data + storage + Lambda wiring
  auth/resource.ts             # Cognito pool, Admin group, preSignUp trigger
  data/resource.ts             # GraphQL schema + authorization
  storage/resource.ts          # conversation-scoped S3 paths
  functions/
    bootstrap-required/        # is pool empty?
    bootstrap-admin/           # create first admin (API key auth)
    admin-ops/                 # user CRUD, clear messages, listUserDirectory
    profile-sync/              # syncMyProfile on login, repair legacy participant ids
    message-alerts/            # SES email on new messages
    attachment-url/            # presigned download URLs
    pre-sign-up/               # auto-confirm trigger
src/
  App.tsx                      # setup gates → AuthGate → Messenger
  components/                  # AuthGate, Messenger, AdminPanel, chat UI
  lib/
    amplify.ts                 # Amplify.configure + GraphQL client (userPool auth)
    session.ts                 # sign-in, syncMyProfile, session user
    directory.ts               # listUserDirectory for chat picker
amplify_outputs.json           # client config (regenerated on sandbox/pipeline deploy)
amplify.yml                    # Amplify Hosting build spec
docs/
  ARCHITECTURE.md            # service map, diagrams, workflows
  AWS-GETTING-STARTED.md     # account setup, deploy, troubleshooting
  FRESH-START.md             # one-region reset after cleanup (v1.4+)
```

---

## Security model (current)

Authorization is enforced in AppSync, but some fields are still client-supplied (see limitations below).

| Resource | Rule |
| -------- | ---- |
| `Conversation` | `ownersDefinedIn('participants')` with Cognito **`sub`** claim — only listed participant subs can access the thread |
| `Message` | `ownersDefinedIn('participantUsernames')` with **`sub`** — array copied from the conversation when sending (field name is legacy; values are subs) |
| `UserProfile` | Any signed-in user can read profiles (directory). Rows are created/updated by Lambdas (`syncMyProfile`, admin create user), not directly by clients |
| `listUserDirectory` | Authenticated query; Lambda lists profiles (and ensures Cognito users have directory stubs) |
| S3 attachments | Uploader writes under `conversations/{id}/...`; downloads via `getAttachmentUrl` after membership check |
| Bootstrap | `bootstrapRequired` / `bootstrapAdmin` use **API key** auth — only safe when the pool is empty; first caller wins |

### Known limitations (personal use OK, public internet risky)

- Message `participantUsernames` and conversation `participants` are writable by clients — a modified app could tamper with membership ACL fields.
- `sendMessageAlerts` does not verify the caller sent the message (email cost/abuse if contact emails are stored).
- Public API-key bootstrap on an empty pool — deploy promptly after creating infrastructure.
- No server-side disable of Cognito self-sign-up beyond UI hiding it (pool should be locked down for untrusted audiences).

---

## Notifications

**Email (optional):** save a **contact email** in Profile → SES sends a link when a message arrives (requires `MESSENGER_FROM_EMAIL` in Amplify env vars).

**In-app (optional):** enable sound and pop-ups in Profile while Messenger is open.

---

## Cost & safety

Realistic small deployment: often **$0–$5/month**. Set a **$5 AWS Budget** alert.

- Tear down unused sandboxes: `npx ampx sandbox delete`
- `adminClearMessages` deletes DB rows but not S3 attachment objects (orphans possible)

---

Built with AWS Amplify Gen 2, React, Vite, and Tailwind CSS.
