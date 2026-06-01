import type { FastifyInstance } from 'fastify'
import { TransactionController } from './transactions.controller.js'
import { TransactionService } from './transactions.service.js'
import { TransactionRepository } from './transactions.repository.js'
import {
  listTransactionsSchema,
  createTransactionSchema,
  updateTransactionSchema,
  deleteTransactionSchema,
} from './transactions.schema.js'
import { authenticate } from '../../shared/middlewares/auth.middleware.js'

export async function transactionRoutes(fastify: FastifyInstance): Promise<void> {
  const controller = new TransactionController(new TransactionService(new TransactionRepository()))

  fastify.addHook('preHandler', authenticate)

  fastify.get(
    '/',
    { schema: listTransactionsSchema },
    controller.list.bind(controller)
  )
  fastify.post(
    '/',
    { schema: createTransactionSchema },
    controller.create.bind(controller)
  )
  fastify.put(
    '/:id',
    { schema: updateTransactionSchema },
    controller.update.bind(controller)
  )
  fastify.delete(
    '/:id',
    { schema: deleteTransactionSchema },
    controller.delete.bind(controller)
  )
}
