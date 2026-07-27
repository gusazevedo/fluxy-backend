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
