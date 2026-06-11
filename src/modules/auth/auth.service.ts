import { createClient } from '@supabase/supabase-js'
import { AppError } from '../../shared/errors/app-error.js'

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_ANON_KEY as string,
)

export type SocialProvider = 'google' | 'apple'

export interface AuthTokens {
  access_token: string
  refresh_token: string
}

export interface IAuthService {
  loginWithProvider(provider: SocialProvider, idToken: string): Promise<AuthTokens>
}

export class AuthService implements IAuthService {
  async loginWithProvider(provider: SocialProvider, idToken: string): Promise<AuthTokens> {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider,
      token: idToken,
    })

    if (error || !data.session) {
      throw new AppError(
        'INVALID_SOCIAL_TOKEN',
        `Invalid or expired ${provider} token`,
        401,
      )
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    }
  }
}
