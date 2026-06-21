import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { isLocal } from '../config/env.js'
import { getDatabaseUrl } from '../secrets.js'
import * as schema from './schema.js'

/**
 * Driver-agnostic database type. Local dev uses postgres.js; deployed stages use
 * the Neon HTTP driver; tests use pglite — all share the same Drizzle query API.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
  }
}

/**
 * Creates the database client for a real run. Tests inject a pglite-backed
 * `Database` directly via `buildApp({ db })` and never call this.
 *
 * Async because deployed stages read the Neon connection string from SSM at
 * cold start (see {@link getDatabaseUrl}).
 */
export async function createDb(): Promise<Database> {
  const url = await getDatabaseUrl()

  if (isLocal) {
    return drizzlePg(postgres(url), { schema }) as unknown as Database
  }

  return drizzleNeon(neon(url), { schema }) as unknown as Database
}
