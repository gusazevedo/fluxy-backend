const TYPES = ['income', 'outcome'] as const
const CATEGORIES = ['Bills', 'Health', 'Gym', 'Subscriptions', 'Food', 'Entertainment', 'Transport'] as const

export const listTransactionsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: TYPES },
      category: { type: 'string', enum: CATEGORIES },
    },
  },
} as const

export const createTransactionSchema = {
  body: {
    type: 'object',
    required: ['title', 'value', 'type', 'category'],
    additionalProperties: false,
    properties: {
      title: { type: 'string', minLength: 1 },
      value: { type: 'number', exclusiveMinimum: 0 },
      type: { type: 'string', enum: TYPES },
      category: { type: 'string', enum: CATEGORIES },
    },
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
      value: { type: 'number', exclusiveMinimum: 0 },
      type: { type: 'string', enum: TYPES },
      category: { type: 'string', enum: CATEGORIES },
    },
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
