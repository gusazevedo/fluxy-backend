import jwt from '@fastify/jwt'
import type { FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { getJwtSecret } from '../secrets.js'
import { unauthorized } from '../errors.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string }
    user: { sub: string }
  }
}

/**
 * Registers @fastify/jwt with the signing secret and exposes an `authenticate`
 * decorator (onRequest hook) that verifies the access token and populates
 * `request.user`.
 */
export const authPlugin = fp(
  async (app): Promise<void> => {
    const secret = await getJwtSecret()
    await app.register(jwt, { secret })

    app.decorate('authenticate', async (request: FastifyRequest): Promise<void> => {
      try {
        await request.jwtVerify()
      } catch {
        throw unauthorized('Invalid or missing access token')
      }
    })
  },
  { name: 'auth' },
)
