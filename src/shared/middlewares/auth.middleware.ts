import type { FastifyReply, FastifyRequest } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { AppError } from '../errors/app-error.js'

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_ANON_KEY as string,
)

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError('UNAUTHORIZED', 'Missing or invalid Bearer token', 401)
  }

  const token = authHeader.slice(7)
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    throw new AppError('UNAUTHORIZED', 'Missing or invalid Bearer token', 401)
  }

  request.user = { id: data.user.id }
}
