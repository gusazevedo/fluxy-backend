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
  kind: 'verify' | 'reset' | 'attempt'
  to: string
  // verification e-mails carry an OTP `code`; password resets carry a `link`;
  // signup-attempt warnings (D13) carry neither.
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
    async sendSignupAttemptEmail(to): Promise<void> {
      sent.push({ kind: 'attempt', to })
    },
  }
  return { service, sent }
}

/**
 * Signs a brand-new user up through the three-step flow and returns the access
 * token. Reads the OTP from the capturing e-mail service.
 */
export async function authenticate(
  app: FastifyInstance,
  sent: SentEmail[],
  email: string,
  password: string,
): Promise<string> {
  await app.inject({ method: 'POST', url: '/auth/signup/start', payload: { email } })
  const code = sent.filter((e) => e.kind === 'verify' && e.to === email).at(-1)?.code ?? ''
  const verify = await app.inject({
    method: 'POST',
    url: '/auth/signup/verify',
    payload: { email, code },
  })
  const complete = await app.inject({
    method: 'POST',
    url: '/auth/signup/complete',
    payload: {
      signupToken: verify.json().signupToken,
      firstName: 'Test',
      lastName: 'User',
      password,
      passwordConfirmation: password,
    },
  })
  return complete.json().accessToken
}
