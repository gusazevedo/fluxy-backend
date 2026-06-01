import type { FastifyInstance } from 'fastify'
import { SummaryController } from './summary.controller.js'
import { SummaryService } from './summary.service.js'
import { authenticate } from '../../shared/middlewares/auth.middleware.js'

export async function summaryRoutes(fastify: FastifyInstance): Promise<void> {
  const controller = new SummaryController(new SummaryService())

  fastify.addHook('preHandler', authenticate)

  fastify.get('/balance', controller.getBalance.bind(controller))
  fastify.get('/by-category', controller.getByCategory.bind(controller))
}
