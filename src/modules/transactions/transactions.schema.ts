const TYPES = ['income', 'outcome'] as const
const CATEGORIES = ['Bills', 'Health', 'Gym', 'Subscriptions', 'Food', 'Entertainment', 'Transport', 'Salary'] as const

// numeric(10, 2) holds up to 99_999_999.99 — reject larger values with 422
// instead of letting the insert overflow into a 500.
const VALUE_MAX = 99999999.99

// Output contract (matches the `Transaction` schema in spec/openapi.yaml).
// Serialized with `additionalProperties: false` so internal fields (e.g. userId)
// can never leak even if the presenter is bypassed.
const transactionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'value', 'type', 'category', 'created_at', 'updated_at'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    value: { type: 'number' },
    type: { type: 'string', enum: TYPES },
    category: { type: 'string', enum: CATEGORIES },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
} as const

export const listTransactionsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: TYPES },
      category: { type: 'string', enum: CATEGORIES },
    },
  },
  response: {
    200: { type: 'array', items: transactionResponseSchema },
  },
} as const

export const createTransactionSchema = {
  body: {
    type: 'object',
    required: ['title', 'value', 'type', 'category'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1 },
      value: { type: 'number', exclusiveMinimum: 0, maximum: VALUE_MAX },
      type: { type: 'string', enum: TYPES },
      category: { type: 'string', enum: CATEGORIES },
    },
  },
  response: {
    201: transactionResponseSchema,
  },
} as const

export const updateTransactionSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      title: { type: 'string', minLength: 1 },
      value: { type: 'number', exclusiveMinimum: 0, maximum: VALUE_MAX },
      type: { type: 'string', enum: TYPES },
      category: { type: 'string', enum: CATEGORIES },
    },
  },
  response: {
    200: transactionResponseSchema,
  },
} as const

export const deleteTransactionSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
} as const
