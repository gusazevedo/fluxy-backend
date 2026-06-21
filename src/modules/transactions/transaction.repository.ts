import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm'
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

/** Keyset position: the (occurredAt, id) of the last item already seen. */
export interface TransactionCursor {
  occurredAt: string
  id: string
}

export interface ListTransactionsFilter {
  from?: string
  to?: string
  categoryId?: string
  kind?: TransactionKind
  limit: number
  after?: TransactionCursor
}

export interface ListTransactionsResult {
  items: Transaction[]
  hasMore: boolean
}

export interface TransactionRepository {
  create(data: CreateTransactionData): Promise<Transaction>
  findById(userId: string, id: string): Promise<Transaction | undefined>
  list(userId: string, filter: ListTransactionsFilter): Promise<ListTransactionsResult>
  update(id: string, data: UpdateTransactionData): Promise<Transaction | undefined>
  delete(id: string): Promise<void>
  /**
   * Whether any transaction references the category. Not user-scoped on purpose:
   * the caller (category deletion) already verified ownership, and ids are UUIDs.
   */
  existsForCategory(categoryId: string): Promise<boolean>
}

export function createTransactionRepository(db: Database): TransactionRepository {
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
    async list(userId, filter): Promise<ListTransactionsResult> {
      const conditions: SQL[] = [eq(transactions.userId, userId)]
      if (filter.from) conditions.push(gte(transactions.occurredAt, filter.from))
      if (filter.to) conditions.push(lte(transactions.occurredAt, filter.to))
      if (filter.categoryId) conditions.push(eq(transactions.categoryId, filter.categoryId))
      if (filter.kind) conditions.push(eq(transactions.kind, filter.kind))

      if (filter.after) {
        // Rows strictly "after" the cursor in (occurred_at DESC, id DESC) order.
        const keyset = or(
          lt(transactions.occurredAt, filter.after.occurredAt),
          and(
            eq(transactions.occurredAt, filter.after.occurredAt),
            lt(transactions.id, filter.after.id),
          ),
        )
        if (keyset) conditions.push(keyset)
      }

      // Fetch one extra row to know whether another page exists.
      const rows = await db
        .select()
        .from(transactions)
        .where(and(...conditions))
        .orderBy(desc(transactions.occurredAt), desc(transactions.id))
        .limit(filter.limit + 1)

      return { items: rows.slice(0, filter.limit), hasMore: rows.length > filter.limit }
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
