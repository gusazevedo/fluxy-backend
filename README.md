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

> Architecture, database (Neon — serverless PostgreSQL) and deploy (AWS SAM) are specified in
> [`specs/0002-arquitetura-tecnica.md`](./specs/0002-arquitetura-tecnica.md).

## Getting started

The local environment needs a **Postgres database** (Docker) with migrations applied, plus the
API server. The `dev:up` script orchestrates all of it in one command:

```bash
npm install
cp .env.example .env   # optional: defaults work out of the box
npm run dev:up         # starts Postgres (Docker), applies migrations, then runs the API
```

`dev:up` is equivalent to running, in order:

```bash
npm run db:up          # docker compose up -d --wait  (Postgres on localhost:5432)
npm run db:migrate     # apply migrations to the local DB
npm run dev            # starts the API at http://localhost:3333 (docs at /docs)
```

Once the database is up, on later sessions you can just run `npm run dev`. Stop the database
with `npm run db:down`.

> Requires **Docker**. If the daemon isn't running, `db:up` starts it automatically (Docker
> Desktop on macOS) and waits until it's ready. Without a `RESEND_API_KEY` in `.env`, e-mails
> are logged to the console instead of being sent — no extra setup needed for dev.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev:up` | One-shot local env: start Postgres (Docker), migrate, then run the API |
| `npm run dev` | Run the API locally with hot reload (assumes the DB is already up) |
| `npm run db:up` | Start the local Postgres container and wait until it's healthy |
| `npm run db:down` | Stop the local Postgres container |
| `npm run db:migrate` | Apply migrations to the local DB |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint `src/` (must pass — see CLAUDE.md) |
| `npm test` | Run the test suite |
| `npm run deploy` | Build (esbuild) and deploy with AWS SAM |
| `npm run db:migrate:remote` | Apply migrations to Neon (set `DATABASE_URL` to the direct string) |

## Deploy (AWS SAM)

Serverless on AWS: Lambda (arm64) behind an HTTP API, talking to **Neon** (serverless
PostgreSQL) over the Neon **HTTP driver** — the Lambda stays **outside any VPC**, so there is
**no NAT Gateway, RDS or VPC**. Region: `us-east-1`. Stages: `dev` (default) and `prod`.

See **[`DEPLOY.md`](./DEPLOY.md)** for the full step-by-step (AWS account, Neon project, secrets).

**Prerequisites**

- AWS account with credentials configured (`aws sts get-caller-identity`), region `us-east-1`.
- A **Neon** project (region *AWS / US East — N. Virginia*); grab its pooled and direct
  connection strings.
- Node 22 + `make` (Docker is **not** required — the native Argon2 binary is cross-installed
  for `linux/arm64` during the build).
- Secrets in **SSM Parameter Store** as `SecureString`, under `/fluxy/<stage>/` (CloudFormation
  cannot create SecureString parameters, so create them manually):

  ```bash
  # Neon connection string (POOLED):
  aws ssm put-parameter --region us-east-1 --type SecureString \
    --name /fluxy/dev/database-url --value "postgresql://...-pooler.../fluxy?sslmode=require"
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

**Apply migrations** (after the first deploy), using the Neon **direct (unpooled)** string:

```bash
DATABASE_URL="postgresql://...HOST.../fluxy?sslmode=require" \
  npm run db:migrate:remote
```

The API base URL is the `ApiUrl` stack output. Notes:

- Before deploying **prod**, set `AppUrl` in `samconfig.toml` to your real web app origin — it
  becomes the CORS allow-list in deployed stages.
- Neon scales to **zero** when idle, so the first request after a pause takes a few seconds to resume.

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
