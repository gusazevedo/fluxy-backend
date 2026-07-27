import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { env } from '../../shared/config/env.js'
import { AppError } from '../../shared/errors.js'
import { createAuthRepository } from './auth.repository.js'
import { MessageResponse, TokenPairResponse } from './auth.schema.js'
import { createSignupRepository } from './signup.repository.js'
import { createSignupService } from './signup.service.js'
import {
  SignupCompleteBody,
  SignupStartBody,
  SignupTokenResponse,
  SignupVerifyBody,
} from './signup.schema.js'

/** Postgres unique-violation code, raised by users_email_unique (RN-6). */
const UNIQUE_VIOLATION = '23505'

function hasUniqueViolationCode(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'code' in value && value.code === UNIQUE_VIOLATION
}

// drizzle-orm wraps every driver error in a `DrizzleQueryError`, moving the raw
// error (where `code` actually lives, across postgres.js, neon-http and pglite
// alike) to `.cause`. Checking only the top-level error would never match.
function isUniqueViolation(err: unknown): boolean {
  if (hasUniqueViolationCode(err)) return true
  const cause = typeof err === 'object' && err !== null && 'cause' in err ? err.cause : undefined
  return hasUniqueViolationCode(cause)
}

export const signupRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const authRepo = createAuthRepository(app.db)
  const service = createSignupService({
    repo: createSignupRepository(app.db),
    users: authRepo,
    email: app.email,
    signAccessToken: (userId) => app.jwt.sign({ sub: userId }, { expiresIn: env.ACCESS_TOKEN_TTL }),
    createRefreshToken: authRepo.createRefreshToken,
  })

  app.post(
    '/auth/signup/start',
    {
      schema: {
        tags: ['auth'],
        summary: 'Start a signup',
        description:
          'Sends a 6-digit code to the address. Always answers the same way, whether the ' +
          'e-mail is free, already an account, within the resend cooldown or over the daily ' +
          'cap. Calling it again is how a code is resent.',
        body: SignupStartBody,
        response: { 202: MessageResponse },
      },
    },
    async (request, reply) => {
      const result = await service.start(request.body.email)
      reply.code(202)
      return result
    },
  )

  app.post(
    '/auth/signup/verify',
    {
      schema: {
        tags: ['auth'],
        summary: 'Confirm the signup code',
        description:
          'Checks the 6-digit code and returns a short-lived signup token, which authorizes ' +
          'nothing but completing the signup. The code is locked after too many failed ' +
          'attempts and cannot be verified twice.',
        body: SignupVerifyBody,
        response: { 200: SignupTokenResponse },
      },
    },
    (request) => service.verify(request.body),
  )

  app.post(
    '/auth/signup/complete',
    {
      schema: {
        tags: ['auth'],
        summary: 'Complete the signup',
        description:
          'Creates the account with the given name and password, already verified, seeds the ' +
          'default categories and signs the user in.',
        body: SignupCompleteBody,
        response: { 201: TokenPairResponse },
      },
    },
    async (request, reply) => {
      try {
        const pair = await service.complete(request.body)
        reply.code(201)
        return pair
      } catch (err) {
        // The address became an account between start and complete (RN-6).
        if (isUniqueViolation(err)) {
          throw new AppError(409, 'EMAIL_IN_USE', 'E-mail already in use')
        }
        throw err
      }
    },
  )
}
