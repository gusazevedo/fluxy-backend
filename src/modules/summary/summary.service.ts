import { eq, sql } from 'drizzle-orm'
import { db } from '../../shared/database/drizzle.js'
import { transactions } from '../../shared/database/schema.js'

export interface BalanceSummary {
  income: number
  outcome: number
  balance: number
}

export interface CategorySummaryItem {
  category: string
  type: string
  total: number
}

export interface ISummaryService {
  getBalance(userId: string): Promise<BalanceSummary>
  getByCategory(userId: string): Promise<CategorySummaryItem[]>
}

export class SummaryService implements ISummaryService {
  async getBalance(userId: string): Promise<BalanceSummary> {
    const rows = await db
      .select({
        type: transactions.type,
        total: sql<string>`sum(${transactions.value})`.as('total'),
      })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .groupBy(transactions.type)

    let income = 0
    let outcome = 0

    for (const row of rows) {
      if (row.type === 'income') income = Number(row.total)
      if (row.type === 'outcome') outcome = Number(row.total)
    }

    return { income, outcome, balance: income - outcome }
  }

  async getByCategory(userId: string): Promise<CategorySummaryItem[]> {
    const rows = await db
      .select({
        category: transactions.category,
        type: transactions.type,
        total: sql<string>`sum(${transactions.value})`.as('total'),
      })
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .groupBy(transactions.category, transactions.type)

    return rows.map((row) => ({
      category: row.category,
      type: row.type,
      total: Number(row.total),
    }))
  }
}
