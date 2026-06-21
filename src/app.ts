import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify, { type FastifyInstance } from 'fastify'
import { createEmailService, type EmailService } from './email/resend.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { categoryRoutes } from './modules/categories/category.routes.js'
import { reportRoutes } from './modules/reports/report.routes.js'
import { transactionRoutes } from './modules/transactions/transaction.routes.js'
import { env } from './shared/config/env.js'
import { createDb, type Database } from './shared/database/client.js'
import { authPlugin } from './shared/plugins/auth.js'
import { errorHandlerPlugin } from './shared/plugins/error-handler.js'
import { securityPlugin } from './shared/plugins/security.js'
import { swaggerPlugin } from './shared/plugins/swagger.js'

export interface BuildAppOptions {
  /** Override the logger config (tests pass `false` to silence output). */
  logger?: boolean | object
  /** Inject a database (tests pass a pglite-backed instance). */
  db?: Database
  /** Inject an e-mail service (tests pass a capturing fake). */
  email?: EmailService
}

/**
 * Builds the Fastify application. The same instance is served as a normal HTTP
 * server in local dev (`server.ts`) and wrapped as a Lambda handler in deployed
 * stages (`lambda.ts`).
 *
 * Feature modules register their routes here as they are implemented; this spec
 * (0003) adds authentication & accounts.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: env.LOG_LEVEL },
  }).withTypeProvider<TypeBoxTypeProvider>()

  app.decorate('db', opts.db ?? createDb())
  app.decorate('email', opts.email ?? (await createEmailService()))

  await app.register(errorHandlerPlugin)
  await app.register(securityPlugin)
  await app.register(swaggerPlugin)
  await app.register(authPlugin)

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

  await app.register(authRoutes)
  await app.register(categoryRoutes)
  await app.register(transactionRoutes)
  await app.register(reportRoutes)

  await app.ready()
  return app
}
