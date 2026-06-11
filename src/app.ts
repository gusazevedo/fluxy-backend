import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { parse } from 'yaml'
import type { OpenAPIV3 } from 'openapi-types'
import { errorHandler } from './shared/errors/error-handler.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { transactionRoutes } from './modules/transactions/transactions.routes.js'
import { summaryRoutes } from './modules/summary/summary.routes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const specPath = resolve(__dirname, '../spec/openapi.yaml')
const openApiSpec = parse(readFileSync(specPath, 'utf-8')) as unknown as OpenAPIV3.Document

const isProduction = process.env.NODE_ENV === 'production'

export function buildApp(): ReturnType<typeof Fastify> {
  const app = Fastify({ logger: true })

  app.register(helmet)
  app.register(cors, { origin: true })
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' })

  // API docs are only exposed outside production.
  if (!isProduction) {
    app.register(swagger, {
      mode: 'static',
      specification: { document: openApiSpec },
    })

    app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    })
  }

  app.setErrorHandler(errorHandler)

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Route not found' })
  })

  app.register(authRoutes, { prefix: '/auth' })
  app.register(transactionRoutes, { prefix: '/transactions' })
  app.register(summaryRoutes, { prefix: '/summary' })

  return app
}
