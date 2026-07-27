import { describe, expect, it } from 'vitest'
import type { User } from '../../shared/database/schema.js'
import { hashPassword } from '../../shared/password.js'
import { createAuthService } from './auth.service.js'
import type { AuthRepository } from './auth.repository.js'

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date()
  return {
    id: 'user-1',
    email: 'unverified@example.com',
    firstName: 'Ana',
    lastName: 'Silva',
    passwordHash: '',
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * Fake `AuthRepository` where every method fails loudly unless overridden.
 * Keeps each test's harness to only the calls it actually expects, instead of
 * hiding an unexpected repo call behind a no-op.
 */
function unimplementedRepo(): AuthRepository {
  const fail =
    (name: string) =>
    (...args: unknown[]) => {
      throw new Error(`unexpected repo call: ${name}(${args.map(String).join(', ')})`)
    }
  return {
    findUserByEmail: fail('findUserByEmail') as AuthRepository['findUserByEmail'],
    findUserById: fail('findUserById') as AuthRepository['findUserById'],
    createUser: fail('createUser') as AuthRepository['createUser'],
    updatePassword: fail('updatePassword') as AuthRepository['updatePassword'],
    createAuthToken: fail('createAuthToken') as AuthRepository['createAuthToken'],
    findActiveAuthToken: fail('findActiveAuthToken') as AuthRepository['findActiveAuthToken'],
    markAuthTokenUsed: fail('markAuthTokenUsed') as AuthRepository['markAuthTokenUsed'],
    createRefreshToken: fail('createRefreshToken') as AuthRepository['createRefreshToken'],
    findRefreshTokenByHash: fail('findRefreshTokenByHash') as AuthRepository['findRefreshTokenByHash'],
    revokeRefreshToken: fail('revokeRefreshToken') as AuthRepository['revokeRefreshToken'],
    revokeAllRefreshTokens: fail('revokeAllRefreshTokens') as AuthRepository['revokeAllRefreshTokens'],
  }
}

describe('AuthService.login', () => {
  // Every account is born verified via signup/complete, so this branch is
  // unreachable through the HTTP API today. RN-5 keeps it anyway as defense in
  // depth, which is exactly why it needs its own test: nothing else would go
  // red if it were deleted in a future refactor.
  it('rejects an account with an unverified e-mail with 403 EMAIL_NOT_VERIFIED (RN-5)', async () => {
    const password = 'password123'
    const user = makeUser({ passwordHash: await hashPassword(password), emailVerified: false })

    const repo = unimplementedRepo()
    repo.findUserByEmail = async (email) => (email === user.email ? user : undefined)

    const service = createAuthService({
      repo,
      email: {
        sendVerificationEmail: async () => {
          throw new Error('unexpected call: sendVerificationEmail')
        },
        sendPasswordResetEmail: async () => {
          throw new Error('unexpected call: sendPasswordResetEmail')
        },
      },
      signAccessToken: () => {
        throw new Error('unexpected call: signAccessToken')
      },
    })

    await expect(service.login({ email: user.email, password })).rejects.toMatchObject({
      statusCode: 403,
      code: 'EMAIL_NOT_VERIFIED',
    })
  })
})
