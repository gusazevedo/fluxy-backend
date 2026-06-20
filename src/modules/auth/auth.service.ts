import type { EmailService } from '../../email/resend.js'
import { env } from '../../shared/config/env.js'
import { generateToken, hashToken } from '../../shared/crypto.js'
import type { User } from '../../shared/database/schema.js'
import { AppError, unauthorized } from '../../shared/errors.js'
import { hashPassword, verifyPassword } from '../../shared/password.js'
import type { AuthRepository } from './auth.repository.js'

export interface AuthServiceDeps {
  repo: AuthRepository
  email: EmailService
  signAccessToken: (userId: string) => string
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: string
}

export interface AuthMessage {
  message: string
}

export interface MeDto {
  id: string
  email: string
  emailVerified: boolean
  createdAt: string
}

export interface AuthService {
  register(input: { email: string; password: string }): Promise<AuthMessage>
  verifyEmail(token: string): Promise<AuthMessage>
  resendVerification(email: string): Promise<AuthMessage>
  login(input: { email: string; password: string }): Promise<TokenPair>
  refresh(refreshToken: string): Promise<TokenPair>
  logout(refreshToken: string): Promise<AuthMessage>
  forgotPassword(email: string): Promise<AuthMessage>
  resetPassword(token: string, password: string): Promise<AuthMessage>
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthMessage>
  getMe(userId: string): Promise<MeDto>
}

// Generic responses so register / forgot-password don't reveal whether an
// e-mail exists (RNF-3 of 0003).
const GENERIC_REGISTER: AuthMessage = {
  message: 'If the e-mail is valid, a verification link has been sent.',
}
const GENERIC_RESET: AuthMessage = {
  message: 'If the e-mail is valid, a password reset link has been sent.',
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { repo, email, signAccessToken } = deps

  async function sendVerification(user: User): Promise<void> {
    const raw = generateToken()
    await repo.createAuthToken(user.id, hashToken(raw), 'email_verify', hoursFromNow(env.VERIFY_TOKEN_TTL_HOURS))
    await email.sendVerificationEmail(user.email, `${env.APP_URL}/verify-email?token=${raw}`)
  }

  async function issueTokens(userId: string): Promise<TokenPair> {
    const raw = generateToken()
    await repo.createRefreshToken(userId, hashToken(raw), daysFromNow(env.REFRESH_TOKEN_TTL_DAYS))
    return {
      accessToken: signAccessToken(userId),
      refreshToken: raw,
      tokenType: 'Bearer',
      expiresIn: env.ACCESS_TOKEN_TTL,
    }
  }

  return {
    async register(input): Promise<AuthMessage> {
      const emailAddr = normalizeEmail(input.email)
      const existing = await repo.findUserByEmail(emailAddr)
      if (!existing) {
        const passwordHash = await hashPassword(input.password)
        const user = await repo.createUser(emailAddr, passwordHash)
        await sendVerification(user)
      }
      return GENERIC_REGISTER
    },

    async verifyEmail(token): Promise<AuthMessage> {
      const record = await repo.findActiveAuthToken(hashToken(token), 'email_verify')
      if (!record) throw new AppError(400, 'TOKEN_INVALID', 'Invalid verification token')
      if (record.expiresAt.getTime() < Date.now()) {
        throw new AppError(400, 'TOKEN_EXPIRED', 'Verification token expired')
      }
      await repo.setEmailVerified(record.userId)
      await repo.markAuthTokenUsed(record.id)
      return { message: 'E-mail verified. You can now sign in.' }
    },

    async resendVerification(emailInput): Promise<AuthMessage> {
      const user = await repo.findUserByEmail(normalizeEmail(emailInput))
      if (user && !user.emailVerified) {
        await sendVerification(user)
      }
      return GENERIC_REGISTER
    },

    async login(input): Promise<TokenPair> {
      const user = await repo.findUserByEmail(normalizeEmail(input.email))
      const invalid = new AppError(401, 'INVALID_CREDENTIALS', 'Invalid e-mail or password')
      if (!user) {
        // Hash anyway to reduce user-enumeration timing differences.
        await hashPassword(input.password)
        throw invalid
      }
      const ok = await verifyPassword(user.passwordHash, input.password)
      if (!ok) throw invalid
      if (!user.emailVerified) {
        throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your e-mail before signing in')
      }
      return issueTokens(user.id)
    },

    async refresh(refreshToken): Promise<TokenPair> {
      const record = await repo.findRefreshTokenByHash(hashToken(refreshToken))
      if (!record) throw new AppError(401, 'TOKEN_INVALID', 'Invalid refresh token')
      if (record.revokedAt) {
        // Reuse of a rotated token: treat as compromise and drop all sessions.
        await repo.revokeAllRefreshTokens(record.userId)
        throw new AppError(401, 'TOKEN_INVALID', 'Refresh token already used')
      }
      if (record.expiresAt.getTime() < Date.now()) {
        throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token expired')
      }
      await repo.revokeRefreshToken(record.id)
      return issueTokens(record.userId)
    },

    async logout(refreshToken): Promise<AuthMessage> {
      const record = await repo.findRefreshTokenByHash(hashToken(refreshToken))
      if (record && !record.revokedAt) {
        await repo.revokeRefreshToken(record.id)
      }
      return { message: 'Signed out.' }
    },

    async forgotPassword(emailInput): Promise<AuthMessage> {
      const user = await repo.findUserByEmail(normalizeEmail(emailInput))
      if (user) {
        const raw = generateToken()
        await repo.createAuthToken(user.id, hashToken(raw), 'password_reset', hoursFromNow(env.RESET_TOKEN_TTL_HOURS))
        await email.sendPasswordResetEmail(user.email, `${env.APP_URL}/reset-password?token=${raw}`)
      }
      return GENERIC_RESET
    },

    async resetPassword(token, password): Promise<AuthMessage> {
      const record = await repo.findActiveAuthToken(hashToken(token), 'password_reset')
      if (!record) throw new AppError(400, 'TOKEN_INVALID', 'Invalid reset token')
      if (record.expiresAt.getTime() < Date.now()) {
        throw new AppError(400, 'TOKEN_EXPIRED', 'Reset token expired')
      }
      await repo.updatePassword(record.userId, await hashPassword(password))
      await repo.markAuthTokenUsed(record.id)
      await repo.revokeAllRefreshTokens(record.userId)
      return { message: 'Password updated. Please sign in again.' }
    },

    async changePassword(userId, currentPassword, newPassword): Promise<AuthMessage> {
      const user = await repo.findUserById(userId)
      if (!user) throw unauthorized()
      const ok = await verifyPassword(user.passwordHash, currentPassword)
      if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect')
      await repo.updatePassword(userId, await hashPassword(newPassword))
      await repo.revokeAllRefreshTokens(userId)
      return { message: 'Password changed. Please sign in again.' }
    },

    async getMe(userId): Promise<MeDto> {
      const user = await repo.findUserById(userId)
      if (!user) throw unauthorized()
      return {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
      }
    },
  }
}
