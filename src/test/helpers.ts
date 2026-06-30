import type { FastifyInstance } from 'fastify'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { EmailService } from '../email/resend.js'
import type { Database } from '../shared/database/client.js'
import * as schema from '../shared/database/schema.js'

export interface TestDb {
  db: Database
  close: () => Promise<void>
}

/** In-memory Postgres (pglite) with the schema applied via migrations. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: './drizzle' })
  return { db: db as unknown as Database, close: () => client.close() }
}

export interface SentEmail {
  kind: 'verify' | 'reset'
  to: string
  // verification e-mails carry an OTP `code`; password resets carry a `link`.
  code?: string
  link?: string
}

/** Capturing e-mail service so tests can read the verification codes / reset links. */
export function createFakeEmail(): { service: EmailService; sent: SentEmail[] } {
  const sent: SentEmail[] = []
  const service: EmailService = {
    async sendVerificationEmail(to, code): Promise<void> {
      sent.push({ kind: 'verify', to, code })
    },
    async sendPasswordResetEmail(to, link): Promise<void> {
      sent.push({ kind: 'reset', to, link })
    },
  }
  return { service, sent }
}

/**
 * Registers, verifies and logs in a user, returning the access token. Reads the
 * verification code from the capturing e-mail service.
 */
export async function authenticate(
  app: FastifyInstance,
  sent: SentEmail[],
  email: string,
  password: string,
): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, firstName: 'Test', lastName: 'User', password },
  })
  const code = sent.filter((e) => e.kind === 'verify' && e.to === email).at(-1)?.code ?? ''
  await app.inject({ method: 'POST', url: '/auth/verify-email', payload: { email, code } })
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  return login.json().accessToken
}
