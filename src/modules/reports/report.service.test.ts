import { describe, expect, it, vi } from 'vitest'
import type { ReportRepository } from './report.repository.js'
import { createReportService } from './report.service.js'

function makeRepo(over: Partial<ReportRepository> = {}): ReportRepository {
  return {
    totalsByKind: vi.fn().mockResolvedValue([]),
    totalsByCategory: vi.fn().mockResolvedValue([]),
    ...over,
  }
}

describe('report service', () => {
  it('computes balance, counts and breakdown from the repo totals', async () => {
    const service = createReportService(
      makeRepo({
        totalsByKind: vi.fn().mockResolvedValue([
          { kind: 'income', totalCents: 5000, count: 1 },
          { kind: 'expense', totalCents: 3000, count: 2 },
        ]),
        totalsByCategory: vi.fn().mockResolvedValue([
          { categoryId: 'c1', name: 'Alimentação', kind: 'expense', archivedAt: null, totalCents: 3000, count: 2 },
        ]),
      }),
    )
    const res = await service.summary('u1', { from: '2026-06-01', to: '2026-06-30' })
    expect(res.period).toEqual({ from: '2026-06-01', to: '2026-06-30' })
    expect(res.totals).toEqual({ incomeCents: 5000, expenseCents: 3000, balanceCents: 2000, transactionCount: 3 })
    expect(res.byCategory[0]).toMatchObject({ name: 'Alimentação', totalCents: 3000, transactionCount: 2, archived: false })
  })

  it('defaults to the current month when no period is given', async () => {
    const res = await createReportService(makeRepo()).summary('u1', {})
    expect(res.period.from.endsWith('-01')).toBe(true)
    expect(res.period.to >= res.period.from).toBe(true)
  })

  it('returns zeros when there are no transactions', async () => {
    const res = await createReportService(makeRepo()).summary('u1', { from: '2026-06-01', to: '2026-06-30' })
    expect(res.totals).toEqual({ incomeCents: 0, expenseCents: 0, balanceCents: 0, transactionCount: 0 })
    expect(res.byCategory).toEqual([])
  })

  it('rejects a period where from is after to', async () => {
    await expect(
      createReportService(makeRepo()).summary('u1', { from: '2026-06-30', to: '2026-06-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})
