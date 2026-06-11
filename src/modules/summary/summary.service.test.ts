import { describe, it, expect, vi, beforeEach } from 'vitest'

// The summary service queries drizzle's `db` directly. Mock the terminal
// `groupBy` of the select chain to return canned aggregation rows.
const { mockGroupBy } = vi.hoisted(() => ({ mockGroupBy: vi.fn() }))

vi.mock('../../shared/database/drizzle.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ groupBy: mockGroupBy }) }) }),
  },
}))

const { SummaryService } = await import('./summary.service.js')

let service: InstanceType<typeof SummaryService>

beforeEach(() => {
  mockGroupBy.mockReset()
  service = new SummaryService()
})

describe('SummaryService.getBalance', () => {
  it('sums income and outcome and computes the net balance', async () => {
    mockGroupBy.mockResolvedValue([
      { type: 'income', total: '1000.00' },
      { type: 'outcome', total: '300.50' },
    ])
    expect(await service.getBalance('u1')).toEqual({
      income: 1000,
      outcome: 300.5,
      balance: 699.5,
    })
  })

  it('returns zeros when there are no transactions', async () => {
    mockGroupBy.mockResolvedValue([])
    expect(await service.getBalance('u1')).toEqual({ income: 0, outcome: 0, balance: 0 })
  })
})

describe('SummaryService.getByCategory', () => {
  it('maps rows converting total to a number', async () => {
    mockGroupBy.mockResolvedValue([
      { category: 'Food', type: 'outcome', total: '120.00' },
      { category: 'Salary', type: 'income', total: '1000.00' },
    ])
    expect(await service.getByCategory('u1')).toEqual([
      { category: 'Food', type: 'outcome', total: 120 },
      { category: 'Salary', type: 'income', total: 1000 },
    ])
  })
})
