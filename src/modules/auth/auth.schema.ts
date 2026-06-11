export const socialLoginSchema = {
  body: {
    type: 'object',
    required: ['id_token'],
    additionalProperties: false,
    properties: {
      id_token: { type: 'string', minLength: 1 },
    },
  },
} as const
