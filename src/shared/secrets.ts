import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { env, isLocal } from './config/env.js'

// Local/dev fallback so the app boots without external secrets. Never used in
// deployed stages, which must provide JWT_SECRET via SSM.
const LOCAL_JWT_SECRET = 'dev-insecure-jwt-secret-change-me'

let ssm: SSMClient | undefined
const cache = new Map<string, string>()

async function getSsmParameter(name: string): Promise<string> {
  const cached = cache.get(name)
  if (cached !== undefined) return cached

  ssm ??= new SSMClient({})
  const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
  const value = res.Parameter?.Value
  if (value === undefined) {
    throw new Error(`SSM parameter "${name}" has no value`)
  }
  cache.set(name, value)
  return value
}

/** JWT signing secret: env in local dev, SSM SecureString in deployed stages. */
export async function getJwtSecret(): Promise<string> {
  if (env.JWT_SECRET) return env.JWT_SECRET
  if (isLocal) return LOCAL_JWT_SECRET
  if (!env.JWT_SECRET_PARAM) {
    throw new Error('JWT_SECRET_PARAM is required in deployed stages')
  }
  return getSsmParameter(env.JWT_SECRET_PARAM)
}

/** Neon connection string: env in local dev, SSM SecureString in deployed stages. */
export async function getDatabaseUrl(): Promise<string> {
  if (env.DATABASE_URL) return env.DATABASE_URL
  if (!env.DATABASE_URL_PARAM) {
    throw new Error('DATABASE_URL (local) or DATABASE_URL_PARAM (deployed) is required')
  }
  return getSsmParameter(env.DATABASE_URL_PARAM)
}

/** Resend API key, if configured. Absent locally falls back to console e-mail. */
export async function getResendApiKey(): Promise<string | undefined> {
  if (env.RESEND_API_KEY) return env.RESEND_API_KEY
  if (isLocal || !env.RESEND_API_KEY_PARAM) return undefined
  return getSsmParameter(env.RESEND_API_KEY_PARAM)
}
