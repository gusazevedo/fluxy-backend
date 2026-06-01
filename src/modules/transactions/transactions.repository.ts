import { eq, and } from 'drizzle-orm'
import { db } from '../../shared/database/drizzle.js'
import { transactions, type Transaction, type NewTransaction } from '../../shared/database/schema.js'

export interface TransactionFilters {
  type?: 'income' | 'outcome'
  category?: string
}

export interface ITransactionRepository {
  findAllByUser(userId: string, filters: TransactionFilters): Promise<Transaction[]>
  findByIdAndUser(id: string, userId: string): Promise<Transaction | undefined>
  create(data: NewTransaction): Promise<Transaction>
  update(id: string, userId: string, data: Partial<NewTransaction>): Promise<Transaction | undefined>
  delete(id: string, userId: string): Promise<boolean>
}

export class TransactionRepository implements ITransactionRepository {
  async findAllByUser(userId: string, filters: TransactionFilters): Promise<Transaction[]> {
    const conditions = [eq(transactions.userId, userId)]

    if (filters.type) {
      conditions.push(eq(transactions.type, filters.type))
    }

    if (filters.category) {
      conditions.push(eq(transactions.category, filters.category as Transaction['category']))
    }

    return db.select().from(transactions).where(and(...conditions))
  }

  async findByIdAndUser(id: string, userId: string): Promise<Transaction | undefined> {
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))

    return row
  }

  async create(data: NewTransaction): Promise<Transaction> {
    const [row] = await db.insert(transactions).values(data).returning()
    return row
  }

  async update(
    id: string,
    userId: string,
    data: Partial<NewTransaction>,
  ): Promise<Transaction | undefined> {
    const [row] = await db
      .update(transactions)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .returning()

    return row
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
      .returning({ id: transactions.id })

    return result.length > 0
  }
}
