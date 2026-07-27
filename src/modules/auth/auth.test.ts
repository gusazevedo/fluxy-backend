import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { authenticate, createFakeEmail, createTestDb, flushAsync, type SentEmail } from '../../test/helpers.js'

function tokenFromLink(link: string): string {
  return new URL(link).searchParams.get('token') ?? ''
}

describe('auth flows', () => {
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

  function lastLink(to: string): string {
    return sent.filter((e) => e.kind === 'reset' && e.to === to).at(-1)?.link ?? ''
  }

  /** Runs a fresh signup up to a valid signup token, reading the OTP from `sent`. */
  async function signupToken(email: string): Promise<string> {
    await app.inject({ method: 'POST', url: '/auth/signup/start', payload: { email } })
    await flushAsync()
    const code = sent.filter((e) => e.kind === 'verify' && e.to === email).at(-1)?.code ?? ''
    const verify = await app.inject({
      method: 'POST',
      url: '/auth/signup/verify',
      payload: { email, code },
    })
    return verify.json().signupToken
  }

  it('returns the current account on /me with a token and 401 without', async () => {
    const accessToken = await authenticate(app, sent, 'a@example.com', 'password123')

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().email).toBe('a@example.com')
    expect(me.json().firstName).toBe('Test')
    expect(me.json().lastName).toBe('User')

    const noAuth = await app.inject({ method: 'GET', url: '/me' })
    expect(noAuth.statusCode).toBe(401)
  })

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    await authenticate(app, sent, 'refresh@example.com', 'password123')
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'refresh@example.com', password: 'password123' },
    })
    const oldRefresh = login.json().refreshToken

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldRefresh },
    })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json().refreshToken).not.toBe(oldRefresh)

    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldRefresh },
    })
    expect(reuse.statusCode).toBe(401)
  })

  it('resets the password and invalidates old sessions', async () => {
    await authenticate(app, sent, 'b@example.com', 'password123')
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'b@example.com', password: 'password123' },
    })
    const oldRefresh = login.json().refreshToken

    await app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'b@example.com' } })
    const reset = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: tokenFromLink(lastLink('b@example.com')), password: 'newpassword456' },
    })
    expect(reset.statusCode).toBe(200)

    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldRefresh },
    })
    expect(reuse.statusCode).toBe(401)

    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'b@example.com', password: 'newpassword456' },
    })
    expect(newLogin.statusCode).toBe(200)

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'b@example.com', password: 'password123' },
    })
    expect(oldLogin.statusCode).toBe(401)
  })

  it('rejects invalid credentials and short passwords', async () => {
    await authenticate(app, sent, 'c@example.com', 'password123')

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'c@example.com', password: 'wrongpassword' },
    })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS')

    const short = await app.inject({
      method: 'POST',
      url: '/auth/signup/complete',
      payload: {
        signupToken: await signupToken('short@example.com'),
        firstName: 'Curto',
        lastName: 'Senha',
        password: 'short',
        passwordConfirmation: 'short',
      },
    })
    expect(short.statusCode).toBe(400)
    expect(short.json().error.code).toBe('VALIDATION_ERROR')

    const noName = await app.inject({
      method: 'POST',
      url: '/auth/signup/complete',
      payload: {
        signupToken: await signupToken('noname@example.com'),
        lastName: 'User',
        password: 'password123',
        passwordConfirmation: 'password123',
      },
    })
    expect(noName.statusCode).toBe(400)
    expect(noName.json().error.code).toBe('VALIDATION_ERROR')
  })
})
