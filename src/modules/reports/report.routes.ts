import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { createReportRepository } from './report.repository.js'
import { createReportService } from './report.service.js'
import { SummaryQuery, SummaryResponse } from './report.schema.js'

export const reportRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const service = createReportService(createReportRepository(app.db))

  app.get(
    '/reports/summary',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['reports'],
        summary: 'Income/expense totals, balance and per-category breakdown for a period',
        security: [{ bearerAuth: [] }],
        querystring: SummaryQuery,
        response: { 200: SummaryResponse },
      },
    },
    (request) => service.summary(request.user.sub, { from: request.query.from, to: request.query.to }),
  )
}
