import { createHash, randomBytes, randomInt } from 'node:crypto'

/**
 * Generates a high-entropy, URL-safe random token. Used for refresh tokens and
 * the password-reset token.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Generates a numeric one-time password (OTP) for e-mail verification. Uses a
 * uniform, unbiased random integer and left-pads with zeros so the result is
 * always exactly `digits` long (e.g. "004217").
 */
export function generateOtp(digits = 6): string {
  return randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0')
}

/**
 * SHA-256 (hex) of a token, for storing high-entropy secrets at rest. Fast and
 * sufficient for random tokens — Argon2id is reserved for low-entropy passwords.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
