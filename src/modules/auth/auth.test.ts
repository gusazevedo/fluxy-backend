import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { createFakeEmail, createTestDb, type SentEmail } from '../../test/helpers.js'

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

  function lastLink(kind: 'verify' | 'reset', to: string): string {
    return sent.filter((e) => e.kind === kind && e.to === to).at(-1)?.link ?? ''
  }

  async function registerAndVerify(email: string, password: string): Promise<void> {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, firstName: 'Test', lastName: 'User', password },
    })
    await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: tokenFromLink(lastLink('verify', email)) },
    })
  }

  it('registers and sends a verification e-mail', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'a@example.com', firstName: 'Ana', lastName: 'Silva', password: 'password123' },
    })
    expect(res.statusCode).toBe(201)
    expect(sent.some((e) => e.kind === 'verify' && e.to === 'a@example.com')).toBe(true)
  })

  it('blocks login before e-mail verification', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('verifies the e-mail and then logs in, returning a token pair', async () => {
    const verify = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: tokenFromLink(lastLink('verify', 'a@example.com')) },
    })
    expect(verify.statusCode).toBe(200)

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'password123' },
    })
    expect(login.statusCode).toBe(200)
    const body = login.json()
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.tokenType).toBe('Bearer')
  })

  it('returns the current account on /me with a token and 401 without', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'password123' },
    })
    const { accessToken } = login.json()

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json().email).toBe('a@example.com')
    expect(me.json().firstName).toBe('Ana')
    expect(me.json().lastName).toBe('Silva')

    const noAuth = await app.inject({ method: 'GET', url: '/me' })
    expect(noAuth.statusCode).toBe(401)
  })

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'password123' },
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
    await registerAndVerify('b@example.com', 'password123')
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
      payload: { token: tokenFromLink(lastLink('reset', 'b@example.com')), password: 'newpassword456' },
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

  it('does not reveal whether an e-mail is already registered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'a@example.com', firstName: 'Outro', lastName: 'Nome', password: 'whatever123' },
    })
    expect(res.statusCode).toBe(201)

    // The duplicate did not overwrite anything; original credentials still work.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'password123' },
    })
    expect(login.statusCode).toBe(200)
  })

  it('rejects invalid credentials and short passwords', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'a@example.com', password: 'wrongpassword' },
    })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().error.code).toBe('INVALID_CREDENTIALS')

    const short = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'c@example.com', firstName: 'Curto', lastName: 'Senha', password: 'short' },
    })
    expect(short.statusCode).toBe(400)

    const noName = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'd@example.com', password: 'password123' },
    })
    expect(noName.statusCode).toBe(400)
    expect(noName.json().error.code).toBe('VALIDATION_ERROR')
  })
})
