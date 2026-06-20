import { and, count, eq, gte, lte, sql } from 'drizzle-orm'
import type { Database } from '../../shared/database/client.js'
import { categories, transactions, type TransactionKind } from '../../shared/database/schema.js'

export interface KindTotal {
  kind: TransactionKind
  totalCents: number
  count: number
}

export interface CategoryTotal {
  categoryId: string
  name: string
  kind: TransactionKind
  archivedAt: Date | null
  totalCents: number
  count: number
}

export interface ReportRepository {
  totalsByKind(userId: string, from: string, to: string): Promise<KindTotal[]>
  totalsByCategory(userId: string, from: string, to: string): Promise<CategoryTotal[]>
}

export function createReportRepository(db: Database): ReportRepository {
  // SUM over bigint returns numeric; coalesce to 0 and map to a JS number.
  const sumCents = sql<number>`coalesce(sum(${transactions.amountCents}), 0)`.mapWith(Number)

  return {
    async totalsByKind(userId, from, to): Promise<KindTotal[]> {
      return db
        .select({ kind: transactions.kind, totalCents: sumCents, count: count() })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            gte(transactions.occurredAt, from),
            lte(transactions.occurredAt, to),
          ),
        )
        .groupBy(transactions.kind)
    },
    async totalsByCategory(userId, from, to): Promise<CategoryTotal[]> {
      return db
        .select({
          categoryId: transactions.categoryId,
          name: categories.name,
          kind: categories.kind,
          archivedAt: categories.archivedAt,
          totalCents: sumCents,
          count: count(),
        })
        .from(transactions)
        .innerJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            eq(transactions.userId, userId),
            gte(transactions.occurredAt, from),
            lte(transactions.occurredAt, to),
          ),
        )
        .groupBy(transactions.categoryId, categories.name, categories.kind, categories.archivedAt)
        .orderBy(categories.name)
    },
  }
}
