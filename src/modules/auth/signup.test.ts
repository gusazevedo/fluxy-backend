import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import type { Database } from '../../shared/database/client.js'
import { users } from '../../shared/database/schema.js'
import { hashPassword } from '../../shared/password.js'
import { createFakeEmail, createTestDb, flushAsync, type SentEmail } from '../../test/helpers.js'

describe('signup flow', () => {
  let app: FastifyInstance
  let db: Database
  let close: () => Promise<void>
  let sent: SentEmail[]

  beforeAll(async () => {
    const testDb = await createTestDb()
    db = testDb.db
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

  it('maps a race against a concurrent account to 409 EMAIL_IN_USE', async () => {
    const email = 'carla@example.com'
    await start(email)
    const verify = await app.inject({
      method: 'POST',
      url: '/auth/signup/verify',
      payload: { email, code: await lastCode(email) },
    })
    expect(verify.statusCode).toBe(200)
    const { signupToken } = verify.json()

    // The address becomes an account behind this signup's back, between
    // verify and complete (RN-6). Inserted straight into the test DB, not
    // through POST /auth/register — that endpoint is going away next.
    await db.insert(users).values({
      email,
      firstName: 'Carla',
      lastName: 'Existing',
      passwordHash: await hashPassword('some-other-password'),
      emailVerified: true,
    })

    const complete = await app.inject({
      method: 'POST',
      url: '/auth/signup/complete',
      payload: {
        signupToken,
        firstName: 'Carla',
        lastName: 'Nova',
        password: 'password123',
        passwordConfirmation: 'password123',
      },
    })
    expect(complete.statusCode).toBe(409)
    expect(complete.json().error.code).toBe('EMAIL_IN_USE')
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
