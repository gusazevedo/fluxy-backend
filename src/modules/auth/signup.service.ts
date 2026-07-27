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
