import type { EmailService } from '../../email/resend.js'
import { env } from '../../shared/config/env.js'
import { generateOtp, generateToken, hashToken } from '../../shared/crypto.js'
import { AppError } from '../../shared/errors.js'
import { hashPassword } from '../../shared/password.js'
import { DEFAULT_CATEGORIES } from '../categories/category.defaults.js'
import type { AuthRepository } from './auth.repository.js'
import type { TokenPair } from './auth.service.js'
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
  verify(input: { email: string; code: string }): Promise<SignupTokenDto>
  complete(input: CompleteSignupInput): Promise<TokenPair>
}

export interface SignupTokenDto {
  signupToken: string
  expiresInSeconds: number
}

export interface CompleteSignupInput {
  signupToken: string
  firstName: string
  lastName: string
  password: string
  passwordConfirmation: string
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

      // The pending row is created for every e-mail, taken or not (spec D17):
      // creating it only for free e-mails let the OTP_INVALID/OTP_EXPIRED
      // split in `verify` work as an account oracle. What "already an
      // account" controls from here on is only whether the code is sent.
      const isAccount = (await users.findUserByEmail(address)) !== undefined

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
      // time to answer (D13); a failed send is logged, not surfaced. Skipped
      // entirely for a taken e-mail (D17): the code is stored but never sent,
      // so it stays unguessable.
      if (!isAccount) dispatch(() => email.sendVerificationEmail(address, code))

      return GENERIC_START
    },

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
  }
}
