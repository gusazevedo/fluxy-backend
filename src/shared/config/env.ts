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
  // Public URL of the web app; used for CORS and (later) e-mail links.
  APP_URL: Type.String({ default: 'http://localhost:3000' }),
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
