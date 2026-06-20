import type { TransactionKind } from '../../shared/database/schema.js'
import { AppError } from '../../shared/errors.js'
import type { ReportRepository } from './report.repository.js'

export interface SummaryQueryInput {
  from?: string
  to?: string
}

export interface CategoryBreakdown {
  categoryId: string
  name: string
  kind: TransactionKind
  archived: boolean
  totalCents: number
  transactionCount: number
}

export interface SummaryDto {
  period: { from: string; to: string }
  totals: { incomeCents: number; expenseCents: number; balanceCents: number; transactionCount: number }
  byCategory: CategoryBreakdown[]
}

export interface ReportService {
  summary(userId: string, query: SummaryQueryInput): Promise<SummaryDto>
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function currentMonth(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
  return { from: isoDate(from), to: isoDate(to) }
}

export function createReportService(repo: ReportRepository): ReportService {
  return {
    async summary(userId, query): Promise<SummaryDto> {
      const fallback = currentMonth()
      const from = query.from ?? fallback.from
      const to = query.to ?? fallback.to
      if (from > to) {
        throw new AppError(400, 'VALIDATION_ERROR', 'from must not be after to')
      }

      const kindTotals = await repo.totalsByKind(userId, from, to)
      const income = kindTotals.find((r) => r.kind === 'income')
      const expense = kindTotals.find((r) => r.kind === 'expense')
      const incomeCents = income?.totalCents ?? 0
      const expenseCents = expense?.totalCents ?? 0

      const categoryTotals = await repo.totalsByCategory(userId, from, to)

      return {
        period: { from, to },
        totals: {
          incomeCents,
          expenseCents,
          balanceCents: incomeCents - expenseCents,
          transactionCount: (income?.count ?? 0) + (expense?.count ?? 0),
        },
        byCategory: categoryTotals.map((c) => ({
          categoryId: c.categoryId,
          name: c.name,
          kind: c.kind,
          archived: c.archivedAt !== null,
          totalCents: c.totalCents,
          transactionCount: c.count,
        })),
      }
    },
  }
}
