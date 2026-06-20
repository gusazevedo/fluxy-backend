import { hash, verify } from '@node-rs/argon2'

/** Hashes a plaintext password with Argon2id (library default). */
export function hashPassword(password: string): Promise<string> {
  return hash(password)
}

/** Verifies a plaintext password against an Argon2id hash. */
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password)
}
