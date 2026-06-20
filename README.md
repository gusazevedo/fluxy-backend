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
> [`specs/0002-arquitetura-tecnica.md`](./specs/0002-arquitetura-tecnica.md) and added in later phases.

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
