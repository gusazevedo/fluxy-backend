import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { authenticate, createFakeEmail, createTestDb, type SentEmail } from '../../test/helpers.js'

describe('categories', () => {
  let app: FastifyInstance
  let close: () => Promise<void>
  let sent: SentEmail[]
  let token: string

  beforeAll(async () => {
    const testDb = await createTestDb()
    close = testDb.close
    const fake = createFakeEmail()
    sent = fake.sent
    app = await buildApp({ logger: false, db: testDb.db, email: fake.service })
    token = await authenticate(app, sent, 'cat@example.com', 'password123')
  })

  afterAll(async () => {
    await app.close()
    await close()
  })

  function auth(t = token): { authorization: string } {
    return { authorization: `Bearer ${t}` }
  }

  it('seeds the default categories on registration', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories', headers: auth() })
    expect(res.statusCode).toBe(200)
    const cats = res.json()
    expect(cats.length).toBeGreaterThanOrEqual(12)
    expect(cats.some((c: { name: string; kind: string }) => c.name === 'Alimentação' && c.kind === 'expense')).toBe(true)
    expect(cats.some((c: { name: string; kind: string }) => c.name === 'Salário' && c.kind === 'income')).toBe(true)
  })

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' })
    expect(res.statusCode).toBe(401)
  })

  it('creates a category and rejects a duplicate name+kind (case-insensitive)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: auth(),
      payload: { name: 'Viagem', kind: 'expense' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().name).toBe('Viagem')

    const dup = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: auth(),
      payload: { name: 'viagem', kind: 'expense' },
    })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error.code).toBe('CATEGORY_NAME_IN_USE')

    // Same name with a different kind is allowed.
    const income = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: auth(),
      payload: { name: 'Viagem', kind: 'income' },
    })
    expect(income.statusCode).toBe(201)
  })

  it('filters by kind', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories?kind=income', headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(res.json().every((c: { kind: string }) => c.kind === 'income')).toBe(true)
  })

  it('renames a category', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: auth(),
      payload: { name: 'Pets', kind: 'expense' },
    })
    const id = created.json().id
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/categories/${id}`,
      headers: auth(),
      payload: { name: 'Animais' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().name).toBe('Animais')
  })

  it('hard-deletes an unused category and 404s afterwards', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: auth(),
      payload: { name: 'Temporária', kind: 'expense' },
    })
    const id = created.json().id

    const del = await app.inject({ method: 'DELETE', url: `/categories/${id}`, headers: auth() })
    expect(del.statusCode).toBe(204)

    const get = await app.inject({ method: 'GET', url: `/categories/${id}`, headers: auth() })
    expect(get.statusCode).toBe(404)
    expect(get.json().error.code).toBe('CATEGORY_NOT_FOUND')
  })

  it('isolates categories per user', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/categories',
      headers: auth(),
      payload: { name: 'Privada', kind: 'expense' },
    })
    const id = created.json().id

    const otherToken = await authenticate(app, sent, 'other@example.com', 'password123')
    const res = await app.inject({ method: 'GET', url: `/categories/${id}`, headers: auth(otherToken) })
    expect(res.statusCode).toBe(404)
  })
})
