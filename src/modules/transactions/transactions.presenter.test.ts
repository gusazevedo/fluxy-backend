import { describe, it, expect } from 'vitest'
import { toTransactionResponse } from './transactions.presenter.js'
import type { Transaction } from '../../shared/database/schema.js'

const row: Transaction = {
  id: 'tx-1',
  userId: 'user-secret',
  title: 'Lunch',
  value: '42.50',
  type: 'outcome',
  category: 'Food',
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-01-03T03:04:05.000Z'),
}

describe('toTransactionResponse', () => {
  it('never leaks internal userId', () => {
    expect('userId' in toTransactionResponse(row)).toBe(false)
  })

  it('converts the numeric (string) value to a number', () => {
    const out = toTransactionResponse(row)
    expect(out.value).toBe(42.5)
    expect(typeof out.value).toBe('number')
  })

  it('maps timestamps to snake_case ISO strings', () => {
    const out = toTransactionResponse(row)
    expect(out.created_at).toBe('2026-01-02T03:04:05.000Z')
    expect(out.updated_at).toBe('2026-01-03T03:04:05.000Z')
  })

  it('exposes exactly the documented contract fields', () => {
    expect(Object.keys(toTransactionResponse(row)).sort()).toEqual([
      'category',
      'created_at',
      'id',
      'title',
      'type',
      'updated_at',
      'value',
    ])
  })
})
