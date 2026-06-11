# Fluxy API

Personal finance REST API for managing income and outcome transactions.

## Tech Stack

| Tool | Version |
|------|---------|
| Node.js | v24.13 |
| npm | package manager |
| TypeScript | v6 |
| Fastify | v5 |
| Drizzle ORM | v0.45 |
| Supabase | auth + PostgreSQL |
| ESLint | v10 |

## Prerequisites

- Node.js v24.13+
- A [Supabase](https://supabase.com) project (free tier works)

## Setup

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
```

Fill in your Supabase credentials in `.env`:
```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
```

**3. Run database migrations**
```bash
npm run db:generate
npm run db:migrate
```

**4. Start the dev server**
```bash
npm run dev
```

Server starts at `http://localhost:3000`.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output |
| `npm run lint` | Run ESLint across `src/` |
| `npm run db:generate` | Generate Drizzle migrations from schema |
| `npm run db:migrate` | Apply pending migrations to the database |

## API

The full contract is defined in [`spec/openapi.yaml`](spec/openapi.yaml). Import it into Postman or Insomnia to explore and test all endpoints.

### Auth

Social login only (native ID token flow). Send the provider `id_token` and receive
Supabase session tokens. See [`spec/social-login.md`](spec/social-login.md).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/google` | — | Exchange a Google `id_token` for `access_token` + `refresh_token` |
| POST | `/auth/apple` | — | Exchange an Apple `id_token` for `access_token` + `refresh_token` |

### Transactions

All endpoints require `Authorization: Bearer <access_token>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/transactions` | List transactions (`?type=income&category=Food`) |
| POST | `/transactions` | Create a transaction |
| PUT | `/transactions/:id` | Update a transaction |
| DELETE | `/transactions/:id` | Delete a transaction |

### Summary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/summary/balance` | Net balance (total income − total outcome) |
| GET | `/summary/by-category` | Totals grouped by category and type |

### Transaction fields

| Field | Type | Rules |
|-------|------|-------|
| `title` | string | Required, non-empty |
| `value` | decimal | Required, must be > 0 |
| `type` | enum | `income` or `outcome` |
| `category` | enum | `Bills`, `Health`, `Gym`, `Subscriptions`, `Food`, `Entertainment`, `Transport`, `Salary` |

> `income` transactions must use the `Salary` category; `Salary` cannot be used with `outcome`.

## Project Structure

```
src/
  modules/
    auth/           # Social login (Google, Apple)
    transactions/   # CRUD + filtering
    summary/        # Balance and category aggregations
  shared/
    database/       # Drizzle client and schema
    errors/         # AppError class and Fastify error handler
    middlewares/    # Supabase JWT authentication hook
    types/          # FastifyRequest type augmentation
  app.ts            # Fastify instance and plugin registration
  server.ts         # Entry point
spec/
  openapi.yaml      # API contract (written before implementation)
```

## Development Principles

- **SDD** — the OpenAPI spec is written first and drives implementation
- **SOLID** — each layer has a single responsibility; services depend on repository interfaces, not concrete classes
