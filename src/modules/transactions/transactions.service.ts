import { AppError } from '../../shared/errors/app-error.js'
import type { Transaction } from '../../shared/database/schema.js'
import type { ITransactionRepository, TransactionFilters } from './transactions.repository.js'

export interface CreateTransactionDTO {
  title: string
  value: number
  type: 'income' | 'outcome'
  category: string
}

export interface UpdateTransactionDTO {
  title?: string
  value?: number
  type?: 'income' | 'outcome'
  category?: string
}

export interface ITransactionService {
  list(userId: string, filters: TransactionFilters): Promise<Transaction[]>
  create(userId: string, data: CreateTransactionDTO): Promise<Transaction>
  update(userId: string, id: string, data: UpdateTransactionDTO): Promise<Transaction>
  delete(userId: string, id: string): Promise<void>
}

export class TransactionService implements ITransactionService {
  constructor(private readonly repository: ITransactionRepository) {}

  async list(userId: string, filters: TransactionFilters): Promise<Transaction[]> {
    return this.repository.findAllByUser(userId, filters)
  }

  async create(userId: string, data: CreateTransactionDTO): Promise<Transaction> {
    return this.repository.create({
      userId,
      title: data.title,
      value: String(data.value),
      type: data.type,
      category: data.category as Transaction['category'],
    })
  }

  async update(userId: string, id: string, data: UpdateTransactionDTO): Promise<Transaction> {
    const patch: Record<string, unknown> = {}

    if (data.title !== undefined) patch.title = data.title
    if (data.value !== undefined) patch.value = String(data.value)
    if (data.type !== undefined) patch.type = data.type
    if (data.category !== undefined) patch.category = data.category

    const updated = await this.repository.update(id, userId, patch)

    if (!updated) {
      throw new AppError('NOT_FOUND', 'Transaction not found', 404)
    }

    return updated
  }

  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(id, userId)

    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Transaction not found', 404)
    }
  }
}
