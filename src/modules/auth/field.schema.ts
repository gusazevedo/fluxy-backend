import { Type } from '@fastify/type-provider-typebox'

/** Field schemas shared by the session and signup modules. */

// Pragmatic e-mail pattern (real validation happens by sending the message).
export const Email = Type.String({
  pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
  maxLength: 320,
})
export const Password = Type.String({ minLength: 8, maxLength: 200 })
export const TokenString = Type.String({ minLength: 1 })
export const OtpCode = Type.String({ pattern: '^[0-9]{6}$' })
export const Name = Type.String({ minLength: 1, maxLength: 100 })
