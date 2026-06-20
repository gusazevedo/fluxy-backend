import { createHash, randomBytes } from 'node:crypto'

/**
 * Generates a high-entropy, URL-safe random token. Used for refresh tokens and
 * the e-mail verification / password-reset tokens.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * SHA-256 (hex) of a token, for storing high-entropy secrets at rest. Fast and
 * sufficient for random tokens — Argon2id is reserved for low-entropy passwords.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
