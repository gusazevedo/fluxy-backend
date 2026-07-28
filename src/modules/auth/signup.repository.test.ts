import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../../test/helpers.js'
import {
  categories,
  signupVerifications,
  users,
  type TransactionKind,
} from '../../shared/database/schema.js'
import { createSignupRepository, type SignupRepository } from './signup.repository.js'
import { DEFAULT_CATEGORIES } from '../categories/category.defaults.js'

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
    // Simulate a row that already carries a signup token but was never marked
    // verified, i.e. `markVerified` was skipped. `verifiedAt` stays NULL so the
    // guard in `completeSignup`'s CTE (`AND verified_at IS NOT NULL`) is the
    // only thing standing between this row and completion.
    const row = await repo.findByEmail('unverified@example.com')
    await testDb.db
      .update(signupVerifications)
      .set({ signupTokenHash: 'unverified-token-hash', signupTokenExpiresAt: minutes(15) })
      .where(eq(signupVerifications.id, row!.id))

    const userId = await repo.completeSignup({
      signupTokenHash: 'unverified-token-hash',
      firstName: 'Ana',
      lastName: 'Silva',
      passwordHash: 'argon-hash',
      now: new Date(),
      categories: DEFAULT_CATEGORIES,
    })

    expect(userId).toBeUndefined()
    // The row must survive: the guard rejects the unverified row without deleting it.
    expect(await repo.findByTokenHash('unverified-token-hash')).toBeDefined()
  })

  it('completeSignup rolls back the whole CTE when category seeding fails (CA-14, D14)', async () => {
    // D14: atomicity comes from a single SQL statement with CTEs, not a driver
    // transaction (the Neon HTTP driver has none). This is the one test that
    // actually exercises that: the CTE must start — the token check passes —
    // and then blow up mid-way, at the `::transaction_kind` cast in the seed
    // step, proving that a failure there rolls back the delete + insert too.
    await startAndVerify('atomic@example.com', 'atomic-token-hash')

    await expect(
      repo.completeSignup({
        signupTokenHash: 'atomic-token-hash',
        firstName: 'Ana',
        lastName: 'Silva',
        passwordHash: 'argon-hash',
        now: new Date(),
        // Narrowest possible cast: this value is deliberately invalid so it
        // fails the `::transaction_kind` cast in the seed step. It cannot be
        // a real `TransactionKind`, that's the whole point of the test.
        categories: [{ name: 'Invalid', kind: 'nao-existe' as TransactionKind }],
      }),
    ).rejects.toThrow()

    // Nothing was written: no user for that e-mail...
    const orphanUsers = await testDb.db
      .select()
      .from(users)
      .where(eq(users.email, 'atomic@example.com'))
    expect(orphanUsers).toHaveLength(0)
    // ...and the signup row survived, so the token is still valid for a retry.
    const pending = await repo.findByTokenHash('atomic-token-hash')
    expect(pending).toBeDefined()

    // Retrying with valid categories now completes normally (CA-14: "signup
    // token continua válido para nova tentativa").
    const userId = await repo.completeSignup({
      signupTokenHash: 'atomic-token-hash',
      firstName: 'Ana',
      lastName: 'Silva',
      passwordHash: 'argon-hash',
      now: new Date(),
      categories: DEFAULT_CATEGORIES,
    })

    expect(userId).toBeTypeOf('string')
    const user = await testDb.db.select().from(users).where(eq(users.id, userId!))
    expect(user[0].email).toBe('atomic@example.com')
    const seeded = await testDb.db.select().from(categories).where(eq(categories.userId, userId!))
    expect(seeded).toHaveLength(DEFAULT_CATEGORIES.length)
  })
})
