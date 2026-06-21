import { Type } from '@fastify/type-provider-typebox'

const Kind = Type.Union([Type.Literal('expense'), Type.Literal('income')])
const Uuid = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
})
const DateOnly = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
const Description = Type.String({ maxLength: 280 })
const AmountCents = Type.Integer() // positivity is enforced in the service (INVALID_AMOUNT)

export const CreateTransactionBody = Type.Object({
  amountCents: AmountCents,
  kind: Kind,
  categoryId: Uuid,
  occurredAt: DateOnly,
  description: Type.Optional(Description),
})

export const UpdateTransactionBody = Type.Object({
  amountCents: Type.Optional(AmountCents),
  kind: Type.Optional(Kind),
  categoryId: Type.Optional(Uuid),
  occurredAt: Type.Optional(DateOnly),
  description: Type.Optional(Type.Union([Description, Type.Null()])),
})

export const TransactionParams = Type.Object({ id: Uuid })

export const ListTransactionsQuery = Type.Object({
  from: Type.Optional(DateOnly),
  to: Type.Optional(DateOnly),
  categoryId: Type.Optional(Uuid),
  kind: Type.Optional(Kind),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  // Opaque keyset cursor; absent = first page.
  cursor: Type.Optional(Type.String()),
})

export const TransactionResponse = Type.Object({
  id: Type.String(),
  amountCents: Type.Integer(),
  kind: Kind,
  categoryId: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  occurredAt: Type.String(),
  createdAt: Type.String(),
})

export const TransactionListResponse = Type.Object({
  items: Type.Array(TransactionResponse),
  // Pass back as ?cursor= to fetch the next page; null = no more results.
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})
