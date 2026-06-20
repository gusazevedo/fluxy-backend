import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '../../shared/database/client.js'
import { type Category, categories, type TransactionKind } from '../../shared/database/schema.js'

export interface NewCategoryInput {
  name: string
  kind: TransactionKind
}

export interface ListCategoriesFilter {
  kind?: TransactionKind
  includeArchived: boolean
}

export interface CategoryRepository {
  create(userId: string, name: string, kind: TransactionKind): Promise<Category>
  insertMany(userId: string, items: NewCategoryInput[]): Promise<void>
  findById(userId: string, id: string): Promise<Category | undefined>
  findActiveByName(userId: string, kind: TransactionKind, name: string): Promise<Category | undefined>
  list(userId: string, filter: ListCategoriesFilter): Promise<Category[]>
  updateName(id: string, name: string): Promise<Category | undefined>
  archive(id: string): Promise<void>
  hardDelete(id: string): Promise<void>
}

export function createCategoryRepository(db: Database): CategoryRepository {
  return {
    async create(userId, name, kind): Promise<Category> {
      const rows = await db.insert(categories).values({ userId, name, kind }).returning()
      return rows[0]
    },
    async insertMany(userId, items): Promise<void> {
      if (items.length === 0) return
      await db.insert(categories).values(items.map((i) => ({ userId, name: i.name, kind: i.kind })))
    },
    async findById(userId, id): Promise<Category | undefined> {
      const rows = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.userId, userId)))
        .limit(1)
      return rows[0]
    },
    async findActiveByName(userId, kind, name): Promise<Category | undefined> {
      const rows = await db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.userId, userId),
            eq(categories.kind, kind),
            isNull(categories.archivedAt),
            sql`lower(${categories.name}) = lower(${name})`,
          ),
        )
        .limit(1)
      return rows[0]
    },
    async list(userId, filter): Promise<Category[]> {
      const conditions = [eq(categories.userId, userId)]
      if (filter.kind) conditions.push(eq(categories.kind, filter.kind))
      if (!filter.includeArchived) conditions.push(isNull(categories.archivedAt))
      return db.select().from(categories).where(and(...conditions)).orderBy(categories.name)
    },
    async updateName(id, name): Promise<Category | undefined> {
      const rows = await db
        .update(categories)
        .set({ name, updatedAt: new Date() })
        .where(eq(categories.id, id))
        .returning()
      return rows[0]
    },
    async archive(id): Promise<void> {
      await db
        .update(categories)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(categories.id, id))
    },
    async hardDelete(id): Promise<void> {
      await db.delete(categories).where(eq(categories.id, id))
    },
  }
}
