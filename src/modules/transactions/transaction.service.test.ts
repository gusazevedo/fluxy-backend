import { describe, expect, it, vi } from 'vitest'
import type { Category, Transaction } from '../../shared/database/schema.js'
import type { CategoryRepository } from '../categories/category.repository.js'
import type { TransactionRepository } from './transaction.repository.js'
import { createTransactionService } from './transaction.service.js'

function makeCategory(over: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    userId: 'user-1',
    name: 'Alimentação',
    kind: 'expense',
    archivedAt: null,
    createdAt: new Date('2026-06-20T00:00:00Z'),
    updatedAt: new Date('2026-06-20T00:00:00Z'),
    ...over,
  }
}

function makeTransaction(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    userId: 'user-1',
    categoryId: 'cat-1',
    amountCents: 1500,
    kind: 'expense',
    description: null,
    occurredAt: '2026-06-20',
    createdAt: new Date('2026-06-20T00:00:00Z'),
    updatedAt: new Date('2026-06-20T00:00:00Z'),
    ...over,
  }
}

function makeTxRepo(over: Partial<TransactionRepository> = {}): TransactionRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    existsForCategory: vi.fn(),
    ...over,
  }
}

function makeCatRepo(over: Partial<CategoryRepository> = {}): CategoryRepository {
  return {
    create: vi.fn(),
    insertMany: vi.fn(),
    findById: vi.fn(),
    findActiveByName: vi.fn(),
    list: vi.fn(),
    updateName: vi.fn(),
    archive: vi.fn(),
    hardDelete: vi.fn(),
    ...over,
  }
}

const baseInput = { amountCents: 1500, kind: 'expense' as const, categoryId: 'cat-1', occurredAt: '2026-06-20' }

describe('transaction service', () => {
  it('rejects a non-positive amount', async () => {
    const service = createTransactionService({ repo: makeTxRepo(), categoryRepo: makeCatRepo() })
    await expect(service.create('user-1', { ...baseInput, amountCents: 0 })).rejects.toMatchObject({
      code: 'INVALID_AMOUNT',
    })
  })

  it('rejects a missing category', async () => {
    const service = createTransactionService({
      repo: makeTxRepo(),
      categoryRepo: makeCatRepo({ findById: vi.fn().mockResolvedValue(undefined) }),
    })
    await expect(service.create('user-1', baseInput)).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
  })

  it('rejects an archived category', async () => {
    const service = createTransactionService({
      repo: makeTxRepo(),
      categoryRepo: makeCatRepo({ findById: vi.fn().mockResolvedValue(makeCategory({ archivedAt: new Date() })) }),
    })
    await expect(service.create('user-1', baseInput)).rejects.toMatchObject({ code: 'CATEGORY_ARCHIVED' })
  })

  it('rejects a category of a different kind', async () => {
    const service = createTransactionService({
      repo: makeTxRepo(),
      categoryRepo: makeCatRepo({ findById: vi.fn().mockResolvedValue(makeCategory({ kind: 'income' })) }),
    })
    await expect(service.create('user-1', baseInput)).rejects.toMatchObject({ code: 'CATEGORY_KIND_MISMATCH' })
  })

  it('creates a valid transaction', async () => {
    const created = makeTransaction({ amountCents: 1500 })
    const service = createTransactionService({
      repo: makeTxRepo({ create: vi.fn().mockResolvedValue(created) }),
      categoryRepo: makeCatRepo({ findById: vi.fn().mockResolvedValue(makeCategory()) }),
    })
    const dto = await service.create('user-1', baseInput)
    expect(dto).toMatchObject({ amountCents: 1500, kind: 'expense', categoryId: 'cat-1' })
  })

  it('404s when updating a missing transaction', async () => {
    const service = createTransactionService({
      repo: makeTxRepo({ findById: vi.fn().mockResolvedValue(undefined) }),
      categoryRepo: makeCatRepo(),
    })
    await expect(service.update('user-1', 'tx-1', { amountCents: 500 })).rejects.toMatchObject({
      code: 'TRANSACTION_NOT_FOUND',
    })
  })
})
