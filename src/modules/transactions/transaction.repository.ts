import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import type { Database } from '../../shared/database/client.js'
import { type Transaction, transactions, type TransactionKind } from '../../shared/database/schema.js'

export interface CreateTransactionData {
  userId: string
  amountCents: number
  kind: TransactionKind
  categoryId: string
  occurredAt: string
  description: string | null
}

export interface UpdateTransactionData {
  amountCents?: number
  kind?: TransactionKind
  categoryId?: string
  occurredAt?: string
  description?: string | null
}

export interface ListTransactionsFilter {
  from?: string
  to?: string
  categoryId?: string
  kind?: TransactionKind
  limit: number
  offset: number
}

export interface TransactionRepository {
  create(data: CreateTransactionData): Promise<Transaction>
  findById(userId: string, id: string): Promise<Transaction | undefined>
  list(userId: string, filter: ListTransactionsFilter): Promise<{ items: Transaction[]; total: number }>
  update(id: string, data: UpdateTransactionData): Promise<Transaction | undefined>
  delete(id: string): Promise<void>
  existsForCategory(categoryId: string): Promise<boolean>
}

export function createTransactionRepository(db: Database): TransactionRepository {
  function buildConditions(userId: string, filter: ListTransactionsFilter): SQL[] {
    const conditions: SQL[] = [eq(transactions.userId, userId)]
    if (filter.from) conditions.push(gte(transactions.occurredAt, filter.from))
    if (filter.to) conditions.push(lte(transactions.occurredAt, filter.to))
    if (filter.categoryId) conditions.push(eq(transactions.categoryId, filter.categoryId))
    if (filter.kind) conditions.push(eq(transactions.kind, filter.kind))
    return conditions
  }

  return {
    async create(data): Promise<Transaction> {
      const rows = await db.insert(transactions).values(data).returning()
      return rows[0]
    },
    async findById(userId, id): Promise<Transaction | undefined> {
      const rows = await db
        .select()
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
        .limit(1)
      return rows[0]
    },
    async list(userId, filter): Promise<{ items: Transaction[]; total: number }> {
      const where = and(...buildConditions(userId, filter))
      const items = await db
        .select()
        .from(transactions)
        .where(where)
        .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
        .limit(filter.limit)
        .offset(filter.offset)
      const [totals] = await db.select({ value: count() }).from(transactions).where(where)
      return { items, total: totals?.value ?? 0 }
    },
    async update(id, data): Promise<Transaction | undefined> {
      const rows = await db
        .update(transactions)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(transactions.id, id))
        .returning()
      return rows[0]
    },
    async delete(id): Promise<void> {
      await db.delete(transactions).where(eq(transactions.id, id))
    },
    async existsForCategory(categoryId): Promise<boolean> {
      const rows = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.categoryId, categoryId))
        .limit(1)
      return rows.length > 0
    },
  }
}
