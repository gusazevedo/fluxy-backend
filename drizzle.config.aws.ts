import { defineConfig } from 'drizzle-kit'

/**
 * Remote migrations against Aurora via the RDS Data API (0002/AD-15).
 *
 * Apply after a deploy with AWS credentials + the stack outputs in the env:
 *   DB_CLUSTER_ARN=... DB_SECRET_ARN=... DB_NAME=fluxy \
 *     npm run db:migrate:remote
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/database/schema.ts',
  out: './drizzle',
  driver: 'aws-data-api',
  dbCredentials: {
    database: process.env.DB_NAME ?? 'fluxy',
    secretArn: process.env.DB_SECRET_ARN as string,
    resourceArn: process.env.DB_CLUSTER_ARN as string,
  },
})
