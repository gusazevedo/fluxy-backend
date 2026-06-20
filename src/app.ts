import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify, { type FastifyInstance } from 'fastify'
import { env } from './shared/config/env.js'
import { errorHandlerPlugin } from './shared/plugins/error-handler.js'
import { securityPlugin } from './shared/plugins/security.js'
import { swaggerPlugin } from './shared/plugins/swagger.js'

export interface BuildAppOptions {
  /** Override the logger config (tests pass `false` to silence output). */
  logger?: boolean | object
}

/**
 * Builds the Fastify application. The same instance is served as a normal HTTP
 * server in local dev (`server.ts`) and wrapped as a Lambda handler in deployed
 * stages (`lambda.ts`).
 *
 * Feature modules (auth, categories, transactions, reports) register their
 * routes here as they are implemented in later specs.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: env.LOG_LEVEL },
  }).withTypeProvider<TypeBoxTypeProvider>()

  await app.register(errorHandlerPlugin)
  await app.register(securityPlugin)
  await app.register(swaggerPlugin)

  app.get(
    '/health',
    {
      schema: {
        tags: ['infra'],
        summary: 'Liveness probe',
        response: {
          200: Type.Object({
            status: Type.String(),
            stage: Type.String(),
            timestamp: Type.String(),
          }),
        },
      },
    },
    async (): Promise<{ status: string; stage: string; timestamp: string }> => ({
      status: 'ok',
      stage: env.STAGE,
      timestamp: new Date().toISOString(),
    }),
  )

  await app.ready()
  return app
}
