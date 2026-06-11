import type { Transaction } from '../../shared/database/schema.js'

export interface TransactionResponse {
  id: string
  title: string
  value: number
  type: 'income' | 'outcome'
  category: string
  created_at: string
  updated_at: string
}

/**
 * Maps a persisted Transaction row to the public API contract:
 * - drops internal fields (e.g. `userId`)
 * - `numeric` value (string) → number
 * - `createdAt`/`updatedAt` (Date, camelCase) → `created_at`/`updated_at` (ISO strings)
 */
export function toTransactionResponse(t: Transaction): TransactionResponse {
  return {
    id: t.id,
    title: t.title,
    value: Number(t.value),
    type: t.type,
    category: t.category,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  }
}
