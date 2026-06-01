import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ISummaryService } from './summary.service.js'

export class SummaryController {
  constructor(private readonly service: ISummaryService) {}

  async getBalance(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const balance = await this.service.getBalance(_request.user.id)
    reply.send(balance)
  }

  async getByCategory(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const categories = await this.service.getByCategory(request.user.id)
    reply.send(categories)
  }
}
