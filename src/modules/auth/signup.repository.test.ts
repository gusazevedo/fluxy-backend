import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../../test/helpers.js'
import { categories, signupVerifications, users } from '../../shared/database/schema.js'
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
