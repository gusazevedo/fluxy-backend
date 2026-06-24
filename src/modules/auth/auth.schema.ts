import { Type } from '@fastify/type-provider-typebox'

// Pragmatic e-mail pattern (real validation happens by sending the message).
const Email = Type.String({
  pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
  maxLength: 320,
})
const Password = Type.String({ minLength: 8, maxLength: 200 })
const TokenString = Type.String({ minLength: 1 })
const Name = Type.String({ minLength: 1, maxLength: 100 })

export const RegisterBody = Type.Object({
  email: Email,
  firstName: Name,
  lastName: Name,
  password: Password,
})
export const LoginBody = Type.Object({ email: Email, password: Password })
export const VerifyEmailBody = Type.Object({ token: TokenString })
export const ResendVerificationBody = Type.Object({ email: Email })
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
