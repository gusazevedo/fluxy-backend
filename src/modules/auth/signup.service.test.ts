import { afterEach, describe, expect, it, vi } from 'vitest'
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

// `createSignupService` defaults to the module-level import; the resend-cooldown
// test below passes a freshly re-imported factory instead, because
// vitest.config.ts pins VERIFY_OTP_RESEND_COOLDOWN_SECONDS=0 for the whole
// suite (so other tests can resend immediately) and `env` is computed once at
// module load, so only a fresh import after `vi.stubEnv` sees a real cooldown.
function createHarness(serviceFactory: typeof createSignupService = createSignupService): Harness {
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

  const service = serviceFactory({
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
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

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
    // D17: the pending row is created even for a taken e-mail; only the send
    // is skipped, so `verify` can't tell the two cases apart.
    expect(h.rows.has('taken@example.com')).toBe(true)
  })

  it('skips the send while inside the resend cooldown', async () => {
    // Needs a real (non-zero) cooldown, unlike vitest.config.ts's suite-wide
    // override; see the comment on createHarness for why the re-import.
    vi.stubEnv('VERIFY_OTP_RESEND_COOLDOWN_SECONDS', '60')
    vi.resetModules()
    const { createSignupService: freshFactory } = await import('./signup.service.js')
    const h = createHarness(freshFactory)
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

  it('stops sending once the daily failure cap is reached (RN-8)', async () => {
    const h = createHarness()
    await h.service.start('brute@example.com')
    const row = h.rows.get('brute@example.com')!
    row.failuresInWindow = 20
    row.lastSentAt = new Date(Date.now() - 120_000)

    const res = await h.service.start('brute@example.com')

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
    // The stored TTL must come from SIGNUP_TOKEN_TTL_MINUTES (15min), not from
    // VERIFY_OTP_TTL_MINUTES (5min) — Task 5's SQL checks
    // `signup_token_expires_at > now` against this value.
    const signupTokenTtlMinutes =
      (h.rows.get('ok@example.com')!.signupTokenExpiresAt!.getTime() - Date.now()) / 60_000
    expect(signupTokenTtlMinutes).toBeGreaterThan(10)
    expect(signupTokenTtlMinutes).toBeLessThanOrEqual(15)
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

  it('answers an expired code the same way for a taken e-mail as for a free one (D17, CA-15)', async () => {
    const h = createHarness()
    h.knownUsers.add('taken@example.com')

    // `start` never sends a code for the taken e-mail, but D17 says it still
    // creates the pending row, so both e-mails reach `verify` in the exact
    // same shape: a row with an expired OTP.
    await h.service.start('taken@example.com')
    await h.service.start('free@example.com')
    h.rows.get('taken@example.com')!.expiresAt = new Date(Date.now() - 1000)
    h.rows.get('free@example.com')!.expiresAt = new Date(Date.now() - 1000)

    const takenResult = await h.service.verify({ email: 'taken@example.com', code: '000000' }).catch((e) => e)
    const freeResult = await h.service.verify({ email: 'free@example.com', code: '000000' }).catch((e) => e)

    // Before D17, the taken e-mail had no pending row, so this would have
    // been OTP_INVALID here against OTP_EXPIRED for the free e-mail — an
    // account oracle. With the row always created, both answer the same.
    expect(takenResult).toMatchObject({ statusCode: 400, code: 'OTP_EXPIRED' })
    expect(freeResult).toMatchObject({ statusCode: 400, code: 'OTP_EXPIRED' })
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
