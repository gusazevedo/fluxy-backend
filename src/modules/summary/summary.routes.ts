import type { FastifyInstance } from 'fastify'
import { SummaryController } from './summary.controller.js'
import { SummaryService } from './summary.service.js'
import { authenticate } from '../../shared/middlewares/auth.middleware.js'

const TYPES = ['income', 'outcome'] as const
const CATEGORIES = ['Bills', 'Health', 'Gym', 'Subscriptions', 'Food', 'Entertainment', 'Transport', 'Salary'] as const

const balanceSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['income', 'outcome', 'balance'],
      properties: {
        income: { type: 'number' },
        outcome: { type: 'number' },
        balance: { type: 'number' },
      },
    },
  },
} as const

const byCategorySchema = {
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'type', 'total'],
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          type: { type: 'string', enum: TYPES },
          total: { type: 'number' },
        },
      },
    },
  },
} as const

export async function summaryRoutes(fastify: FastifyInstance): Promise<void> {
  const controller = new SummaryController(new SummaryService())

  fastify.addHook('preHandler', authenticate)

  fastify.get('/balance', { schema: balanceSchema }, controller.getBalance.bind(controller))
  fastify.get('/by-category', { schema: byCategorySchema }, controller.getByCategory.bind(controller))
}
