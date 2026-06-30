import { sql } from 'drizzle-orm'
import { bigint, boolean, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema (Drizzle). This spec (0003) introduces only the auth/account
 * tables; categories and transactions are added by specs 0004/0005.
 */

export const authTokenType = pgEnum('auth_token_type', ['email_verify', 'password_reset'])

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Stored lowercased; uniqueness is case-insensitive (RN-1 of 0003).
    email: text('email').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
)

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SHA-256 hash of the opaque refresh token; the raw value is never stored.
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_unique').on(t.tokenHash),
    index('refresh_tokens_user_id_idx').on(t.userId),
  ],
)

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SHA-256 hash of the token (password_reset) or OTP code (email_verify)
    // e-mailed to the user.
    tokenHash: text('token_hash').notNull(),
    type: authTokenType('type').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    // Failed verification attempts against this token; OTP codes are locked once
    // this reaches VERIFY_OTP_MAX_ATTEMPTS.
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // tokenHash is not unique: a 6-digit OTP has a small space and two users may
  // hold the same active code. email_verify is looked up by (userId, type);
  // password_reset tokens stay effectively unique by their entropy.
  (t) => [
    index('auth_tokens_token_hash_idx').on(t.tokenHash),
    index('auth_tokens_user_id_type_idx').on(t.userId, t.type),
  ],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type RefreshToken = typeof refreshTokens.$inferSelect
export type AuthToken = typeof authTokens.$inferSelect
export type AuthTokenType = (typeof authTokenType.enumValues)[number]

// Shared by categories (0004) and transactions (0005).
export const transactionKind = pgEnum('transaction_kind', ['expense', 'income'])
export type TransactionKind = (typeof transactionKind.enumValues)[number]

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: transactionKind('kind').notNull(),
    // null = active; set = archived (soft-delete, 0004 §7).
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Name unique per (user, kind) among ACTIVE categories, case-insensitive (RN-1).
    uniqueIndex('categories_user_kind_name_active_unique')
      .on(t.userId, t.kind, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    index('categories_user_id_idx').on(t.userId),
  ],
)

export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Category is required (0005/D5). Restrict deletes: used categories are
    // archived by the app (0004 §7), never hard-deleted, so this never orphans.
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    // Positive magnitude in cents (PD-1); the sign comes from `kind`.
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    kind: transactionKind('kind').notNull(),
    description: text('description'),
    occurredAt: date('occurred_at', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transactions_user_occurred_idx').on(t.userId, t.occurredAt),
    index('transactions_user_category_idx').on(t.userId, t.categoryId),
    index('transactions_user_kind_idx').on(t.userId, t.kind),
  ],
)

export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
