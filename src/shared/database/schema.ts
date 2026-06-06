import { pgTable, uuid, text, numeric, timestamp, pgEnum } from 'drizzle-orm/pg-core'

export const transactionTypeEnum = pgEnum('transaction_type', ['income', 'outcome'])

export const transactionCategoryEnum = pgEnum('transaction_category', [
  'Bills',
  'Health',
  'Gym',
  'Subscriptions',
  'Food',
  'Entertainment',
  'Transport',
  'Salary',
])

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  title: text('title').notNull(),
  value: numeric('value', { precision: 10, scale: 2 }).notNull(),
  type: transactionTypeEnum('type').notNull(),
  category: transactionCategoryEnum('category').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
