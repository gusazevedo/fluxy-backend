import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fp from 'fastify-plugin'
import { env, isLocal } from '../config/env.js'

/**
 * Baseline HTTP hardening: security headers, CORS for the web app origin, and a
 * coarse rate limit.
 *
 * Note: the rate limiter uses an in-memory store, so on Lambda each warm
 * container counts independently — fine as a basic abuse guard (0002/D2).
 */
export const securityPlugin = fp(
  async (app): Promise<void> => {
    await app.register(helmet, {
      // Swagger UI needs inline styles/scripts to render.
      contentSecurityPolicy: false,
    })

    await app.register(cors, {
      origin: isLocal ? true : [env.APP_URL],
      credentials: true,
    })

    await app.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    })
  },
  { name: 'security' },
)
