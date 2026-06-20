import { RDSDataClient } from '@aws-sdk/client-rds-data'
import { drizzle as drizzleDataApi } from 'drizzle-orm/aws-data-api/pg'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env, isLocal } from '../config/env.js'
import * as schema from './schema.js'

/**
 * Driver-agnostic database type. Local dev uses postgres.js; deployed stages use
 * the Aurora Data API; tests use pglite — all share the same Drizzle query API.
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
 */
export function createDb(): Database {
  if (isLocal) {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for local development')
    }
    return drizzlePg(postgres(env.DATABASE_URL), { schema }) as unknown as Database
  }

  if (!env.DB_CLUSTER_ARN || !env.DB_SECRET_ARN) {
    throw new Error('DB_CLUSTER_ARN and DB_SECRET_ARN are required for the Data API')
  }
  return drizzleDataApi(new RDSDataClient({}), {
    database: env.DB_NAME,
    resourceArn: env.DB_CLUSTER_ARN,
    secretArn: env.DB_SECRET_ARN,
    schema,
  }) as unknown as Database
}
