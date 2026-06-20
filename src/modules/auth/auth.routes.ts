import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { env } from '../../shared/config/env.js'
import { createAuthRepository } from './auth.repository.js'
import { createAuthService } from './auth.service.js'
import {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  LogoutBody,
  MeResponse,
  MessageResponse,
  RefreshBody,
  RegisterBody,
  ResendVerificationBody,
  ResetPasswordBody,
  TokenPairResponse,
  VerifyEmailBody,
} from './auth.schema.js'

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const service = createAuthService({
    repo: createAuthRepository(app.db),
    email: app.email,
    signAccessToken: (userId) => app.jwt.sign({ sub: userId }, { expiresIn: env.ACCESS_TOKEN_TTL }),
  })

  app.post(
    '/auth/register',
    { schema: { tags: ['auth'], summary: 'Create an account', body: RegisterBody, response: { 201: MessageResponse } } },
    async (request, reply) => {
      const result = await service.register(request.body)
      reply.code(201)
      return result
    },
  )

  app.post(
    '/auth/verify-email',
    { schema: { tags: ['auth'], summary: 'Confirm e-mail', body: VerifyEmailBody, response: { 200: MessageResponse } } },
    (request) => service.verifyEmail(request.body.token),
  )

  app.post(
    '/auth/verify-email/resend',
    { schema: { tags: ['auth'], summary: 'Resend verification', body: ResendVerificationBody, response: { 200: MessageResponse } } },
    (request) => service.resendVerification(request.body.email),
  )

  app.post(
    '/auth/login',
    { schema: { tags: ['auth'], summary: 'Sign in', body: LoginBody, response: { 200: TokenPairResponse } } },
    (request) => service.login(request.body),
  )

  app.post(
    '/auth/refresh',
    { schema: { tags: ['auth'], summary: 'Rotate tokens', body: RefreshBody, response: { 200: TokenPairResponse } } },
    (request) => service.refresh(request.body.refreshToken),
  )

  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], summary: 'Sign out', body: LogoutBody, response: { 200: MessageResponse } } },
    (request) => service.logout(request.body.refreshToken),
  )

  app.post(
    '/auth/forgot-password',
    { schema: { tags: ['auth'], summary: 'Request password reset', body: ForgotPasswordBody, response: { 200: MessageResponse } } },
    (request) => service.forgotPassword(request.body.email),
  )

  app.post(
    '/auth/reset-password',
    { schema: { tags: ['auth'], summary: 'Reset password', body: ResetPasswordBody, response: { 200: MessageResponse } } },
    (request) => service.resetPassword(request.body.token, request.body.password),
  )

  app.post(
    '/auth/change-password',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Change password',
        security: [{ bearerAuth: [] }],
        body: ChangePasswordBody,
        response: { 200: MessageResponse },
      },
    },
    (request) =>
      service.changePassword(request.user.sub, request.body.currentPassword, request.body.newPassword),
  )

  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Current account',
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponse },
      },
    },
    (request) => service.getMe(request.user.sub),
  )
}
