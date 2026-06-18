# AWS setup & architecture (for EKS veterans)

This project uses **AWS Amplify Gen 2**, which is closer to **Terraform/CDK +
managed SaaS APIs** than to **Kubernetes + containers**.

---

## Do I need an Amazon account?

**Yes**, for the full messenger (auth, real-time chat, file uploads).

1. Create a free AWS account: https://aws.amazon.com/free/
2. Sign in → **IAM** → **Users** → create a user (e.g. `dev-local`)
3. Attach policy **`AdministratorAccess-Amplify`** (or `PowerUserAccess` for tighter scope)
4. Create **Access keys** → choose **CLI**
5. Run `aws configure` and paste:

| Prompt | What to enter |
| ------ | ------------- |
| **AWS Access Key ID** | From step 4 (starts with `AKIA...`) |
| **AWS Secret Access Key** | From step 4 (shown once — save it) |
| **Default region name** | `us-east-1` (cheap, most services; or your preferred region) |
| **Default output format** | `json` |

You are **not** deploying Docker images to AWS for this app. Amplify provisions
managed services directly via **CloudFormation/CDK** when you run `npm run sandbox`.

---

## How this deploy compares to EKS

| EKS mental model | This project |
| ---------------- | ------------ |
| Deployment + pods | **No pods.** Static React files on **S3 + CloudFront** (via Amplify Hosting) |
| Ingress / ALB | **CloudFront** distribution (HTTPS, caching) |
| Service mesh / internal API | **AppSync** (GraphQL HTTP + WebSocket subscriptions) |
| Identity (OIDC) | **Cognito User Pool** (email login) |
| Postgres StatefulSet | **DynamoDB** tables (serverless, on-demand) |
| PVC / object storage | **S3** bucket for attachments |
| Lambda as microservice | **One Lambda** for attachment presigned URLs |
| `kubectl apply` | `ampx sandbox` or **Amplify Hosting CI** on git push |

**Deploy flow:**

```
Your TypeScript (amplify/*.ts)
        │
        ▼
  ampx sandbox / pipeline-deploy
        │
        ▼
  AWS CDK synthesizes CloudFormation
        │
        ├── Cognito User Pool
        ├── AppSync API + DynamoDB tables
        ├── S3 bucket + IAM policies
        └── Lambda functions
        │
        ▼
  amplify_outputs.json  ──►  React app connects at runtime
```

There is **no Kubernetes cluster** and **no container registry** unless you
choose to wrap the frontend in Docker yourself (optional nginx image).

---

## DynamoDB vs SQL (Postgres / MSSQL)

Think of DynamoDB as a **key-value / document store optimized for single-digit-ms
lookups by primary key**, not JOINs.

| SQL | DynamoDB |
| --- | -------- |
| Tables with relations | **Tables** with **partition key** (+ optional sort key) |
| `SELECT ... JOIN` | **Denormalize** or query via **GSI** (secondary index) |
| Schema migrations | AppSync/Amplify **schema** drives table shape |
| Transactions | Supported but used sparingly; design for access patterns |

This messenger uses Amplify’s GraphQL models (`Conversation`, `Message`,
`UserProfile`). Amplify creates the DynamoDB tables and resolvers for you.

Example access pattern:

- List my conversations → query where `participants` contains my email (owner auth)
- Messages in a thread → query by `conversationId` index

---

## Local Docker: what works and what does not

| Component | LocalStack (free) | Real AWS (sandbox) |
| --------- | ----------------- | ------------------ |
| React UI | ✅ `docker compose -f docker-compose.local.yml up` | ✅ |
| S3 | ✅ emulated | ✅ |
| DynamoDB | ✅ emulated | ✅ |
| Cognito login | ❌ not faithful enough for Amplify | ✅ |
| AppSync real-time | ❌ not in Community LocalStack | ✅ |

**Bottom line:** Docker runs the **UI** on your box. The **backend** for this
app is AWS-managed APIs. The cheapest path is a personal **`ampx sandbox`**
($0–few dollars/month).

### Commands

```bash
# UI + LocalStack (explore S3/DynamoDB only — chat won't work)
docker compose -f docker-compose.local.yml up

# UI only (needs sandbox already deployed to AWS)
npm run docker:dev

# UI + deploy sandbox to your AWS account
npm run docker:aws
```

---

## Production hosting

Connect the repo to **Amplify Hosting** (Git push → build → CloudFront URL).
See root `README.md` for step-by-step.

Quick path once sandbox works:

1. Push this repo to GitHub (or CodeCommit).
2. AWS Console → **Amplify** → **Create new app** → connect repo/branch `main`.
3. Amplify runs `ampx pipeline-deploy` + `npm run build` from `amplify.yml`.
4. You get a public HTTPS URL like `https://main.d1234abcd.amplifyapp.com` (DNS included).

Share that URL; users can install the PWA on phones.

---

## Two terminals (common confusion)

| Command | What it does | HTTP listener? |
| ------- | ------------ | -------------- |
| `npm run sandbox` | Deploys **backend** to AWS; watches `amplify/` for changes; writes `amplify_outputs.json` | **No** — stays running in the terminal, but no web UI |
| `npm run dev` | Runs **frontend** Vite dev server | **Yes** — http://localhost:5173 |

You need **both** running for local full-stack dev.

---

## Where `aws configure` stores credentials (Windows)

| File | Contents |
| ---- | -------- |
| `C:\Users\<You>\.aws\credentials` | Access key ID + secret |
| `C:\Users\<You>\.aws\config` | Default region, output format, named profiles |

Nothing from `aws configure` is stored inside the project folder (except
`amplify_outputs.json` **after** a successful sandbox deploy).

---

## Troubleshooting: `ssm:GetParameter` / CDK bootstrap error

If sandbox fails with:

```text
not authorized to perform: ssm:GetParameter on ... parameter/cdk-bootstrap/hnb659fds/version
```

**Cause:** Amplify Gen 2 uses AWS CDK. Your IAM user needs permission to read
CDK bootstrap metadata (and usually to bootstrap the account once).

**Fix:**

1. IAM → Users → **dev** → **Permissions** — confirm **`AdministratorAccess-Amplify`**
   is attached (not `AWSCodeCommitPowerUser` or other narrow policies).
2. Bootstrap CDK once in your account/region (same user, same region as `aws configure`):

   ```bash
   npx aws-cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
   ```

   Replace `YOUR_ACCOUNT_ID` with the number from `aws sts get-caller-identity`.

3. Retry:

   ```bash
   npm run sandbox
   ```

If bootstrap still fails, temporarily attach **`PowerUserAccess`**, bootstrap, deploy
sandbox, then tighten permissions later.

---

## Local debugging

**Frontend (React):**

- Terminal 2: `npm run dev` → http://localhost:5173
- Edit files under `src/` — Vite **hot reloads** in the browser automatically
- Use browser DevTools (F12); no remote debugger port required for normal UI work

**Backend (Amplify / CDK):**

- Terminal 1: `npm run sandbox` — edit files under `amplify/`; sandbox **redeploys**
  to AWS when you save (watch the sandbox terminal for progress)
- Lambda logs: `npm run sandbox -- --stream-function-logs`

There is no single “attach debugger to the whole app” port like a Java pod.
The backend runs as managed AWS services; the frontend is local static dev server
talking to cloud APIs via `amplify_outputs.json`.

**Docker:** `docker compose` bind-mounts the project folder (`.:/app`), so the
same hot-reload behavior applies inside the container on port 5173.

---

## npm audit note

Most remaining audit findings live in **`@aws-amplify/backend-cli`** (CDK deploy
tooling). They are **devDependencies** — not bundled into the browser PWA.
We apply `overrides` in `package.json` where safe; some nested Amplify/CDK
packages must wait for upstream releases.
