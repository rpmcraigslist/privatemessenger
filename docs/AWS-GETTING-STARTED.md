# AWS setup & architecture

This project uses **AWS Amplify Gen 2** — TypeScript-defined backend (`amplify/`) synthesized to CloudFormation/CDK. There is no Kubernetes cluster and no container registry for the main app.

---

## Do I need an Amazon account?

**Yes.** Cognito, AppSync, DynamoDB, S3, Lambda, and (optionally) SNS all run in AWS.

1. Create an account: https://aws.amazon.com/free/
2. IAM → **Users** → create a dev user
3. Attach **`AdministratorAccess-Amplify`** (or `PowerUserAccess` for tighter scope)
4. Create access keys → `aws configure`:

| Prompt | Value |
| ------ | ----- |
| Access Key ID | From IAM |
| Secret Access Key | From IAM (save once) |
| Region | e.g. `us-east-1` (must match where you deploy) |
| Output | `json` |

---

## Architecture map

| Piece | Service | Notes |
| ----- | ------- | ----- |
| Static UI | S3 + CloudFront | Via **Amplify Hosting** on git push |
| Sign-in | Cognito User Pool | Username UX; login id `{user}@messenger.local` |
| Real-time API | AppSync GraphQL + WebSockets | Subscriptions for conversations/messages |
| Data | DynamoDB on-demand | `Conversation`, `Message`, `UserProfile` |
| Files | S3 + Cognito Identity Pool | Upload paths under `conversations/{id}/...` |
| Backend logic | Lambda | Admin ops, profile sync, SMS, attachments, bootstrap |

**Deploy flow:**

```
amplify/*.ts  →  ampx sandbox | pipeline-deploy  →  CloudFormation
                                                      ↓
                                            amplify_outputs.json
                                                      ↓
                                            React app at runtime
```

### Lambdas

| Function | Purpose |
| -------- | ------- |
| `bootstrap-required` | Public query: is user pool empty? |
| `bootstrap-admin` | Public mutation: create first admin (empty pool only) |
| `admin-ops` | Admin CRUD, clear messages, `listUserDirectory` |
| `profile-sync` | `syncMyProfile` on login; repairs legacy participant ids |
| `message-alerts` | Optional SNS SMS when messages arrive |
| `attachment-url` | Presigned S3 GET after membership check |
| `pre-sign-up` | Auto-confirm new Cognito users |

---

## Auth & users (how it actually works)

1. **Empty pool** → app shows bootstrap form → creates first admin (Cognito `Admin` group + profile).
2. **Admin** creates users in the in-app **Admin panel** (Cognito `AdminCreateUser`, temporary password).
3. **User signs in** with username + password → may be forced to set a new password.
4. **`syncMyProfile`** runs → creates/updates `UserProfile` with `cognitoSub`, role, phone.
5. **New chat** uses `listUserDirectory` → pick another user → conversation `participants` store Cognito **subs**.

There is **no** forgot-password screen. Admins reset access via Cognito or re-create the user.

**MFA:** off in pool config.

---

## Sandbox vs Amplify Hosting (production)

| | Personal sandbox | Amplify Hosting |
| - | ---------------- | --------------- |
| Command | `npm run sandbox` | Git push → `amplify.yml` |
| URL | `localhost:5173` + cloud APIs | `https://main.<id>.amplifyapp.com` |
| Data | Your sandbox stack | **Separate** stack |
| Config | `amplify_outputs.json` locally | Generated during pipeline build |

Always bootstrap admin and re-create users on the **hosted URL** after first deploy. Local sandbox data does not migrate automatically.

---

## Testing with two users locally

| Method | Works? |
| ------ | ------ |
| Two **Incognito** windows | ✅ Separate sessions |
| Chrome + Firefox | ✅ |
| Two tabs, same normal window | ❌ One session shared |
| Same browser after sign-out | ✅ Sign out user 1 first |

If **New chat** is empty: confirm both users signed in on the **same environment** (sandbox URL vs production URL), both completed first login (`syncMyProfile`), and check the browser console for errors.

---

## Production hosting (GitHub → Amplify)

1. Push repo to GitHub (`main` branch).
2. Amplify Console → **Host web app** → connect repo.
3. Build uses `amplify.yml`:
   - Backend: `npx ampx pipeline-deploy`
   - Frontend: `npm run build` → `dist/`
4. Share the Amplify HTTPS URL.

### Git push from corporate networks

- **SSH to GitHub** often blocked (port 22 timeout) → use **HTTPS + PAT**.
- Remove bad proxy settings if git fails:
  ```bash
  git config --global --unset http.proxy
  git config --global --unset https.proxy
  ```
- Credential helper: `git config --global credential.helper wincred` → username + PAT on push.

Amplify connects to GitHub via OAuth in the AWS Console (separate from your local git credentials).

---

## Two terminals (local dev)

| Command | Role |
| ------- | ---- |
| `npm run sandbox` | Deploy/watch backend; writes `amplify_outputs.json` |
| `npm run dev` | Vite frontend at http://localhost:5173 |

Both must run for full-stack local dev.

---

## DynamoDB access patterns

| Need | Pattern |
| ---- | ------- |
| My conversations | AppSync owner auth: `participants` contains my `sub` |
| Messages in thread | Query `Message` by `conversationId` GSI |
| User directory | `listUserDirectory` Lambda (lists `UserProfile` rows) |

No SQL JOINs — participant subs are denormalized onto each message for authorization.

---

## Local Docker vs LocalStack

| Component | LocalStack | Real AWS sandbox |
| --------- | ---------- | ---------------- |
| React UI | ✅ | ✅ |
| S3 / DynamoDB emulation | ✅ partial | ✅ |
| Cognito + AppSync chat | ❌ unreliable | ✅ required |

```bash
docker compose -f docker-compose.local.yml up   # UI + LocalStack (chat won't work)
npm run docker:dev                              # UI → real sandbox APIs
```

---

## Troubleshooting

### CDK bootstrap / `ssm:GetParameter` denied

```bash
npx aws-cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
npm run sandbox
```

Ensure IAM user has Amplify/CDK permissions.

### Signed in as a GUID instead of username

Production AppSync identity sometimes passes Cognito’s internal UUID instead of `preferred_username`. Fixed in `profile-sync` + `parseIdentity` — redeploy and **sign out/in** after push.

### `cognito-identity` 400 / `NoSignedUser` in console

Often Identity Pool credential fetch interfering with GraphQL. Client uses `authMode: 'userPool'` for data calls. Redeploy latest frontend; sign out/in.

### Directory empty in New chat

- Other user must exist in Cognito **and** have a `UserProfile` (admin create or at least one login).
- Other user must have signed in once before chat (`cognitoSub` required).
- You won't see yourself in the list (filtered out).

### Proxy errors on `git push`

`Failed to connect to proxy.yourcompany.com` → unset proxy (see Git section above).

---

## Credentials on Windows

| File | Contents |
| ---- | -------- |
| `%USERPROFILE%\.aws\credentials` | Access keys |
| `%USERPROFILE%\.aws\config` | Region, profiles |

`amplify_outputs.json` appears in the project root after a successful sandbox or pipeline deploy (contains public client ids and API key — not secret keys, but still environment-specific).

---

## npm audit note

Most audit noise is from **`@aws-amplify/backend-cli`** devDependencies (CDK tooling), not the browser bundle.

---

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — full service map, Mermaid diagrams, workflows
- [README.md](../README.md) — quick start, deploy, user management
