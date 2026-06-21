# Fluxy API

Personal finance REST API for tracking income and expense transactions by category.

Development follows **SSD (System-Driven Development)** — every change is driven by an approved
spec in [`specs/`](./specs/). See [CLAUDE.md](./CLAUDE.md) for the project rules.

## Tech Stack

| Tool | Notes |
|------|-------|
| Node.js | v22 (ESM) |
| TypeScript | strict, NodeNext |
| Fastify | v5 + `@fastify/aws-lambda` (serverless) |
| TypeBox | schema validation + OpenAPI generation |
| Vitest | unit + integration tests |
| ESLint | v10 (flat config) |

> Architecture, database (Aurora Serverless v2 + Data API) and deploy (AWS SAM) are specified in
> [`specs/0002-arquitetura-tecnica.md`](./specs/0002-arquitetura-tecnica.md).

## Getting started

```bash
npm install
cp .env.example .env   # optional: defaults work out of the box
npm run dev            # starts the API at http://localhost:3333 (docs at /docs)
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run the API locally with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint `src/` (must pass — see CLAUDE.md) |
| `npm test` | Run the test suite |
| `npm run deploy` | Build (esbuild) and deploy with AWS SAM |
| `npm run db:migrate:remote` | Apply migrations to Aurora via the Data API |

## Deploy (AWS SAM)

Serverless on AWS: Lambda (arm64) behind an HTTP API, talking to Aurora Serverless v2
(PostgreSQL) over the RDS **Data API** — the Lambda stays **outside the VPC**, so there is
**no NAT Gateway**. Region: `us-east-1`. Stages: `dev` (default) and `prod`.

**Prerequisites**

- AWS account with credentials configured (`aws sts get-caller-identity`), region `us-east-1`.
- Node 22 + `make` (Docker is **not** required — the native Argon2 binary is cross-installed
  for `linux/arm64` during the build).
- Secrets in **SSM Parameter Store** as `SecureString`, under `/fluxy/<stage>/` (CloudFormation
  cannot create SecureString parameters, so create them manually):

  ```bash
  aws ssm put-parameter --region us-east-1 --type SecureString \
    --name /fluxy/dev/jwt-secret --value "$(openssl rand -base64 48)"
  # optional — without it, e-mails are logged instead of sent:
  aws ssm put-parameter --region us-east-1 --type SecureString \
    --name /fluxy/dev/resend-api-key --value "<your-resend-key>"
  ```

**Deploy**

```bash
npm run deploy                 # first time: sam deploy --guided
# prod: sam build && sam deploy --config-env prod
```

**Apply migrations** (after the first deploy), using the stack outputs:

```bash
DB_CLUSTER_ARN=<ClusterArn output> \
DB_SECRET_ARN=<SecretArn output> \
DB_NAME=fluxy \
  npm run db:migrate:remote
```

The API base URL is the `ApiUrl` stack output. Notes:

- Before deploying **prod**, set `AppUrl` in `samconfig.toml` to your real web app origin — it
  becomes the CORS allow-list in deployed stages.
- Aurora scales to **zero** when idle, so the first request after a pause takes ~15s to resume.
- Adjust `EngineVersion` in `template.yaml` to a currently available Aurora PostgreSQL ≥ 16.3 if
  the deploy reports it unavailable.

## Project structure

```
src/
  app.ts            # buildApp(): Fastify instance (plugins + routes)
  server.ts         # local dev entry point
  lambda.ts         # AWS Lambda handler (adapter)
  shared/
    config/env.ts   # environment validation
    errors.ts       # AppError + helpers
    plugins/        # security, swagger, error-handler
specs/              # source-of-truth specifications (SSD)
```

## Endpoints (foundation)

- `GET /health` — liveness probe
- `GET /docs` — Swagger UI (OpenAPI)
