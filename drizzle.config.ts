import { defineConfig } from 'drizzle-kit'

/**
 * Migrations for both local dev and deployed stages (0002/AD-15). `url` comes
 * from DATABASE_URL:
 *   - local:  the Docker Postgres connection string
 *   - remote: the Neon **direct (unpooled)** connection string, applied after a
 *     deploy via `npm run db:migrate:remote`.
 */
export default defineConfig({
  schema: './src/shared/database/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
  },
})
