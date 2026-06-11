import type { FastifyInstance } from 'fastify'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { socialLoginSchema } from './auth.schema.js'

// Auth endpoints are unauthenticated and security-sensitive, so they get a
// tighter rate limit than the global default.
const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const controller = new AuthController(new AuthService())

  fastify.post(
    '/google',
    { ...authRateLimit, schema: socialLoginSchema },
    controller.loginWithGoogle.bind(controller),
  )
  fastify.post(
    '/apple',
    { ...authRateLimit, schema: socialLoginSchema },
    controller.loginWithApple.bind(controller),
  )
}
