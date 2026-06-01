import Fastify from 'fastify'
import { errorHandler } from './shared/errors/error-handler.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { transactionRoutes } from './modules/transactions/transactions.routes.js'
import { summaryRoutes } from './modules/summary/summary.routes.js'

export function buildApp(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: true })

  app.setErrorHandler(errorHandler)

  app.register(authRoutes, { prefix: '/auth' })
  app.register(transactionRoutes, { prefix: '/transactions' })
  app.register(summaryRoutes, { prefix: '/summary' })

  return app
}
