import { Type } from '@fastify/type-provider-typebox'

const Kind = Type.Union([Type.Literal('expense'), Type.Literal('income')])
const DateOnly = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })

export const SummaryQuery = Type.Object({
  from: Type.Optional(DateOnly),
  to: Type.Optional(DateOnly),
})

export const SummaryResponse = Type.Object({
  period: Type.Object({ from: Type.String(), to: Type.String() }),
  totals: Type.Object({
    incomeCents: Type.Integer(),
    expenseCents: Type.Integer(),
    balanceCents: Type.Integer(),
    transactionCount: Type.Integer(),
  }),
  byCategory: Type.Array(
    Type.Object({
      categoryId: Type.String(),
      name: Type.String(),
      kind: Kind,
      archived: Type.Boolean(),
      totalCents: Type.Integer(),
      transactionCount: Type.Integer(),
    }),
  ),
})
