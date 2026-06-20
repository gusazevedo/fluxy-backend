import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { createCategoryRepository } from '../categories/category.repository.js'
import { createTransactionRepository } from './transaction.repository.js'
import { createTransactionService } from './transaction.service.js'
import {
  CreateTransactionBody,
  ListTransactionsQuery,
  TransactionListResponse,
  TransactionParams,
  TransactionResponse,
  UpdateTransactionBody,
} from './transaction.schema.js'

const DEFAULT_LIMIT = 20

export const transactionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const service = createTransactionService({
    repo: createTransactionRepository(app.db),
    categoryRepo: createCategoryRepository(app.db),
  })

  app.get(
    '/transactions',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['transactions'],
        summary: 'List transactions',
        security: [{ bearerAuth: [] }],
        querystring: ListTransactionsQuery,
        response: { 200: TransactionListResponse },
      },
    },
    (request) =>
      service.list(request.user.sub, {
        from: request.query.from,
        to: request.query.to,
        categoryId: request.query.categoryId,
        kind: request.query.kind,
        limit: request.query.limit ?? DEFAULT_LIMIT,
        offset: request.query.offset ?? 0,
      }),
  )

  app.post(
    '/transactions',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['transactions'],
        summary: 'Create a transaction',
        security: [{ bearerAuth: [] }],
        body: CreateTransactionBody,
        response: { 201: TransactionResponse },
      },
    },
    async (request, reply) => {
      const tx = await service.create(request.user.sub, request.body)
      reply.code(201)
      return tx
    },
  )

  app.get(
    '/transactions/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['transactions'],
        summary: 'Get a transaction',
        security: [{ bearerAuth: [] }],
        params: TransactionParams,
        response: { 200: TransactionResponse },
      },
    },
    (request) => service.get(request.user.sub, request.params.id),
  )

  app.patch(
    '/transactions/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['transactions'],
        summary: 'Update a transaction',
        security: [{ bearerAuth: [] }],
        params: TransactionParams,
        body: UpdateTransactionBody,
        response: { 200: TransactionResponse },
      },
    },
    (request) => service.update(request.user.sub, request.params.id, request.body),
  )

  app.delete(
    '/transactions/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['transactions'],
        summary: 'Delete a transaction',
        security: [{ bearerAuth: [] }],
        params: TransactionParams,
      },
    },
    async (request, reply) => {
      await service.remove(request.user.sub, request.params.id)
      return reply.code(204).send()
    },
  )
}
