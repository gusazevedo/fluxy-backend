import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TransactionService } from './transactions.service.js'
import type { ITransactionRepository } from './transactions.repository.js'
import type { Transaction } from '../../shared/database/schema.js'

function makeRepo(): ITransactionRepository {
  return {
    findAllByUser: vi.fn(),
    findByIdAndUser: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
}

const incomeRow: Transaction = {
  id: 'tx-1',
  userId: 'u1',
  title: 'Paycheck',
  value: '1000.00',
  type: 'income',
  category: 'Salary',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

let repo: ITransactionRepository
let service: TransactionService

beforeEach(() => {
  repo = makeRepo()
  service = new TransactionService(repo)
})

describe('TransactionService.list', () => {
  it('forwards userId and filters to the repository', async () => {
    vi.mocked(repo.findAllByUser).mockResolvedValue([incomeRow])
    const result = await service.list('u1', { type: 'income' })
    expect(repo.findAllByUser).toHaveBeenCalledWith('u1', { type: 'income' })
    expect(result).toEqual([incomeRow])
  })
})

describe('TransactionService.create — Salary rule', () => {
  it('rejects income with a non-Salary category', async () => {
    await expect(
      service.create('u1', { title: 'x', value: 10, type: 'income', category: 'Food' }),
    ).rejects.toMatchObject({ code: 'INVALID_CATEGORY', statusCode: 422 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('rejects outcome with the Salary category', async () => {
    await expect(
      service.create('u1', { title: 'x', value: 10, type: 'outcome', category: 'Salary' }),
    ).rejects.toMatchObject({ code: 'INVALID_CATEGORY', statusCode: 422 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('persists a valid income, stringifying value and threading userId', async () => {
    vi.mocked(repo.create).mockResolvedValue(incomeRow)
    const result = await service.create('u1', {
      title: 'Paycheck',
      value: 1000,
      type: 'income',
      category: 'Salary',
    })
    expect(repo.create).toHaveBeenCalledWith({
      userId: 'u1',
      title: 'Paycheck',
      value: '1000',
      type: 'income',
      category: 'Salary',
    })
    expect(result).toBe(incomeRow)
  })
})

describe('TransactionService.update', () => {
  it('throws NOT_FOUND when the transaction does not belong to the user', async () => {
    vi.mocked(repo.findByIdAndUser).mockResolvedValue(undefined)
    await expect(service.update('u1', 'tx-1', { value: 5 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    })
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('builds a partial patch with only provided fields (value stringified)', async () => {
    vi.mocked(repo.findByIdAndUser).mockResolvedValue(incomeRow)
    vi.mocked(repo.update).mockResolvedValue({ ...incomeRow, value: '50.00' })
    await service.update('u1', 'tx-1', { value: 50 })
    expect(repo.update).toHaveBeenCalledWith('tx-1', 'u1', { value: '50' })
  })

  it('applies the Salary rule against the merged type/category', async () => {
    // existing is income/Salary; switching type to outcome while keeping Salary is invalid
    vi.mocked(repo.findByIdAndUser).mockResolvedValue(incomeRow)
    await expect(service.update('u1', 'tx-1', { type: 'outcome' })).rejects.toMatchObject({
      code: 'INVALID_CATEGORY',
      statusCode: 422,
    })
    expect(repo.update).not.toHaveBeenCalled()
  })
})

describe('TransactionService.delete', () => {
  it('throws NOT_FOUND when nothing was deleted', async () => {
    vi.mocked(repo.delete).mockResolvedValue(false)
    await expect(service.delete('u1', 'tx-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    })
  })

  it('resolves when a row was deleted', async () => {
    vi.mocked(repo.delete).mockResolvedValue(true)
    await expect(service.delete('u1', 'tx-1')).resolves.toBeUndefined()
    expect(repo.delete).toHaveBeenCalledWith('tx-1', 'u1')
  })
})
