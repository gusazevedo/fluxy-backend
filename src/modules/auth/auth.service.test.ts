import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSignInWithIdToken } = vi.hoisted(() => ({ mockSignInWithIdToken: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithIdToken: mockSignInWithIdToken } }),
}))

const { AuthService } = await import('./auth.service.js')

let service: InstanceType<typeof AuthService>

beforeEach(() => {
  mockSignInWithIdToken.mockReset()
  service = new AuthService()
})

describe('AuthService.loginWithProvider', () => {
  it('returns the Supabase session tokens on success', async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: { access_token: 'access', refresh_token: 'refresh' } },
      error: null,
    })
    const tokens = await service.loginWithProvider('google', 'id-token')
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'id-token' })
    expect(tokens).toEqual({ access_token: 'access', refresh_token: 'refresh' })
  })

  it('throws INVALID_SOCIAL_TOKEN when Supabase returns an error', async () => {
    mockSignInWithIdToken.mockResolvedValue({ data: { session: null }, error: { message: 'bad token' } })
    await expect(service.loginWithProvider('apple', 'bad')).rejects.toMatchObject({
      code: 'INVALID_SOCIAL_TOKEN',
      statusCode: 401,
    })
  })

  it('throws INVALID_SOCIAL_TOKEN when there is no session', async () => {
    mockSignInWithIdToken.mockResolvedValue({ data: { session: null }, error: null })
    await expect(service.loginWithProvider('google', 'x')).rejects.toMatchObject({
      code: 'INVALID_SOCIAL_TOKEN',
      statusCode: 401,
    })
  })
})
