import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ITransactionService } from './transactions.service.js'
import { toTransactionResponse } from './transactions.presenter.js'

interface ListQuery {
  type?: 'income' | 'outcome'
  category?: string
}

interface CreateBody {
  title: string
  value: number
  type: 'income' | 'outcome'
  category: string
}

interface UpdateBody {
  title?: string
  value?: number
  type?: 'income' | 'outcome'
  category?: string
}

interface IdParams {
  id: string
}

export class TransactionController {
  constructor(private readonly service: ITransactionService) {}

  async list(
    request: FastifyRequest<{ Querystring: ListQuery }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { type, category } = request.query
    const transactions = await this.service.list(request.user.id, { type, category })
    reply.send(transactions.map(toTransactionResponse))
  }

  async create(
    request: FastifyRequest<{ Body: CreateBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const transaction = await this.service.create(request.user.id, request.body)
    reply.status(201).send(toTransactionResponse(transaction))
  }

  async update(
    request: FastifyRequest<{ Params: IdParams; Body: UpdateBody }>,
    reply: FastifyReply,
  ): Promise<void> {
    const transaction = await this.service.update(request.user.id, request.params.id, request.body)
    reply.send(toTransactionResponse(transaction))
  }

  async delete(
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> {
    await this.service.delete(request.user.id, request.params.id)
    reply.status(204).send()
  }
}
