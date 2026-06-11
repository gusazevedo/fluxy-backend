import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'

// Fake auth: the middleware and auth service both build their client from here.
const { mockGetUser } = vi.hoisted(() => ({ mockGetUser: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser, signInWithIdToken: vi.fn() },
  }),
}))

// Fake DB so happy-path handlers never touch Postgres.
const fakeRow = {
  id: 'tx-1',
  userId: 'user-1',
  title: 'Lunch',
  value: '42.50',
  type: 'outcome',
  category: 'Food',
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-01-02T03:04:05.000Z'),
}
vi.mock('./shared/database/drizzle.js', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: async () => [fakeRow] }) }),
    select: () => ({ from: () => ({ where: async () => [fakeRow] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [fakeRow] }) }) }),
    delete: () => ({ where: () => ({ returning: async () => [{ id: fakeRow.id }] }) }),
  },
}))

const { buildApp } = await import('./app.js')

const AUTH = { authorization: 'Bearer fake-token', 'content-type': 'application/json' }

let app: FastifyInstance

beforeEach(async () => {
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  app = buildApp()
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('authentication', () => {
  it('rejects requests without a Bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/transactions' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects an invalid token (Supabase rejects it)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    const res = await app.inject({ method: 'GET', url: '/transactions', headers: AUTH })
    expect(res.statusCode).toBe(401)
  })
})

describe('not found handler', () => {
  it('returns the ErrorResponse contract for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: 'Route not found' })
  })
})

describe('POST /transactions validation & business rules', () => {
  it('returns 422 for an invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: AUTH,
      payload: { title: 'x', type: 'outcome', category: 'Food' }, // missing value
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('enforces the Salary rule (income must be Salary)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: AUTH,
      payload: { title: 'x', value: 10, type: 'income', category: 'Food' },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ code: 'INVALID_CATEGORY' })
  })
})

describe('response contract', () => {
  it('creates a transaction without leaking userId and with a numeric value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: AUTH,
      payload: { title: 'Lunch', value: 42.5, type: 'outcome', category: 'Food' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body).not.toHaveProperty('userId')
    expect(typeof body.value).toBe('number')
    expect(body.created_at).toBe('2026-01-02T03:04:05.000Z')
  })

  it('lists transactions in the public shape (no userId)', async () => {
    const res = await app.inject({ method: 'GET', url: '/transactions', headers: AUTH })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).not.toHaveProperty('userId')
    expect(typeof body[0].value).toBe('number')
  })
})
