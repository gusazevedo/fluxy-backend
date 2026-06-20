import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { AppError } from '../errors.js'

interface ErrorBody {
  statusCode: number
  code: string
  message: string
  details?: unknown
}

function send(reply: FastifyReply, body: ErrorBody): FastifyReply {
  return reply.status(body.statusCode).send({ error: body })
}

/**
 * Centralized error handling: maps validation errors, domain `AppError`s and
 * uncaught failures to a consistent `{ error: { code, message } }` envelope.
 */
export const errorHandlerPlugin = fp(
  async (app): Promise<void> => {
    app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply): FastifyReply =>
      send(reply, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      }),
    )

    app.setErrorHandler(
      (error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply => {
        // Schema validation failures raised by Fastify/TypeBox.
        if (error.validation) {
          return send(reply, {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: error.validation,
          })
        }

        if (error instanceof AppError) {
          return send(reply, {
            statusCode: error.statusCode,
            code: error.code,
            message: error.message,
            details: error.details,
          })
        }

        // Plugins such as rate-limit set a client-side statusCode on their errors.
        if (typeof error.statusCode === 'number' && error.statusCode < 500) {
          return send(reply, {
            statusCode: error.statusCode,
            code: error.code ?? 'ERROR',
            message: error.message,
          })
        }

        request.log.error({ err: error }, 'Unhandled error')
        return send(reply, {
          statusCode: 500,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        })
      },
    )
  },
  { name: 'error-handler' },
)
