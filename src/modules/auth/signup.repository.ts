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
                 unnest(${sql.param(names)}::text[], ${sql.param(kinds)}::text[]) AS c(name, kind)
          RETURNING user_id
        )
        SELECT id FROM new_user
      `)

      return toRows<{ id: string }>(result)[0]?.id
    },
  }
}
