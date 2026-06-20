import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { authenticate, createFakeEmail, createTestDb, type SentEmail } from '../../test/helpers.js'

describe('transactions', () => {
  let app: FastifyInstance
  let close: () => Promise<void>
  let sent: SentEmail[]
  let token: string
  let expenseCategoryId: string
  let incomeCategoryId: string

  beforeAll(async () => {
    const testDb = await createTestDb()
    close = testDb.close
    const fake = createFakeEmail()
    sent = fake.sent
    app = await buildApp({ logger: false, db: testDb.db, email: fake.service })
    token = await authenticate(app, sent, 'tx@example.com', 'password123')
    expenseCategoryId = await categoryId('Alimentação', 'expense')
    incomeCategoryId = await categoryId('Salário', 'income')
  })

  afterAll(async () => {
    await app.close()
    await close()
  })

  function auth(t = token): { authorization: string } {
    return { authorization: `Bearer ${t}` }
  }

  async function categoryId(name: string, kind: string): Promise<string> {
    const res = await app.inject({ method: 'GET', url: `/categories?kind=${kind}`, headers: auth() })
    const cats = res.json() as Array<{ id: string; name: string }>
    const found = cats.find((c) => c.name === name)
    if (!found) throw new Error(`category ${name} not found`)
    return found.id
  }

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/transactions' })
    expect(res.statusCode).toBe(401)
  })

  it('creates a transaction', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: auth(),
      payload: { amountCents: 1250, kind: 'expense', categoryId: expenseCategoryId, occurredAt: '2026-06-10', description: 'Almoço' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ amountCents: 1250, kind: 'expense', categoryId: expenseCategoryId, description: 'Almoço' })
  })

  it('rejects a category of a different kind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: auth(),
      payload: { amountCents: 1000, kind: 'income', categoryId: expenseCategoryId, occurredAt: '2026-06-10' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('CATEGORY_KIND_MISMATCH')
  })

  it('rejects a non-positive amount', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      headers: auth(),
      payload: { amountCents: 0, kind: 'expense', categoryId: expenseCategoryId, occurredAt: '2026-06-10' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_AMOUNT')
  })

  it('lists transactions with filters and pagination', async () => {
    await app.inject({ method: 'POST', url: '/transactions', headers: auth(), payload: { amountCents: 500, kind: 'income', categoryId: incomeCategoryId, occurredAt: '2026-06-01' } })
    const res = await app.inject({ method: 'GET', url: '/transactions?kind=expense&limit=1', headers: auth() })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.items.every((t: { kind: string }) => t.kind === 'expense')).toBe(true)
    expect(body.items.length).toBeLessThanOrEqual(1)
    expect(typeof body.page.total).toBe('number')
    expect(body.page.limit).toBe(1)
  })

  it('gets, updates and deletes a transaction', async () => {
    const created = await app.inject({ method: 'POST', url: '/transactions', headers: auth(), payload: { amountCents: 800, kind: 'expense', categoryId: expenseCategoryId, occurredAt: '2026-06-05' } })
    const id = created.json().id

    const got = await app.inject({ method: 'GET', url: `/transactions/${id}`, headers: auth() })
    expect(got.statusCode).toBe(200)

    const updated = await app.inject({ method: 'PATCH', url: `/transactions/${id}`, headers: auth(), payload: { amountCents: 950, description: 'ajustado' } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ amountCents: 950, description: 'ajustado' })

    const del = await app.inject({ method: 'DELETE', url: `/transactions/${id}`, headers: auth() })
    expect(del.statusCode).toBe(204)
    const gone = await app.inject({ method: 'GET', url: `/transactions/${id}`, headers: auth() })
    expect(gone.statusCode).toBe(404)
  })

  it('archives a used category on delete and preserves the transaction', async () => {
    // New category + a transaction that uses it.
    const cat = await app.inject({ method: 'POST', url: '/categories', headers: auth(), payload: { name: 'Hobby', kind: 'expense' } })
    const hobbyId = cat.json().id
    const tx = await app.inject({ method: 'POST', url: '/transactions', headers: auth(), payload: { amountCents: 4200, kind: 'expense', categoryId: hobbyId, occurredAt: '2026-06-02' } })
    const txId = tx.json().id

    // Deleting a used category archives it (does not hard-delete).
    const del = await app.inject({ method: 'DELETE', url: `/categories/${hobbyId}`, headers: auth() })
    expect(del.statusCode).toBe(204)

    // Default list excludes it; includeArchived shows it as archived.
    const active = await app.inject({ method: 'GET', url: '/categories', headers: auth() })
    expect(active.json().some((c: { id: string }) => c.id === hobbyId)).toBe(false)
    const all = await app.inject({ method: 'GET', url: '/categories?includeArchived=true', headers: auth() })
    expect(all.json().some((c: { id: string; archived: boolean }) => c.id === hobbyId && c.archived)).toBe(true)

    // The transaction still references the (archived) category.
    const stillThere = await app.inject({ method: 'GET', url: `/transactions/${txId}`, headers: auth() })
    expect(stillThere.statusCode).toBe(200)
    expect(stillThere.json().categoryId).toBe(hobbyId)

    // But a new transaction cannot use the archived category.
    const blocked = await app.inject({ method: 'POST', url: '/transactions', headers: auth(), payload: { amountCents: 100, kind: 'expense', categoryId: hobbyId, occurredAt: '2026-06-03' } })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error.code).toBe('CATEGORY_ARCHIVED')
  })

  it('isolates transactions per user', async () => {
    const created = await app.inject({ method: 'POST', url: '/transactions', headers: auth(), payload: { amountCents: 700, kind: 'expense', categoryId: expenseCategoryId, occurredAt: '2026-06-07' } })
    const id = created.json().id

    const otherToken = await authenticate(app, sent, 'tx-other@example.com', 'password123')
    const res = await app.inject({ method: 'GET', url: `/transactions/${id}`, headers: auth(otherToken) })
    expect(res.statusCode).toBe(404)
  })
})
