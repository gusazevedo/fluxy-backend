import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

/**
 * Non-secret runtime configuration, validated at boot.
 *
 * Only foundation-level settings live here. Database, auth and e-mail
 * configuration are added by their respective feature specs (0003+).
 */
const EnvSchema = Type.Object({
  STAGE: Type.Union(
    [Type.Literal('local'), Type.Literal('dev'), Type.Literal('prod')],
    { default: 'local' },
  ),
  NODE_ENV: Type.String({ default: 'development' }),
  PORT: Type.Number({ default: 3333 }),
  HOST: Type.String({ default: '0.0.0.0' }),
  LOG_LEVEL: Type.String({ default: 'info' }),
  // Public URL of the web app; used for CORS and e-mail links.
  APP_URL: Type.String({ default: 'http://localhost:3000' }),

  // --- Database ---
  // Local dev: a Postgres connection string (driver: postgres.js).
  // Deployed stages: the Neon connection string, read from SSM at cold start
  // (DATABASE_URL_PARAM) into this same variable.
  DATABASE_URL: Type.Optional(Type.String()),
  // Deployed stages: name of the SSM SecureString holding the Neon connection string.
  DATABASE_URL_PARAM: Type.Optional(Type.String()),
  DB_NAME: Type.String({ default: 'fluxy' }),

  // --- Auth / tokens ---
  ACCESS_TOKEN_TTL: Type.String({ default: '15m' }),
  REFRESH_TOKEN_TTL_DAYS: Type.Number({ default: 30 }),
  // E-mail verification OTP (6-digit code).
  VERIFY_OTP_TTL_MINUTES: Type.Number({ default: 5 }),
  VERIFY_OTP_MAX_ATTEMPTS: Type.Number({ default: 5 }),
  VERIFY_OTP_RESEND_COOLDOWN_SECONDS: Type.Number({ default: 60 }),
  RESET_TOKEN_TTL_HOURS: Type.Number({ default: 1 }),
  // Present in local dev; deployed stages read it from SSM (JWT_SECRET_PARAM).
  JWT_SECRET: Type.Optional(Type.String()),
  JWT_SECRET_PARAM: Type.Optional(Type.String()),

  // --- E-mail (Resend) ---
  EMAIL_FROM: Type.String({ default: 'Fluxy <onboarding@resend.dev>' }),
  RESEND_API_KEY: Type.Optional(Type.String()),
  RESEND_API_KEY_PARAM: Type.Optional(Type.String()),
})

function loadEnv(): Static<typeof EnvSchema> {
  // Apply defaults for missing keys, then coerce strings ("3333" -> 3333).
  const withDefaults = Value.Default(EnvSchema, { ...process.env })
  const converted = Value.Convert(EnvSchema, withDefaults)

  if (!Value.Check(EnvSchema, converted)) {
    const errors = [...Value.Errors(EnvSchema, converted)]
      .map((e) => `  - ${e.path || '/'}: ${e.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${errors}`)
  }

  // Strip the unrelated process.env keys, keeping only the schema fields.
  return Value.Clean(EnvSchema, converted) as Static<typeof EnvSchema>
}

export const env = loadEnv()
export type Env = Static<typeof EnvSchema>

export const isLocal = env.STAGE === 'local'
export const isProd = env.STAGE === 'prod'
