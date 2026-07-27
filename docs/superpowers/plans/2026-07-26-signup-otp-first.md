# Cadastro com E-mail Primeiro — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o cadastro atual (`register` → `verify-email`) por um fluxo de três etapas que começa pelo e-mail: `signup/start` envia um OTP, `signup/verify` devolve um signup token e `signup/complete` cria a conta já verificada e logada.

**Architecture:** Um módulo novo (`signup.*`) dentro de `src/modules/auth/`, espelhando a separação já usada no projeto: repositório → serviço → schema TypeBox → rotas. O estado do cadastro pendente vive numa tabela nova `signup_verifications`, e a conta só é criada na terceira etapa, por um **único comando SQL com CTEs** (o driver HTTP do Neon não suporta transação — ver D14 da spec). Os endpoints antigos são removidos no fim, quando os novos já estiverem verdes.

**Tech Stack:** TypeScript ESM, Fastify v5, TypeBox, Drizzle ORM, Postgres (postgres.js local / neon-http nos stages / pglite nos testes), Vitest, Argon2id via `@node-rs/argon2`.

## Global Constraints

- **Spec é a fonte da verdade:** `specs/0003-autenticacao-e-contas.md` v2.0. Nada fora do escopo dela. Dúvida ⇒ perguntar, não assumir (CLAUDE.md §1).
- **Testes obrigatórios:** toda tarefa entrega testes unitários e/ou de integração passando (CLAUDE.md §2).
- **Lint sem exceções:** `npm run lint` limpo. Não desabilitar regra alguma sem aprovação (CLAUDE.md §3).
- **Sem transação:** nunca usar `db.transaction()` — `drizzle-orm/neon-http` lança `"No transactions support in neon-http driver"`. Atomicidade só via comando único (D14).
- **Sem dependência nova.** O plano inteiro usa o que já está no `package.json`.
- **Defaults de configuração** (spec §6): `SIGNUP_TOKEN_TTL_MINUTES=15`, `SIGNUP_MAX_SENDS_PER_DAY=10`, `SIGNUP_MAX_FAILURES_PER_DAY=20`, `VERIFY_OTP_TTL_MINUTES=5`, `VERIFY_OTP_MAX_ATTEMPTS=5`, `VERIFY_OTP_RESEND_COOLDOWN_SECONDS=60`.
- **Respostas genéricas:** `signup/start` responde sempre `202` com a mesma mensagem (RNF-3). Nunca variar status, corpo ou tempo entre "e-mail livre" e "e-mail já é conta".
- **Comentários e nomes de código em inglês**, como o restante de `src/`. Mensagens de commit em português, no padrão `tipo(escopo): descrição`.

## Estrutura de Arquivos

**Criar:**
- `src/modules/auth/signup.repository.ts` — acesso a `signup_verifications` e o comando CTE que cria a conta.
- `src/modules/auth/signup.service.ts` — regras das três etapas (cooldown, tetos da RN-8, tentativas, tokens).
- `src/modules/auth/signup.schema.ts` — schemas TypeBox de corpo e resposta.
- `src/modules/auth/signup.routes.ts` — plugin Fastify com os três endpoints.
- `src/modules/auth/signup.service.test.ts` — unitários do serviço, com repositório e e-mail falsos.
- `src/modules/auth/signup.test.ts` — integração das três rotas contra pglite.
- `drizzle/0006_signup_verifications.sql` (+ snapshot) — gerado pelo Drizzle Kit.

**Modificar:**
- `src/shared/database/schema.ts` — tabela `signupVerifications` e seus tipos.
- `src/shared/config/env.ts` — três variáveis novas.
- `.env.example` — documentar as três.
- `src/email/resend.ts` — `sendVerificationEmail(to, code)`, sem `firstName`.
- `src/app.ts` — registrar `signupRoutes`.
- `src/modules/auth/auth.service.ts` — remover `register`, `verifyEmail`, `resendVerification`.
- `src/modules/auth/auth.routes.ts` — remover as três rotas antigas.
- `src/modules/auth/auth.repository.ts` — remover os métodos que só serviam a `email_verify`.
- `src/modules/auth/auth.schema.ts` — remover `RegisterBody`, `VerifyEmailBody`, `ResendVerificationBody`.
- `src/modules/auth/auth.test.ts` — usar o fluxo novo.
- `src/test/helpers.ts` — `authenticate()` pelo fluxo novo.

**Por que arquivos separados:** `auth.service.ts` já tem 232 linhas e `auth.routes.ts` 134. Enfiar as três etapas ali dobraria os dois. Cadastro e sessão são responsabilidades distintas e mudam por motivos distintos.

---

### Task 1: Tabela, migration e configuração

**Files:**
- Modify: `src/shared/database/schema.ts:9` (enum) e final do bloco de auth
- Modify: `src/shared/config/env.ts:31-38`
- Modify: `.env.example`
- Create: `drizzle/0006_signup_verifications.sql` (gerado)
- Test: `src/modules/auth/signup.repository.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: tabela `signupVerifications` e os tipos `SignupVerification` / `NewSignupVerification`; envs `SIGNUP_TOKEN_TTL_MINUTES`, `SIGNUP_MAX_SENDS_PER_DAY`, `SIGNUP_MAX_FAILURES_PER_DAY`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/modules/auth/signup.repository.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../test/helpers.js'
import { signupVerifications } from '../../shared/database/schema.js'

describe('signup_verifications table', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await createTestDb()
  })

  afterAll(async () => {
    await testDb.close()
  })

  it('stores a pending signup with the RN-8 counters defaulted', async () => {
    const now = new Date()
    const rows = await testDb.db
      .insert(signupVerifications)
      .values({
        email: 'pending@example.com',
        otpHash: 'hash',
        expiresAt: new Date(now.getTime() + 60_000),
        lastSentAt: now,
      })
      .returning()

    expect(rows[0].attempts).toBe(0)
    expect(rows[0].sendsInWindow).toBe(0)
    expect(rows[0].failuresInWindow).toBe(0)
    expect(rows[0].verifiedAt).toBeNull()
    expect(rows[0].signupTokenHash).toBeNull()
  })

  it('rejects two pending signups for the same e-mail', async () => {
    const values = {
      email: 'dup@example.com',
      otpHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      lastSentAt: new Date(),
    }
    await testDb.db.insert(signupVerifications).values(values)

    await expect(testDb.db.insert(signupVerifications).values(values)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run src/modules/auth/signup.repository.test.ts`
Expected: FAIL — `signupVerifications` não é exportado por `schema.ts`.

- [ ] **Step 3: Adicionar a tabela ao schema**

Em `src/shared/database/schema.ts`, logo após o bloco de `authTokens` (antes da linha `export type User = ...`):

```ts
/**
 * Signup in progress (0003 v2.0 §4). The account only exists once
 * `signup/complete` runs, so this row — not `users` — carries the state
 * between the three steps. One row per e-mail: restarting a signup updates it.
 */
export const signupVerifications = pgTable(
  'signup_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Stored lowercased, like users.email.
    email: text('email').notNull(),
    otpHash: text('otp_hash').notNull(),
    // Wrong attempts against the CURRENT code; reset when a new code is sent.
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Base for the resend cooldown; updatedAt would drift on failed attempts.
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    signupTokenHash: text('signup_token_hash'),
    signupTokenExpiresAt: timestamp('signup_token_expires_at', { withTimezone: true }),
    // Per-email 24h caps (RN-8). Restarting a signup does NOT reset these —
    // otherwise the per-code `attempts` limit would be trivially bypassable.
    sendsInWindow: integer('sends_in_window').notNull().default(0),
    failuresInWindow: integer('failures_in_window').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('signup_verifications_email_unique').on(t.email),
    // Nullable: Postgres allows many NULLs in a unique index, so pending rows
    // without a token don't collide.
    uniqueIndex('signup_verifications_token_hash_unique').on(t.signupTokenHash),
  ],
)

export type SignupVerification = typeof signupVerifications.$inferSelect
export type NewSignupVerification = typeof signupVerifications.$inferInsert
```

- [ ] **Step 4: Gerar a migration**

Run: `npx drizzle-kit generate --name signup_verifications`
Expected: cria `drizzle/0006_signup_verifications.sql` e `drizzle/meta/0006_snapshot.json`, e acrescenta a entrada `0006_signup_verifications` ao `_journal.json`.

Abrir o `.sql` gerado e **acrescentar ao final** a limpeza das linhas órfãs de verificação de e-mail (spec §4, nota de `auth_tokens`):

```sql
--> statement-breakpoint
DELETE FROM "auth_tokens" WHERE "type" = 'email_verify';
```

Não remover o valor `email_verify` do enum — a spec decidiu mantê-lo por custo de migration.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run src/modules/auth/signup.repository.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 6: Adicionar as variáveis de ambiente**

Em `src/shared/config/env.ts`, dentro do bloco `--- Auth / tokens ---`, logo após `VERIFY_OTP_RESEND_COOLDOWN_SECONDS`:

```ts
  // Signup token issued by /auth/signup/verify (0003 §6).
  SIGNUP_TOKEN_TTL_MINUTES: Type.Number({ default: 15 }),
  // Per-email caps over a rolling 24h window (0003 RN-8).
  SIGNUP_MAX_SENDS_PER_DAY: Type.Number({ default: 10 }),
  SIGNUP_MAX_FAILURES_PER_DAY: Type.Number({ default: 20 }),
```

Em `.env.example`, junto das demais variáveis de auth:

```
# Signup (0003 §6) — signup token TTL and per-email 24h caps
SIGNUP_TOKEN_TTL_MINUTES=15
SIGNUP_MAX_SENDS_PER_DAY=10
SIGNUP_MAX_FAILURES_PER_DAY=20
```

- [ ] **Step 7: Verificar tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/shared/database/schema.ts src/shared/config/env.ts .env.example drizzle src/modules/auth/signup.repository.test.ts
git commit -m "feat(signup): adiciona a tabela signup_verifications e a configuracao do cadastro"
```

---

### Task 2: Repositório do cadastro

**Files:**
- Create: `src/modules/auth/signup.repository.ts`
- Modify: `src/modules/auth/signup.repository.test.ts` (criado na Task 1)

**Interfaces:**
- Consumes: `signupVerifications` e `SignupVerification` de `schema.ts`; `Database` de `shared/database/client.ts`; `DEFAULT_CATEGORIES` de `modules/categories/category.defaults.ts`.
- Produces:

```ts
export interface StartInput {
  email: string
  otpHash: string
  expiresAt: Date
  now: Date
  sendsInWindow: number
  failuresInWindow: number
  windowStartedAt: Date
}

export interface CompleteInput {
  signupTokenHash: string
  firstName: string
  lastName: string
  passwordHash: string
  now: Date
  categories: { name: string; kind: TransactionKind }[]
}

export interface SignupRepository {
  findByEmail(email: string): Promise<SignupVerification | undefined>
  findByTokenHash(tokenHash: string): Promise<SignupVerification | undefined>
  upsertStart(input: StartInput): Promise<void>
  incrementFailure(id: string): Promise<void>
  markVerified(id: string, tokenHash: string, tokenExpiresAt: Date): Promise<void>
  completeSignup(input: CompleteInput): Promise<string | undefined>
}

export function createSignupRepository(db: Database): SignupRepository
```

`completeSignup` devolve o `id` do usuário criado, ou `undefined` se o token não casou (inexistente, não verificado ou vencido).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `src/modules/auth/signup.repository.test.ts` (mantendo os dois testes da Task 1 e trocando o `beforeAll` para também criar o repositório):

```ts
import { createSignupRepository, type SignupRepository } from './signup.repository.js'
import { DEFAULT_CATEGORIES } from '../categories/category.defaults.js'
import { categories, users } from '../../shared/database/schema.js'
import { eq } from 'drizzle-orm'

describe('SignupRepository', () => {
  let testDb: TestDb
  let repo: SignupRepository

  beforeAll(async () => {
    testDb = await createTestDb()
    repo = createSignupRepository(testDb.db)
  })

  afterAll(async () => {
    await testDb.close()
  })

  const minutes = (n: number): Date => new Date(Date.now() + n * 60_000)

  async function startAndVerify(email: string, tokenHash: string): Promise<void> {
    const now = new Date()
    await repo.upsertStart({
      email,
      otpHash: 'otp-hash',
      expiresAt: minutes(5),
      now,
      sendsInWindow: 1,
      failuresInWindow: 0,
      windowStartedAt: now,
    })
    const row = await repo.findByEmail(email)
    await repo.markVerified(row!.id, tokenHash, minutes(15))
  }

  it('upsertStart replaces the code and clears a previous verification', async () => {
    await startAndVerify('restart@example.com', 'old-token-hash')
    const now = new Date()

    await repo.upsertStart({
      email: 'restart@example.com',
      otpHash: 'new-otp-hash',
      expiresAt: minutes(5),
      now,
      sendsInWindow: 2,
      failuresInWindow: 0,
      windowStartedAt: now,
    })

    const row = await repo.findByEmail('restart@example.com')
    expect(row?.otpHash).toBe('new-otp-hash')
    expect(row?.attempts).toBe(0)
    expect(row?.verifiedAt).toBeNull()
    expect(row?.signupTokenHash).toBeNull()
    expect(row?.sendsInWindow).toBe(2)
    // The old signup token must no longer resolve (spec §4, CA-11).
    expect(await repo.findByTokenHash('old-token-hash')).toBeUndefined()
  })

  it('incrementFailure bumps both the per-code and the per-window counter', async () => {
    const now = new Date()
    await repo.upsertStart({
      email: 'fail@example.com',
      otpHash: 'otp-hash',
      expiresAt: minutes(5),
      now,
      sendsInWindow: 1,
      failuresInWindow: 3,
      windowStartedAt: now,
    })
    const row = await repo.findByEmail('fail@example.com')

    await repo.incrementFailure(row!.id)

    const after = await repo.findByEmail('fail@example.com')
    expect(after?.attempts).toBe(1)
    expect(after?.failuresInWindow).toBe(4)
  })

  it('completeSignup creates the user with the default categories and drops the row', async () => {
    await startAndVerify('done@example.com', 'good-token-hash')

    const userId = await repo.completeSignup({
      signupTokenHash: 'good-token-hash',
      firstName: 'Ana',
      lastName: 'Silva',
      passwordHash: 'argon-hash',
      now: new Date(),
      categories: DEFAULT_CATEGORIES,
    })

    expect(userId).toBeTypeOf('string')
    const user = await testDb.db.select().from(users).where(eq(users.id, userId!))
    expect(user[0].email).toBe('done@example.com')
    expect(user[0].firstName).toBe('Ana')
    expect(user[0].emailVerified).toBe(true)

    const seeded = await testDb.db.select().from(categories).where(eq(categories.userId, userId!))
    expect(seeded).toHaveLength(DEFAULT_CATEGORIES.length)

    // The token is consumed by deleting the row (spec §4, "Retenção").
    expect(await repo.findByTokenHash('good-token-hash')).toBeUndefined()
    expect(await repo.findByEmail('done@example.com')).toBeUndefined()
  })

  it('completeSignup writes nothing when the token is unknown', async () => {
    const before = await testDb.db.select().from(users)

    const userId = await repo.completeSignup({
      signupTokenHash: 'no-such-token',
      firstName: 'Ana',
      lastName: 'Silva',
      passwordHash: 'argon-hash',
      now: new Date(),
      categories: DEFAULT_CATEGORIES,
    })

    expect(userId).toBeUndefined()
    expect(await testDb.db.select().from(users)).toHaveLength(before.length)
  })

  it('completeSignup writes nothing when the signup token expired', async () => {
    const now = new Date()
    await repo.upsertStart({
      email: 'expired@example.com',
      otpHash: 'otp-hash',
      expiresAt: minutes(5),
      now,
      sendsInWindow: 1,
      failuresInWindow: 0,
      windowStartedAt: now,
    })
    const row = await repo.findByEmail('expired@example.com')
    await repo.markVerified(row!.id, 'expired-token-hash', minutes(-1))

    const userId = await repo.completeSignup({
      signupTokenHash: 'expired-token-hash',
      firstName: 'Ana',
      lastName: 'Silva',
      passwordHash: 'argon-hash',
      now: new Date(),
      categories: DEFAULT_CATEGORIES,
    })

    expect(userId).toBeUndefined()
    // The row survives, so the service can still tell EXPIRED from INVALID.
    expect(await repo.findByTokenHash('expired-token-hash')).toBeDefined()
  })

  it('completeSignup writes nothing when the OTP was never verified', async () => {
    const now = new Date()
    await repo.upsertStart({
      email: 'unverified@example.com',
      otpHash: 'otp-hash',
      expiresAt: minutes(5),
      now,
      sendsInWindow: 1,
      failuresInWindow: 0,
      windowStartedAt: now,
    })

    const userId = await repo.completeSignup({
      signupTokenHash: 'otp-hash',
      firstName: 'Ana',
      lastName: 'Silva',
      passwordHash: 'argon-hash',
      now: new Date(),
      categories: DEFAULT_CATEGORIES,
    })

    expect(userId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/modules/auth/signup.repository.test.ts`
Expected: FAIL — `./signup.repository.js` não existe.

- [ ] **Step 3: Implementar o repositório**

Criar `src/modules/auth/signup.repository.ts`:

```ts
import { eq, sql } from 'drizzle-orm'
import type { Database } from '../../shared/database/client.js'
import {
  type SignupVerification,
  signupVerifications,
  type TransactionKind,
} from '../../shared/database/schema.js'

export interface StartInput {
  email: string
  otpHash: string
  expiresAt: Date
  now: Date
  sendsInWindow: number
  failuresInWindow: number
  windowStartedAt: Date
}

export interface CompleteInput {
  signupTokenHash: string
  firstName: string
  lastName: string
  passwordHash: string
  now: Date
  categories: { name: string; kind: TransactionKind }[]
}

export interface SignupRepository {
  findByEmail(email: string): Promise<SignupVerification | undefined>
  findByTokenHash(tokenHash: string): Promise<SignupVerification | undefined>
  upsertStart(input: StartInput): Promise<void>
  incrementFailure(id: string): Promise<void>
  markVerified(id: string, tokenHash: string, tokenExpiresAt: Date): Promise<void>
  /** Returns the new user's id, or undefined when the token doesn't match. */
  completeSignup(input: CompleteInput): Promise<string | undefined>
}

/**
 * `db.execute` returns the raw driver result, whose shape differs per driver:
 * postgres.js yields an array, neon-http and pglite yield `{ rows }`. Normalize
 * so the repository behaves the same in tests, local dev and deployed stages.
 */
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  return ((result as { rows?: T[] }).rows ?? []) as T[]
}

export function createSignupRepository(db: Database): SignupRepository {
  return {
    async findByEmail(email): Promise<SignupVerification | undefined> {
      const rows = await db
        .select()
        .from(signupVerifications)
        .where(eq(signupVerifications.email, email))
        .limit(1)
      return rows[0]
    },

    async findByTokenHash(tokenHash): Promise<SignupVerification | undefined> {
      const rows = await db
        .select()
        .from(signupVerifications)
        .where(eq(signupVerifications.signupTokenHash, tokenHash))
        .limit(1)
      return rows[0]
    },

    async upsertStart(input): Promise<void> {
      // Restarting clears the verification and the previous signup token, so a
      // token handed out before the restart stops working (spec §4).
      const fresh = {
        otpHash: input.otpHash,
        attempts: 0,
        expiresAt: input.expiresAt,
        lastSentAt: input.now,
        verifiedAt: null,
        signupTokenHash: null,
        signupTokenExpiresAt: null,
        sendsInWindow: input.sendsInWindow,
        failuresInWindow: input.failuresInWindow,
        windowStartedAt: input.windowStartedAt,
        updatedAt: input.now,
      }
      await db
        .insert(signupVerifications)
        .values({ email: input.email, ...fresh })
        .onConflictDoUpdate({ target: signupVerifications.email, set: fresh })
    },

    async incrementFailure(id): Promise<void> {
      await db
        .update(signupVerifications)
        .set({
          attempts: sql`${signupVerifications.attempts} + 1`,
          failuresInWindow: sql`${signupVerifications.failuresInWindow} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(signupVerifications.id, id))
    },

    async markVerified(id, tokenHash, tokenExpiresAt): Promise<void> {
      await db
        .update(signupVerifications)
        .set({
          verifiedAt: new Date(),
          signupTokenHash: tokenHash,
          signupTokenExpiresAt: tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(signupVerifications.id, id))
    },

    async completeSignup(input): Promise<string | undefined> {
      // One statement, because it must be atomic on every driver and the Neon
      // HTTP driver has no transactions (spec D14). Consuming the token IS
      // deleting the row, which Postgres serializes: of two concurrent calls
      // with the same token, exactly one deletes and the other gets nothing.
      const names = input.categories.map((c) => c.name)
      const kinds = input.categories.map((c) => c.kind)

      const result = await db.execute(sql`
        WITH consumed AS (
          DELETE FROM signup_verifications
           WHERE signup_token_hash = ${input.signupTokenHash}
             AND verified_at IS NOT NULL
             AND signup_token_expires_at > ${input.now}
          RETURNING email
        ), new_user AS (
          INSERT INTO users (email, first_name, last_name, password_hash, email_verified)
          SELECT email, ${input.firstName}, ${input.lastName}, ${input.passwordHash}, true
            FROM consumed
          RETURNING id
        ), seeded AS (
          INSERT INTO categories (user_id, name, kind)
          SELECT new_user.id, c.name, c.kind::transaction_kind
            FROM new_user,
                 unnest(${names}::text[], ${kinds}::text[]) AS c(name, kind)
          RETURNING user_id
        )
        SELECT id FROM new_user
      `)

      return toRows<{ id: string }>(result)[0]?.id
    },
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/modules/auth/signup.repository.test.ts`
Expected: PASS (8 testes).

Se `unnest(...::text[])` falhar no pglite com erro de tipo de parâmetro, trocar os dois parâmetros por `${sql.param(names)}` — não trocar a estratégia de CTE sem consultar o desenvolvedor (CLAUDE.md §1).

- [ ] **Step 5: Lint e tipos**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/signup.repository.ts src/modules/auth/signup.repository.test.ts
git commit -m "feat(signup): adiciona o repositorio do cadastro com criacao atomica da conta"
```

---

### Task 3: Serviço — etapa 1 (`start`)

**Files:**
- Create: `src/modules/auth/signup.service.ts`
- Create: `src/modules/auth/signup.service.test.ts`
- Modify: `src/email/resend.ts:6,27,38` e o template `verificationHtml`

**Interfaces:**
- Consumes: `SignupRepository` (Task 2); `AuthRepository.findUserByEmail`; `generateOtp`, `hashToken` de `shared/crypto.js`; `EmailService`.
- Produces:

```ts
export interface SignupServiceDeps {
  repo: SignupRepository
  users: Pick<AuthRepository, 'findUserByEmail'>
  email: EmailService
  /** Runs the e-mail send off the response path (spec D13). */
  dispatch: (task: () => Promise<void>) => void
  signAccessToken: (userId: string) => string
  createRefreshToken: (userId: string, tokenHash: string, expiresAt: Date) => Promise<void>
}

export interface SignupService {
  start(email: string): Promise<{ message: string }>
  verify(input: { email: string; code: string }): Promise<{ signupToken: string; expiresInSeconds: number }>
  complete(input: CompleteSignupInput): Promise<TokenPair>
}

export function createSignupService(deps: SignupServiceDeps): SignupService
```

`TokenPair` é o já exportado por `auth.service.ts`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/modules/auth/signup.service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hashToken } from '../../shared/crypto.js'
import type { SignupVerification } from '../../shared/database/schema.js'
import { createSignupService, type SignupService } from './signup.service.js'
import type { SignupRepository, StartInput } from './signup.repository.js'

interface Harness {
  service: SignupService
  rows: Map<string, SignupVerification>
  sent: { to: string; code: string }[]
  knownUsers: Set<string>
}

function makeRow(email: string, overrides: Partial<SignupVerification> = {}): SignupVerification {
  const now = new Date()
  return {
    id: `id-${email}`,
    email,
    otpHash: hashToken('123456'),
    attempts: 0,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    lastSentAt: now,
    verifiedAt: null,
    signupTokenHash: null,
    signupTokenExpiresAt: null,
    sendsInWindow: 1,
    failuresInWindow: 0,
    windowStartedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createHarness(): Harness {
  const rows = new Map<string, SignupVerification>()
  const sent: { to: string; code: string }[] = []
  const knownUsers = new Set<string>()

  const repo: SignupRepository = {
    async findByEmail(email) {
      return rows.get(email)
    },
    async findByTokenHash(tokenHash) {
      return [...rows.values()].find((r) => r.signupTokenHash === tokenHash)
    },
    async upsertStart(input: StartInput) {
      rows.set(
        input.email,
        makeRow(input.email, {
          otpHash: input.otpHash,
          expiresAt: input.expiresAt,
          lastSentAt: input.now,
          sendsInWindow: input.sendsInWindow,
          failuresInWindow: input.failuresInWindow,
          windowStartedAt: input.windowStartedAt,
        }),
      )
    },
    async incrementFailure(id) {
      for (const row of rows.values()) {
        if (row.id === id) {
          row.attempts += 1
          row.failuresInWindow += 1
        }
      }
    },
    async markVerified(id, tokenHash, tokenExpiresAt) {
      for (const row of rows.values()) {
        if (row.id === id) {
          row.verifiedAt = new Date()
          row.signupTokenHash = tokenHash
          row.signupTokenExpiresAt = tokenExpiresAt
        }
      }
    },
    async completeSignup(input) {
      const row = [...rows.values()].find(
        (r) =>
          r.signupTokenHash === input.signupTokenHash &&
          r.verifiedAt !== null &&
          (r.signupTokenExpiresAt?.getTime() ?? 0) > input.now.getTime(),
      )
      if (!row) return undefined
      rows.delete(row.email)
      return `user-${row.email}`
    },
  }

  const service = createSignupService({
    repo,
    users: {
      async findUserByEmail(email) {
        return knownUsers.has(email) ? ({ id: `user-${email}` } as never) : undefined
      },
    },
    email: {
      async sendVerificationEmail(to, code) {
        sent.push({ to, code })
      },
      async sendPasswordResetEmail() {},
    },
    // Unit tests run the send inline so assertions don't race the dispatch.
    dispatch: (task) => {
      void task()
    },
    signAccessToken: (userId) => `access-${userId}`,
    createRefreshToken: async () => {},
  })

  return { service, rows, sent, knownUsers }
}

describe('SignupService.start', () => {
  it('sends a 6-digit code for an e-mail that is free', async () => {
    const h = createHarness()

    const res = await h.service.start('New@Example.com ')

    expect(res.message).toContain('If the e-mail is valid')
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].to).toBe('new@example.com')
    expect(h.sent[0].code).toMatch(/^[0-9]{6}$/)
    // The raw code is never stored.
    expect(h.rows.get('new@example.com')?.otpHash).toBe(hashToken(h.sent[0].code))
  })

  it('says exactly the same thing and sends nothing when the e-mail is an account', async () => {
    const h = createHarness()
    h.knownUsers.add('taken@example.com')

    const res = await h.service.start('taken@example.com')

    expect(res.message).toContain('If the e-mail is valid')
    expect(h.sent).toHaveLength(0)
    expect(h.rows.has('taken@example.com')).toBe(false)
  })

  it('skips the send while inside the resend cooldown', async () => {
    const h = createHarness()
    await h.service.start('cool@example.com')

    await h.service.start('cool@example.com')

    expect(h.sent).toHaveLength(1)
  })

  it('sends again once the cooldown has passed, keeping the window counters', async () => {
    const h = createHarness()
    await h.service.start('again@example.com')
    const row = h.rows.get('again@example.com')!
    row.lastSentAt = new Date(Date.now() - 120_000)

    await h.service.start('again@example.com')

    expect(h.sent).toHaveLength(2)
    expect(h.rows.get('again@example.com')?.sendsInWindow).toBe(2)
  })

  it('stops sending once the daily send cap is reached (RN-8)', async () => {
    const h = createHarness()
    await h.service.start('capped@example.com')
    const row = h.rows.get('capped@example.com')!
    row.sendsInWindow = 10
    row.lastSentAt = new Date(Date.now() - 120_000)

    const res = await h.service.start('capped@example.com')

    expect(res.message).toContain('If the e-mail is valid')
    expect(h.sent).toHaveLength(1)
  })

  it('resets the window counters after 24h', async () => {
    const h = createHarness()
    await h.service.start('window@example.com')
    const row = h.rows.get('window@example.com')!
    row.sendsInWindow = 10
    row.failuresInWindow = 20
    row.lastSentAt = new Date(Date.now() - 120_000)
    row.windowStartedAt = new Date(Date.now() - 25 * 60 * 60_000)

    await h.service.start('window@example.com')

    expect(h.sent).toHaveLength(2)
    expect(h.rows.get('window@example.com')?.sendsInWindow).toBe(1)
    expect(h.rows.get('window@example.com')?.failuresInWindow).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/modules/auth/signup.service.test.ts`
Expected: FAIL — `./signup.service.js` não existe.

- [ ] **Step 3: Ajustar o serviço de e-mail**

O nome do usuário só existe na etapa 3, então a saudação nominal sai (spec §7.1). Em `src/email/resend.ts`:

```ts
  sendVerificationEmail(to: string, code: string): Promise<void>
```

```ts
    sendVerificationEmail: (to, code) =>
      send(to, 'Confirme seu e-mail no Fluxy', verificationHtml(code)),
```

```ts
    async sendVerificationEmail(to, code): Promise<void> {
      console.info(`[email] verification code for <${to}>: ${code}`)
    },
```

E no template, trocar a saudação nominal por uma neutra:

```ts
function verificationHtml(code: string): string {
  return `
    <p>Olá!</p>
    <p>Seu código de verificação do Fluxy é:</p>
    <p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>
    <p>Se você não pediu este código, ignore este e-mail.</p>
  `
}
```

Manter o restante do template como está — se ele citar o prazo de expiração, deixar o texto coerente com `VERIFY_OTP_TTL_MINUTES`.

- [ ] **Step 4: Implementar `start`**

Criar `src/modules/auth/signup.service.ts`:

```ts
import type { EmailService } from '../../email/resend.js'
import { env } from '../../shared/config/env.js'
import { generateOtp, hashToken } from '../../shared/crypto.js'
import type { AuthRepository } from './auth.repository.js'
import type { SignupRepository } from './signup.repository.js'

export interface SignupServiceDeps {
  repo: SignupRepository
  users: Pick<AuthRepository, 'findUserByEmail'>
  email: EmailService
  /** Runs the e-mail send off the response path (spec D13). */
  dispatch: (task: () => Promise<void>) => void
  signAccessToken: (userId: string) => string
  createRefreshToken: (userId: string, tokenHash: string, expiresAt: Date) => Promise<void>
}

export interface SignupService {
  start(email: string): Promise<{ message: string }>
}

// Same response whether the e-mail is free, taken, throttled or capped, so the
// endpoint never reveals whether an account exists (RNF-3).
const GENERIC_START = {
  message: 'If the e-mail is valid, a verification code has been sent.',
}

const WINDOW_MS = 24 * 60 * 60 * 1000

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function minutesFromNow(minutes: number, from: Date): Date {
  return new Date(from.getTime() + minutes * 60 * 1000)
}

export function createSignupService(deps: SignupServiceDeps): SignupService {
  const { repo, users, email, dispatch } = deps

  return {
    async start(emailInput): Promise<{ message: string }> {
      const address = normalizeEmail(emailInput)
      const now = new Date()

      if (await users.findUserByEmail(address)) return GENERIC_START

      const existing = await repo.findByEmail(address)

      // Window counters survive a restart; only time rolls them over (RN-8).
      const sameWindow =
        existing !== undefined && now.getTime() - existing.windowStartedAt.getTime() < WINDOW_MS
      const sends = sameWindow ? existing.sendsInWindow : 0
      const failures = sameWindow ? existing.failuresInWindow : 0
      const windowStartedAt = sameWindow ? existing.windowStartedAt : now

      const cooldownMs = env.VERIFY_OTP_RESEND_COOLDOWN_SECONDS * 1000
      const withinCooldown =
        existing !== undefined && now.getTime() - existing.lastSentAt.getTime() < cooldownMs
      const capped = sends >= env.SIGNUP_MAX_SENDS_PER_DAY || failures >= env.SIGNUP_MAX_FAILURES_PER_DAY

      if (withinCooldown || capped) return GENERIC_START

      const code = generateOtp()
      await repo.upsertStart({
        email: address,
        otpHash: hashToken(code),
        expiresAt: minutesFromNow(env.VERIFY_OTP_TTL_MINUTES, now),
        now,
        sendsInWindow: sends + 1,
        failuresInWindow: failures,
        windowStartedAt,
      })

      // Off the response path so a free e-mail and a taken one take the same
      // time to answer (D13); a failed send is logged, not surfaced.
      dispatch(() => email.sendVerificationEmail(address, code))

      return GENERIC_START
    },
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/modules/auth/signup.service.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 6: Lint e tipos**

Run: `npm run typecheck && npm run lint`
Expected: sem erros. `src/email/resend.ts` ainda é chamado com três argumentos em `auth.service.ts:82` — o TypeScript aceita argumento extra? **Não**: excesso de argumentos é erro. Corrigir a chamada em `auth.service.ts:82` para `email.sendVerificationEmail(user.email, code)`; o `register` antigo sai de cena na Task 7.

- [ ] **Step 7: Commit**

```bash
git add src/modules/auth/signup.service.ts src/modules/auth/signup.service.test.ts src/email/resend.ts src/modules/auth/auth.service.ts
git commit -m "feat(signup): implementa a etapa de inicio do cadastro com tetos por e-mail"
```

---

### Task 4: Serviço — etapa 2 (`verify`)

**Files:**
- Modify: `src/modules/auth/signup.service.ts`
- Modify: `src/modules/auth/signup.service.test.ts`

**Interfaces:**
- Consumes: tudo da Task 3.
- Produces: `verify(input: { email: string; code: string }): Promise<{ signupToken: string; expiresInSeconds: number }>`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `src/modules/auth/signup.service.test.ts`:

```ts
describe('SignupService.verify', () => {
  async function startAndCode(h: Harness, email: string): Promise<string> {
    await h.service.start(email)
    return h.sent.filter((e) => e.to === email).at(-1)!.code
  }

  it('returns a signup token when the code matches', async () => {
    const h = createHarness()
    const code = await startAndCode(h, 'ok@example.com')

    const res = await h.service.verify({ email: 'ok@example.com', code })

    expect(res.signupToken).toHaveLength(43)
    expect(res.expiresInSeconds).toBe(15 * 60)
    // Only the hash is stored.
    expect(h.rows.get('ok@example.com')?.signupTokenHash).toBe(hashToken(res.signupToken))
    expect(h.rows.get('ok@example.com')?.verifiedAt).not.toBeNull()
  })

  it('counts a wrong code against both counters and fails with OTP_INVALID', async () => {
    const h = createHarness()
    await startAndCode(h, 'wrong@example.com')

    await expect(h.service.verify({ email: 'wrong@example.com', code: '000000' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'OTP_INVALID',
    })
    expect(h.rows.get('wrong@example.com')?.attempts).toBe(1)
    expect(h.rows.get('wrong@example.com')?.failuresInWindow).toBe(1)
  })

  it('fails with OTP_INVALID when there is no pending signup', async () => {
    const h = createHarness()

    await expect(h.service.verify({ email: 'ghost@example.com', code: '123456' })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    })
  })

  it('fails with OTP_EXPIRED when the code timed out', async () => {
    const h = createHarness()
    const code = await startAndCode(h, 'old@example.com')
    h.rows.get('old@example.com')!.expiresAt = new Date(Date.now() - 1000)

    await expect(h.service.verify({ email: 'old@example.com', code })).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    })
  })

  it('locks the code once the per-code attempt limit is reached', async () => {
    const h = createHarness()
    const code = await startAndCode(h, 'locked@example.com')
    h.rows.get('locked@example.com')!.attempts = 5

    await expect(h.service.verify({ email: 'locked@example.com', code })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    })
  })

  it('refuses a second verify, so the first signup token stays valid (I1)', async () => {
    const h = createHarness()
    const code = await startAndCode(h, 'twice@example.com')
    const first = await h.service.verify({ email: 'twice@example.com', code })

    await expect(h.service.verify({ email: 'twice@example.com', code })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    })
    expect(h.rows.get('twice@example.com')?.signupTokenHash).toBe(hashToken(first.signupToken))
  })

  it('stops accepting attempts once the daily failure cap is reached (RN-8)', async () => {
    const h = createHarness()
    const code = await startAndCode(h, 'bruteforce@example.com')
    h.rows.get('bruteforce@example.com')!.failuresInWindow = 20

    await expect(h.service.verify({ email: 'bruteforce@example.com', code })).rejects.toMatchObject({
      code: 'OTP_INVALID',
    })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/modules/auth/signup.service.test.ts -t "SignupService.verify"`
Expected: FAIL — `service.verify is not a function`.

- [ ] **Step 3: Implementar `verify`**

Em `src/modules/auth/signup.service.ts`, acrescentar ao import de crypto o `generateToken`, ao import de errors o `AppError`, declarar `verify` na interface e implementá-lo:

```ts
import { generateOtp, generateToken, hashToken } from '../../shared/crypto.js'
import { AppError } from '../../shared/errors.js'
```

```ts
export interface SignupService {
  start(email: string): Promise<{ message: string }>
  verify(input: { email: string; code: string }): Promise<SignupTokenDto>
}

export interface SignupTokenDto {
  signupToken: string
  expiresInSeconds: number
}
```

```ts
    async verify({ email: emailInput, code }): Promise<SignupTokenDto> {
      // One generic error for "no pending signup", "wrong code" and "locked
      // code", so the endpoint doesn't become an account oracle (RNF-3).
      const invalid = new AppError(400, 'OTP_INVALID', 'Invalid verification code')
      const address = normalizeEmail(emailInput)
      const now = new Date()

      const row = await repo.findByEmail(address)
      if (!row) throw invalid

      const sameWindow = now.getTime() - row.windowStartedAt.getTime() < WINDOW_MS
      if (sameWindow && row.failuresInWindow >= env.SIGNUP_MAX_FAILURES_PER_DAY) throw invalid

      // Already verified: a second verify would overwrite the token handed to
      // the first caller. Restarting is what `start` is for (spec §7.1.2).
      if (row.verifiedAt) throw invalid

      if (row.expiresAt.getTime() < now.getTime()) {
        throw new AppError(400, 'OTP_EXPIRED', 'Verification code expired')
      }
      if (row.attempts >= env.VERIFY_OTP_MAX_ATTEMPTS) throw invalid
      if (row.otpHash !== hashToken(code)) {
        await repo.incrementFailure(row.id)
        throw invalid
      }

      const token = generateToken()
      await repo.markVerified(
        row.id,
        hashToken(token),
        minutesFromNow(env.SIGNUP_TOKEN_TTL_MINUTES, now),
      )
      return { signupToken: token, expiresInSeconds: env.SIGNUP_TOKEN_TTL_MINUTES * 60 }
    },
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/modules/auth/signup.service.test.ts`
Expected: PASS (13 testes).

- [ ] **Step 5: Lint e tipos**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/signup.service.ts src/modules/auth/signup.service.test.ts
git commit -m "feat(signup): implementa a verificacao do OTP e a emissao do signup token"
```

---

### Task 5: Serviço — etapa 3 (`complete`)

**Files:**
- Modify: `src/modules/auth/signup.service.ts`
- Modify: `src/modules/auth/signup.service.test.ts`

**Interfaces:**
- Consumes: `hashPassword` de `shared/password.js`; `DEFAULT_CATEGORIES` de `modules/categories/category.defaults.js`; `TokenPair` de `./auth.service.js`.
- Produces: `complete(input: CompleteSignupInput): Promise<TokenPair>` com

```ts
export interface CompleteSignupInput {
  signupToken: string
  firstName: string
  lastName: string
  password: string
  passwordConfirmation: string
}
```

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `src/modules/auth/signup.service.test.ts`:

```ts
describe('SignupService.complete', () => {
  async function verified(h: Harness, email: string): Promise<string> {
    await h.service.start(email)
    const code = h.sent.filter((e) => e.to === email).at(-1)!.code
    const res = await h.service.verify({ email, code })
    return res.signupToken
  }

  const validInput = {
    firstName: 'Ana',
    lastName: 'Silva',
    password: 'password123',
    passwordConfirmation: 'password123',
  }

  it('creates the account and returns a token pair', async () => {
    const h = createHarness()
    const signupToken = await verified(h, 'done@example.com')

    const pair = await h.service.complete({ signupToken, ...validInput })

    expect(pair.accessToken).toBe('access-user-done@example.com')
    expect(pair.refreshToken).toBeTypeOf('string')
    expect(pair.tokenType).toBe('Bearer')
    // The pending row is gone: the token cannot be replayed (CA-9).
    expect(h.rows.has('done@example.com')).toBe(false)
  })

  it('rejects a mismatched confirmation before touching the database', async () => {
    const h = createHarness()
    const signupToken = await verified(h, 'mismatch@example.com')

    await expect(
      h.service.complete({
        signupToken,
        ...validInput,
        passwordConfirmation: 'something-else',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PASSWORD_MISMATCH' })
    expect(h.rows.has('mismatch@example.com')).toBe(true)
  })

  it('rejects an unknown token with SIGNUP_TOKEN_INVALID', async () => {
    const h = createHarness()

    await expect(h.service.complete({ signupToken: 'nope', ...validInput })).rejects.toMatchObject({
      code: 'SIGNUP_TOKEN_INVALID',
    })
  })

  it('rejects an expired token with SIGNUP_TOKEN_EXPIRED', async () => {
    const h = createHarness()
    const signupToken = await verified(h, 'expired@example.com')
    h.rows.get('expired@example.com')!.signupTokenExpiresAt = new Date(Date.now() - 1000)

    await expect(h.service.complete({ signupToken, ...validInput })).rejects.toMatchObject({
      code: 'SIGNUP_TOKEN_EXPIRED',
    })
  })

  it('rejects a token that was invalidated by restarting the signup (CA-11)', async () => {
    const h = createHarness()
    const signupToken = await verified(h, 'restarted@example.com')
    h.rows.get('restarted@example.com')!.lastSentAt = new Date(Date.now() - 120_000)
    await h.service.start('restarted@example.com')

    await expect(h.service.complete({ signupToken, ...validInput })).rejects.toMatchObject({
      code: 'SIGNUP_TOKEN_INVALID',
    })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/modules/auth/signup.service.test.ts -t "SignupService.complete"`
Expected: FAIL — `service.complete is not a function`.

- [ ] **Step 3: Implementar `complete`**

Em `src/modules/auth/signup.service.ts`, acrescentar imports e o método:

```ts
import { DEFAULT_CATEGORIES } from '../categories/category.defaults.js'
import { hashPassword } from '../../shared/password.js'
import type { TokenPair } from './auth.service.js'
```

```ts
export interface CompleteSignupInput {
  signupToken: string
  firstName: string
  lastName: string
  password: string
  passwordConfirmation: string
}
```

```ts
    async complete(input): Promise<TokenPair> {
      if (input.password !== input.passwordConfirmation) {
        throw new AppError(400, 'PASSWORD_MISMATCH', 'Password confirmation does not match')
      }

      const tokenHash = hashToken(input.signupToken)
      const now = new Date()

      // Pre-check only to tell EXPIRED from INVALID; the authoritative check is
      // the conditional DELETE inside completeSignup.
      const pending = await repo.findByTokenHash(tokenHash)
      if (pending?.signupTokenExpiresAt && pending.signupTokenExpiresAt.getTime() < now.getTime()) {
        throw new AppError(400, 'SIGNUP_TOKEN_EXPIRED', 'Signup token expired')
      }

      const userId = await repo.completeSignup({
        signupTokenHash: tokenHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        passwordHash: await hashPassword(input.password),
        now,
        categories: DEFAULT_CATEGORIES,
      })
      if (!userId) {
        throw new AppError(400, 'SIGNUP_TOKEN_INVALID', 'Invalid signup token')
      }

      // The OTP already proved the address, so the account starts verified and
      // signed in (D9).
      const raw = generateToken()
      await deps.createRefreshToken(
        userId,
        hashToken(raw),
        new Date(now.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      )
      return {
        accessToken: deps.signAccessToken(userId),
        refreshToken: raw,
        tokenType: 'Bearer',
        expiresIn: env.ACCESS_TOKEN_TTL,
      }
    },
```

Declarar `complete(input: CompleteSignupInput): Promise<TokenPair>` na interface `SignupService`.

Nota: a violação do índice único de `users.email` (RN-6, `EMAIL_IN_USE`) é tratada na Task 6, no handler, junto com o mapeamento HTTP.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/modules/auth/signup.service.test.ts`
Expected: PASS (18 testes).

- [ ] **Step 5: Lint e tipos**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/signup.service.ts src/modules/auth/signup.service.test.ts
git commit -m "feat(signup): implementa a conclusao do cadastro com sessao imediata"
```

---

### Task 6: Schemas, rotas e integração

**Files:**
- Create: `src/modules/auth/signup.schema.ts`
- Create: `src/modules/auth/signup.routes.ts`
- Create: `src/modules/auth/signup.test.ts`
- Modify: `src/app.ts:4` (import) e o bloco de `register`

**Interfaces:**
- Consumes: `createSignupService`, `createSignupRepository`, `createAuthRepository`.
- Produces: `signupRoutes: FastifyPluginAsyncTypebox`, e os endpoints `POST /auth/signup/start|verify|complete`.

- [ ] **Step 1: Escrever o teste de integração que falha**

Criar `src/modules/auth/signup.test.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { createFakeEmail, createTestDb, flushAsync, type SentEmail } from '../../test/helpers.js'

describe('signup flow', () => {
  let app: FastifyInstance
  let close: () => Promise<void>
  let sent: SentEmail[]

  beforeAll(async () => {
    const testDb = await createTestDb()
    close = testDb.close
    const fake = createFakeEmail()
    sent = fake.sent
    app = await buildApp({ logger: false, db: testDb.db, email: fake.service })
  })

  afterAll(async () => {
    await app.close()
    await close()
  })

  async function lastCode(to: string): Promise<string> {
    // The send is dispatched off the response path (D13), so let it land.
    await flushAsync()
    return sent.filter((e) => e.kind === 'verify' && e.to === to).at(-1)?.code ?? ''
  }

  async function start(email: string): Promise<number> {
    const res = await app.inject({ method: 'POST', url: '/auth/signup/start', payload: { email } })
    return res.statusCode
  }

  it('starts a signup and e-mails a 6-digit code', async () => {
    expect(await start('ana@example.com')).toBe(202)
    expect(await lastCode('ana@example.com')).toMatch(/^[0-9]{6}$/)
  })

  it('rejects a wrong code with OTP_INVALID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup/verify',
      payload: { email: 'ana@example.com', code: '000000' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('OTP_INVALID')
  })

  it('verifies the code and completes the signup, returning a session', async () => {
    const verify = await app.inject({
      method: 'POST',
      url: '/auth/signup/verify',
      payload: { email: 'ana@example.com', code: await lastCode('ana@example.com') },
    })
    expect(verify.statusCode).toBe(200)
    const { signupToken, expiresInSeconds } = verify.json()
    expect(expiresInSeconds).toBe(900)

    const complete = await app.inject({
      method: 'POST',
      url: '/auth/signup/complete',
      payload: {
        signupToken,
        firstName: 'Ana',
        lastName: 'Silva',
        password: 'password123',
        passwordConfirmation: 'password123',
      },
    })
    expect(complete.statusCode).toBe(201)
    expect(complete.json().accessToken).toBeTypeOf('string')
    expect(complete.json().tokenType).toBe('Bearer')

    // The account is usable straight away: it was born verified (D9).
    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${complete.json().accessToken}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({
      email: 'ana@example.com',
      firstName: 'Ana',
      emailVerified: true,
    })

    // And the default categories are already there (CA-9).
    const cats = await app.inject({
      method: 'GET',
      url: '/categories',
      headers: { authorization: `Bearer ${complete.json().accessToken}` },
    })
    expect(cats.json().length).toBeGreaterThan(0)

    // Replaying the same token fails.
    const replay = await app.inject({
      method: 'POST',
      url: '/auth/signup/complete',
      payload: {
        signupToken,
        firstName: 'Ana',
        lastName: 'Silva',
        password: 'password123',
        passwordConfirmation: 'password123',
      },
    })
    expect(replay.statusCode).toBe(400)
    expect(replay.json().error.code).toBe('SIGNUP_TOKEN_INVALID')
  })

  it('answers identically and sends nothing for an e-mail that is already an account', async () => {
    const before = sent.length
    expect(await start('ana@example.com')).toBe(202)
    await flushAsync()
    expect(sent).toHaveLength(before)
  })

  it('logs in with the password chosen at signup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'ana@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().refreshToken).toBeTypeOf('string')
  })

  it('rejects a mismatched password confirmation', async () => {
    await start('bruno@example.com')
    const verify = await app.inject({
      method: 'POST',
      url: '/auth/signup/verify',
      payload: { email: 'bruno@example.com', code: await lastCode('bruno@example.com') },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup/complete',
      payload: {
        signupToken: verify.json().signupToken,
        firstName: 'Bruno',
        lastName: 'Costa',
        password: 'password123',
        passwordConfirmation: 'password124',
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('PASSWORD_MISMATCH')
  })

  it('validates the payloads', async () => {
    const badEmail = await app.inject({
      method: 'POST',
      url: '/auth/signup/start',
      payload: { email: 'not-an-email' },
    })
    expect(badEmail.statusCode).toBe(400)

    const badCode = await app.inject({
      method: 'POST',
      url: '/auth/signup/verify',
      payload: { email: 'ana@example.com', code: '12' },
    })
    expect(badCode.statusCode).toBe(400)
  })
})
```

Acrescentar o helper a `src/test/helpers.ts`:

```ts
/** Lets fire-and-forget work (e.g. the verification e-mail, D13) settle. */
export function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/modules/auth/signup.test.ts`
Expected: FAIL — as rotas `/auth/signup/*` devolvem 404.

- [ ] **Step 3: Escrever os schemas**

Primeiro criar `src/modules/auth/field.schema.ts`, movendo as definições de campo que hoje moram no topo de `auth.schema.ts`, para que os dois módulos compartilhem uma definição só (decisão da varredura pré-execução — sem isso, `Email` e `Password` ficariam duplicados entre os dois arquivos e a política de senha poderia divergir):

```ts
import { Type } from '@fastify/type-provider-typebox'

/** Field schemas shared by the session and signup modules. */

// Pragmatic e-mail pattern (real validation happens by sending the message).
export const Email = Type.String({
  pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
  maxLength: 320,
})
export const Password = Type.String({ minLength: 8, maxLength: 200 })
export const TokenString = Type.String({ minLength: 1 })
export const OtpCode = Type.String({ pattern: '^[0-9]{6}$' })
export const Name = Type.String({ minLength: 1, maxLength: 100 })
```

Em `src/modules/auth/auth.schema.ts`, apagar as constantes locais `Email`, `Password`, `TokenString`, `OtpCode` e `Name` e importar as que ainda usa:

```ts
import { Email, Password, TokenString } from './field.schema.js'
```

Depois criar `src/modules/auth/signup.schema.ts`:

```ts
import { Type } from '@fastify/type-provider-typebox'
import { Email, Name, OtpCode, Password } from './field.schema.js'

export const SignupStartBody = Type.Object({ email: Email })
export const SignupVerifyBody = Type.Object({ email: Email, code: OtpCode })
export const SignupCompleteBody = Type.Object({
  signupToken: Type.String({ minLength: 1 }),
  firstName: Name,
  lastName: Name,
  password: Password,
  passwordConfirmation: Password,
})

export const SignupTokenResponse = Type.Object({
  signupToken: Type.String(),
  expiresInSeconds: Type.Integer(),
})
```

- [ ] **Step 4: Escrever as rotas**

Criar `src/modules/auth/signup.routes.ts`:

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { env } from '../../shared/config/env.js'
import { AppError } from '../../shared/errors.js'
import { createAuthRepository } from './auth.repository.js'
import { MessageResponse, TokenPairResponse } from './auth.schema.js'
import { createSignupRepository } from './signup.repository.js'
import { createSignupService } from './signup.service.js'
import {
  SignupCompleteBody,
  SignupStartBody,
  SignupTokenResponse,
  SignupVerifyBody,
} from './signup.schema.js'

/** Postgres unique-violation code, raised by users_email_unique (RN-6). */
const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION
}

export const signupRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const authRepo = createAuthRepository(app.db)
  const service = createSignupService({
    repo: createSignupRepository(app.db),
    users: authRepo,
    email: app.email,
    dispatch: (task) => {
      void task().catch((err: unknown) => {
        app.log.error({ err }, 'failed to send the verification e-mail')
      })
    },
    signAccessToken: (userId) => app.jwt.sign({ sub: userId }, { expiresIn: env.ACCESS_TOKEN_TTL }),
    createRefreshToken: authRepo.createRefreshToken,
  })

  app.post(
    '/auth/signup/start',
    {
      schema: {
        tags: ['auth'],
        summary: 'Start a signup',
        description:
          'Sends a 6-digit code to the address. Always answers the same way, whether the ' +
          'e-mail is free, already an account, within the resend cooldown or over the daily ' +
          'cap. Calling it again is how a code is resent.',
        body: SignupStartBody,
        response: { 202: MessageResponse },
      },
    },
    async (request, reply) => {
      const result = await service.start(request.body.email)
      reply.code(202)
      return result
    },
  )

  app.post(
    '/auth/signup/verify',
    {
      schema: {
        tags: ['auth'],
        summary: 'Confirm the signup code',
        description:
          'Checks the 6-digit code and returns a short-lived signup token, which authorizes ' +
          'nothing but completing the signup. The code is locked after too many failed ' +
          'attempts and cannot be verified twice.',
        body: SignupVerifyBody,
        response: { 200: SignupTokenResponse },
      },
    },
    (request) => service.verify(request.body),
  )

  app.post(
    '/auth/signup/complete',
    {
      schema: {
        tags: ['auth'],
        summary: 'Complete the signup',
        description:
          'Creates the account with the given name and password, already verified, seeds the ' +
          'default categories and signs the user in.',
        body: SignupCompleteBody,
        response: { 201: TokenPairResponse },
      },
    },
    async (request, reply) => {
      try {
        const pair = await service.complete(request.body)
        reply.code(201)
        return pair
      } catch (err) {
        // The address became an account between start and complete (RN-6).
        if (isUniqueViolation(err)) {
          throw new AppError(409, 'EMAIL_IN_USE', 'E-mail already in use')
        }
        throw err
      }
    },
  )
}
```

- [ ] **Step 5: Registrar as rotas**

Em `src/app.ts`, importar e registrar junto das demais rotas:

```ts
import { signupRoutes } from './modules/auth/signup.routes.js'
```

Registrar imediatamente antes de `authRoutes`, para o Swagger listar o cadastro primeiro:

```ts
  await app.register(signupRoutes)
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run src/modules/auth/signup.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 7: Lint e tipos**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/modules/auth/signup.schema.ts src/modules/auth/signup.routes.ts src/modules/auth/signup.test.ts src/test/helpers.ts src/app.ts
git commit -m "feat(signup): expoe os tres endpoints de cadastro"
```

---

### Task 7: Remover o fluxo antigo

**Files:**
- Modify: `src/modules/auth/auth.service.ts:36-47,49-56,77-83,97-146`
- Modify: `src/modules/auth/auth.routes.ts:31-73`
- Modify: `src/modules/auth/auth.repository.ts:19-25,52-113`
- Modify: `src/modules/auth/auth.schema.ts:13-21`
- Modify: `src/test/helpers.ts:48-63`
- Modify: `src/modules/auth/auth.test.ts:36-77`

**Interfaces:**
- Consumes: os endpoints da Task 6.
- Produces: `authenticate()` passa a usar o fluxo novo; a assinatura pública continua `authenticate(app, sent, email, password): Promise<string>`, então `category.test.ts`, `transaction.test.ts` e `report.test.ts` não mudam.

- [ ] **Step 1: Atualizar o helper compartilhado**

Em `src/test/helpers.ts`, substituir o corpo de `authenticate` (a assinatura fica igual):

```ts
/**
 * Signs a brand-new user up through the three-step flow and returns the access
 * token. Reads the OTP from the capturing e-mail service.
 */
export async function authenticate(
  app: FastifyInstance,
  sent: SentEmail[],
  email: string,
  password: string,
): Promise<string> {
  await app.inject({ method: 'POST', url: '/auth/signup/start', payload: { email } })
  await flushAsync()
  const code = sent.filter((e) => e.kind === 'verify' && e.to === email).at(-1)?.code ?? ''
  const verify = await app.inject({
    method: 'POST',
    url: '/auth/signup/verify',
    payload: { email, code },
  })
  const complete = await app.inject({
    method: 'POST',
    url: '/auth/signup/complete',
    payload: {
      signupToken: verify.json().signupToken,
      firstName: 'Test',
      lastName: 'User',
      password,
      passwordConfirmation: password,
    },
  })
  return complete.json().accessToken
}
```

- [ ] **Step 2: Rodar a suíte e confirmar a linha de base verde**

Run: `npm test`
Expected: PASS em tudo. Os dois fluxos coexistem neste ponto — o helper já migrou para `/auth/signup/*` e os endpoints antigos ainda existem. Só remova o fluxo antigo com esta saída verde; assim, qualquer falha nos passos seguintes é consequência da remoção, e não do helper.

- [ ] **Step 3: Remover as rotas antigas**

Em `src/modules/auth/auth.routes.ts`, apagar os três blocos `app.post` de `/auth/register`, `/auth/verify-email` e `/auth/verify-email/resend`, e do import de `./auth.schema.js` remover `RegisterBody`, `VerifyEmailBody` e `ResendVerificationBody`.

Como `seedDefaultCategories` só existia para o `register`, remover também de `auth.routes.ts` o `categoryRepo`, o import de `seedDefaultCategories`, o de `createCategoryRepository` e a propriedade `seedDefaultCategories` passada a `createAuthService`.

- [ ] **Step 4: Remover os métodos do serviço**

Em `src/modules/auth/auth.service.ts`:
- Apagar de `AuthService` as assinaturas `register`, `verifyEmail` e `resendVerification`, e suas implementações.
- Apagar a constante `GENERIC_REGISTER` e a função `sendVerification`.
- Apagar `minutesFromNow` (só era usada por `sendVerification`).
- De `AuthServiceDeps`, apagar `seedDefaultCategories`; e apagar `email` **apenas se** nenhum outro método usar — `forgotPassword` usa, então `email` permanece.
- Ajustar os imports: `generateOtp` e `User` deixam de ser usados; `AppError` continua.

- [ ] **Step 5: Remover os métodos do repositório**

Em `src/modules/auth/auth.repository.ts`, apagar da interface e da implementação: `setEmailVerified`, `findActiveAuthTokenByUser`, `findLatestAuthToken`, `incrementAuthTokenAttempts` e `invalidateActiveAuthTokens` — todos existiam só para `email_verify`. Manter `createAuthToken`, `findActiveAuthToken` e `markAuthTokenUsed`, usados pelo reset de senha. Ajustar imports (`desc` deixa de ser usado).

- [ ] **Step 6: Remover os schemas antigos**

Em `src/modules/auth/auth.schema.ts`, apagar `RegisterBody`, `VerifyEmailBody` e `ResendVerificationBody`. As definições de campo já vivem em `field.schema.ts` desde a Task 6; ajustar o import para trazer só o que continua em uso (`Email`, `Password`, `TokenString`).

- [ ] **Step 7: Atualizar os testes de auth**

Em `src/modules/auth/auth.test.ts`:
- Trocar `registerAndVerify` por uma chamada ao helper compartilhado, importando `authenticate` e `flushAsync` de `../../test/helpers.js`.
- Apagar os testes `'registers and sends a verification e-mail'`, `'blocks login before e-mail verification'` e `'verifies the e-mail and then logs in, returning a token pair'` — o fluxo que eles cobriam agora é de `signup.test.ts`, e `login` já é coberto lá.
- Manter e ajustar todo o resto (refresh, logout, forgot/reset/change-password, `/me`) para criar o usuário via `authenticate`.

- [ ] **Step 7b: Consolidar os helpers duplicados**

A revisão da Task 3 apontou que `normalizeEmail` e `minutesFromNow` ficaram byte a byte iguais em `auth.service.ts` e `signup.service.ts`. Enquanto o fluxo antigo existia valia esperar; agora que ele saiu, consolidar.

Criar `src/modules/auth/time.ts` e `src/modules/auth/email-address.ts` seria fragmentar demais para duas funções — em vez disso, mover as duas para `src/shared/` junto das utilidades que já vivem lá:

Em `src/shared/crypto.ts` **não** — não é criptografia. Criar `src/modules/auth/auth.utils.ts`:

```ts
/** Canonical form of an e-mail address: trimmed and lowercased (RN-1). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** `minutes` from `from`, defaulting to now. */
export function minutesFromNow(minutes: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + minutes * 60 * 1000)
}
```

Importar nos dois serviços e apagar as cópias locais. `hoursFromNow` e `daysFromNow` de `auth.service.ts` continuam lá — só são usadas por ele.

Por que importa: se `normalizeEmail` divergir entre os dois arquivos, o mesmo endereço passa a ser tratado como dois no cadastro e no login.

Run: `npx vitest run src/modules/auth/`
Expected: PASS.

- [ ] **Step 8: Rodar a suíte inteira**

Run: `npm test`
Expected: todos os arquivos PASSAM. Nenhuma referência a `/auth/register` ou `/auth/verify-email` sobra.

Verificar: `grep -rn "auth/register\|verify-email\|email_verify" src/`
Expected: sem resultados em `src/` (o valor do enum permanece só em `schema.ts:9`).

- [ ] **Step 9: Lint e tipos**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add src/modules/auth src/test/helpers.ts
git commit -m "refactor(auth): remove os endpoints de cadastro do fluxo antigo"
```

---

### Task 8: Fechamento

**Files:**
- Modify: `README.md` (se listar os endpoints de auth)
- Modify: `specs/README.md` (índice)
- Modify: `specs/0003-autenticacao-e-contas.md` (status)

- [ ] **Step 0: Remover o override global de cooldown nos testes**

`vitest.config.ts` fixa `VERIFY_OTP_RESEND_COOLDOWN_SECONDS: '0'` para a suíte inteira. Esse override existia para o `verify-email/resend` antigo, removido na Task 7 — e ele obrigou o teste de cooldown do `start` (Task 3) a reimportar o serviço com `vi.stubEnv` + `vi.resetModules()`, já que com cooldown zero o comportamento é intestável.

Com o endpoint antigo fora, apagar o bloco `env` de `vitest.config.ts` (o arquivo fica só com `defineConfig({ test: {} })`, ou pode ser reduzido ao mínimo) e simplificar o teste `'skips the send while inside the resend cooldown'` em `src/modules/auth/signup.service.test.ts` para usar o harness normal, sem `stubEnv`, `resetModules` nem `import()` dinâmico.

Run: `npm test`
Expected: tudo passa. Se algum teste de integração quebrar por pedir dois códigos para o **mesmo** e-mail dentro de 60s, o certo é o teste usar e-mails distintos — não reintroduzir o override global.

- [ ] **Step 1: Conferir a documentação de endpoints**

Run: `grep -rn "auth/register\|verify-email" README.md DEPLOY.md`
Se houver menção, atualizar para os três endpoints de `/auth/signup`. Se não houver, seguir.

- [ ] **Step 2: Verificar o OpenAPI**

Run: `npm run dev` e abrir `http://localhost:3333/docs`
Expected: os três endpoints `/auth/signup/*` aparecem sob a tag `auth` e os antigos sumiram. Encerrar o servidor depois.

Alternativa sem subir o servidor: `npx vitest run src/app.test.ts`, que já valida o boot da aplicação.

- [ ] **Step 3: Rodar a verificação completa**

Run: `npm run typecheck && npm run lint && npm test`
Expected: os três limpos. **Não** declarar a tarefa concluída sem ver esta saída (CLAUDE.md §2 e §3).

- [ ] **Step 4: Marcar a spec como implementada**

Em `specs/0003-autenticacao-e-contas.md`, mudar `| **Status** | Aprovada |` para `| **Status** | Implementada |`, e em `specs/README.md` atualizar a linha da 0003 no índice para `Implementada`.

- [ ] **Step 5: Commit**

```bash
git add specs README.md
git commit -m "docs(spec): marca a 0003 como implementada"
```

---

## Cobertura da Spec

| Requisito | Onde |
|---|---|
| §4 `signup_verifications` | Task 1 |
| §4 `users` com nomes | já existia; conferido na Task 1 |
| §4 retenção / linha apagada | Task 2 (CTE com `DELETE`) |
| §5 três endpoints e contratos | Task 6 |
| §5 mapa de erros | Tasks 4, 5 (códigos) e 6 (status e `EMAIL_IN_USE`) |
| §6 signup token, entropia e TTL | Tasks 1 (env) e 4 |
| §6 tabela de configuração | Task 1 |
| §7.1.1 start, cooldown, reenvio | Task 3 |
| §7.1.2 verify, trava, segundo verify | Task 4 |
| §7.1.3 complete atômico | Tasks 2 e 5 |
| §7.1 e-mail sem saudação nominal | Task 3 |
| RF-1, RF-2, RF-3 | Tasks 3, 4, 5 |
| RNF-2 hash de tudo | Tasks 2, 3, 4 |
| RNF-3 resposta genérica e timing | Tasks 3 e 6 (`dispatch`) |
| RN-2 confirmação de senha | Task 5 |
| RN-6 `EMAIL_IN_USE` | Task 6 |
| RN-7 escopo do signup token | Task 6 (token não vira sessão) |
| RN-8 tetos por e-mail | Tasks 1, 3, 4 |
| CA-8, CA-9, CA-10, CA-11 | Tasks 5 e 6 |
| CA-12 cooldown | Task 3 |
| CA-13 teto da janela | Tasks 3 e 4 |
| CA-14 falha no seed não grava nada | Task 2 |
| D12 remoção dos endpoints antigos | Task 7 |

**Fora do escopo deste plano:** rate limiting por e-mail na borda (a RNF-4 delega a proteção do cadastro à RN-8) e a purga agendada de linhas pendentes vencidas além da limpeza oportunista do `start` — a spec §4 define a limpeza como oportunista, e nada mais foi especificado.
