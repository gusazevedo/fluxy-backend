import type { CategoryRepository } from '../categories/category.repository.js'
import type { Transaction, TransactionKind } from '../../shared/database/schema.js'
import { AppError } from '../../shared/errors.js'
import type {
  ListTransactionsFilter,
  TransactionRepository,
  UpdateTransactionData,
} from './transaction.repository.js'

export interface TransactionDto {
  id: string
  amountCents: number
  kind: TransactionKind
  categoryId: string
  description: string | null
  occurredAt: string
  createdAt: string
}

export interface TransactionPage {
  items: TransactionDto[]
  page: { total: number; limit: number; offset: number }
}

export interface CreateTransactionInput {
  amountCents: number
  kind: TransactionKind
  categoryId: string
  occurredAt: string
  description?: string
}

export interface UpdateTransactionInput {
  amountCents?: number
  kind?: TransactionKind
  categoryId?: string
  occurredAt?: string
  description?: string | null
}

export interface TransactionServiceDeps {
  repo: TransactionRepository
  categoryRepo: CategoryRepository
}

export interface TransactionService {
  create(userId: string, input: CreateTransactionInput): Promise<TransactionDto>
  list(userId: string, filter: ListTransactionsFilter): Promise<TransactionPage>
  get(userId: string, id: string): Promise<TransactionDto>
  update(userId: string, id: string, input: UpdateTransactionInput): Promise<TransactionDto>
  remove(userId: string, id: string): Promise<void>
}

const txNotFound = (): AppError => new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found')
const invalidAmount = (): AppError => new AppError(400, 'INVALID_AMOUNT', 'amountCents must be a positive integer')
const categoryNotFound = (): AppError => new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found')
const categoryArchived = (): AppError =>
  new AppError(409, 'CATEGORY_ARCHIVED', 'Cannot use an archived category for a new transaction')
const kindMismatch = (): AppError =>
  new AppError(409, 'CATEGORY_KIND_MISMATCH', 'Category kind must match the transaction kind')

function toDto(t: Transaction): TransactionDto {
  return {
    id: t.id,
    amountCents: t.amountCents,
    kind: t.kind,
    categoryId: t.categoryId,
    description: t.description,
    occurredAt: t.occurredAt,
    createdAt: t.createdAt.toISOString(),
  }
}

export function createTransactionService(deps: TransactionServiceDeps): TransactionService {
  const { repo, categoryRepo } = deps

  return {
    async create(userId, input): Promise<TransactionDto> {
      if (input.amountCents <= 0) throw invalidAmount()
      const category = await categoryRepo.findById(userId, input.categoryId)
      if (!category) throw categoryNotFound()
      if (category.archivedAt) throw categoryArchived()
      if (category.kind !== input.kind) throw kindMismatch()

      const tx = await repo.create({
        userId,
        amountCents: input.amountCents,
        kind: input.kind,
        categoryId: input.categoryId,
        occurredAt: input.occurredAt,
        description: input.description ?? null,
      })
      return toDto(tx)
    },

    async list(userId, filter): Promise<TransactionPage> {
      const { items, total } = await repo.list(userId, filter)
      return {
        items: items.map(toDto),
        page: { total, limit: filter.limit, offset: filter.offset },
      }
    },

    async get(userId, id): Promise<TransactionDto> {
      const tx = await repo.findById(userId, id)
      if (!tx) throw txNotFound()
      return toDto(tx)
    },

    async update(userId, id, input): Promise<TransactionDto> {
      const existing = await repo.findById(userId, id)
      if (!existing) throw txNotFound()
      if (input.amountCents !== undefined && input.amountCents <= 0) throw invalidAmount()

      const nextKind = input.kind ?? existing.kind
      const nextCategoryId = input.categoryId ?? existing.categoryId
      const categoryChanged = input.categoryId !== undefined && input.categoryId !== existing.categoryId
      const kindChanged = input.kind !== undefined && input.kind !== existing.kind

      if (categoryChanged || kindChanged) {
        const category = await categoryRepo.findById(userId, nextCategoryId)
        if (!category) throw categoryNotFound()
        // Only block archived when assigning a *new* category; an existing link
        // to a category later archived stays valid (0005 §7).
        if (categoryChanged && category.archivedAt) throw categoryArchived()
        if (category.kind !== nextKind) throw kindMismatch()
      }

      const data: UpdateTransactionData = {}
      if (input.amountCents !== undefined) data.amountCents = input.amountCents
      if (input.kind !== undefined) data.kind = input.kind
      if (input.categoryId !== undefined) data.categoryId = input.categoryId
      if (input.occurredAt !== undefined) data.occurredAt = input.occurredAt
      if (input.description !== undefined) data.description = input.description

      const updated = await repo.update(id, data)
      if (!updated) throw txNotFound()
      return toDto(updated)
    },

    async remove(userId, id): Promise<void> {
      const existing = await repo.findById(userId, id)
      if (!existing) throw txNotFound()
      await repo.delete(id)
    },
  }
}
