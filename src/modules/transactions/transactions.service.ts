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

const SALARY_CATEGORY = 'Salary'

export class TransactionService implements ITransactionService {
  constructor(private readonly repository: ITransactionRepository) {}

  async list(userId: string, filters: TransactionFilters): Promise<Transaction[]> {
    return this.repository.findAllByUser(userId, filters)
  }

  async create(userId: string, data: CreateTransactionDTO): Promise<Transaction> {
    this.assertCategoryMatchesType(data.type, data.category)

    return this.repository.create({
      userId,
      title: data.title,
      value: String(data.value),
      type: data.type,
      category: data.category as Transaction['category'],
    })
  }

  async update(userId: string, id: string, data: UpdateTransactionDTO): Promise<Transaction> {
    const existing = await this.repository.findByIdAndUser(id, userId)

    if (!existing) {
      throw new AppError('NOT_FOUND', 'Transaction not found', 404)
    }

    const type = data.type ?? existing.type
    const category = data.category ?? existing.category
    this.assertCategoryMatchesType(type, category)

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

  private assertCategoryMatchesType(type: 'income' | 'outcome', category: string): void {
    if (type === 'income' && category !== SALARY_CATEGORY) {
      throw new AppError(
        'INVALID_CATEGORY',
        `Income transactions must use the "${SALARY_CATEGORY}" category`,
        422,
      )
    }

    if (type === 'outcome' && category === SALARY_CATEGORY) {
      throw new AppError(
        'INVALID_CATEGORY',
        `The "${SALARY_CATEGORY}" category can only be used for income transactions`,
        422,
      )
    }
  }

  async delete(userId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(id, userId)

    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Transaction not found', 404)
    }
  }
}
