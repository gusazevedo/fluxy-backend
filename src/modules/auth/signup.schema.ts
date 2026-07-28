import { Type } from '@fastify/type-provider-typebox'
import { Email, Name, OtpCode, Password, TokenString } from './field.schema.js'

export const SignupStartBody = Type.Object({ email: Email })
export const SignupVerifyBody = Type.Object({ email: Email, code: OtpCode })
export const SignupCompleteBody = Type.Object({
  signupToken: TokenString,
  firstName: Name,
  lastName: Name,
  password: Password,
  passwordConfirmation: Password,
})

export const SignupTokenResponse = Type.Object({
  signupToken: Type.String(),
  expiresInSeconds: Type.Integer(),
})
