import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from './app-error.js'

export function errorHandler(
  error: FastifyError | AppError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({ code: error.code, message: error.message })
    return
  }

  // Fastify validation errors
  if ('statusCode' in error && error.statusCode === 400) {
    reply.status(422).send({ code: 'VALIDATION_ERROR', message: error.message })
    return
  }

  reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Internal server error' })
}
