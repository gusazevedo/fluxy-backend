import { Type } from '@fastify/type-provider-typebox'
import { Email, Password, TokenString } from './field.schema.js'

export const LoginBody = Type.Object({ email: Email, password: Password })
export const RefreshBody = Type.Object({ refreshToken: TokenString })
export const LogoutBody = Type.Object({ refreshToken: TokenString })
export const ForgotPasswordBody = Type.Object({ email: Email })
export const ResetPasswordBody = Type.Object({ token: TokenString, password: Password })
export const ChangePasswordBody = Type.Object({
  currentPassword: Password,
  newPassword: Password,
})

export const TokenPairResponse = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  tokenType: Type.Literal('Bearer'),
  expiresIn: Type.String(),
})

export const MessageResponse = Type.Object({ message: Type.String() })

export const MeResponse = Type.Object({
  id: Type.String(),
  email: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  emailVerified: Type.Boolean(),
  createdAt: Type.String(),
})
