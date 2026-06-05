import { createClient } from '@supabase/supabase-js'
import { AppError } from '../../shared/errors/app-error.js'

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_ANON_KEY as string,
)

export interface IAuthService {
  register(email: string, password: string): Promise<{ message: string }>
  login(email: string, password: string): Promise<{ access_token: string; refresh_token: string }>
}

export class AuthService implements IAuthService {
  async register(email: string, password: string): Promise<{ message: string }> {
    const { error } = await supabase.auth.signUp({ email, password })

    if (error) {
      if (error.message.toLowerCase().includes('already')) {
        throw new AppError('EMAIL_IN_USE', 'This email is already registered', 409)
      }
      throw new AppError('REGISTRATION_FAILED', error.message, 400)
    }

    return { message: 'Account created. Please verify your email before logging in.' }
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        throw new AppError('EMAIL_NOT_VERIFIED', 'Please verify your email before logging in', 401)
      }
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401)
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }
  }
}
