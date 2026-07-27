import { Type } from '@fastify/type-provider-typebox'
import { Email, Name, OtpCode, Password } from './field.schema.js'

export const SignupStartBody = Type.Object({ email: Email })
export const SignupVerifyBody = Type.Object({ email: Email, code: OtpCode })
export const SignupCompleteBody = Type.Object({
  signupToken: Type.String({ minLength: 1 }),
  firstName: Name,
  lastName: Name,
  password: Password,
  passwordConfirmation: Password,
})

export const SignupTokenResponse = Type.Object({
  signupToken: Type.String(),
  expiresInSeconds: Type.Integer(),
})
