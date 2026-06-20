import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../app.js'
import { authenticate, createFakeEmail, createTestDb, type SentEmail } from '../../test/helpers.js'

describe('reports', () => {
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
    token = await authenticate(app, sent, 'report@example.com', 'password123')

    const food = await categoryId('Alimentação', 'expense')
    const salary = await categoryId('Salário', 'income')
    await tx(5000_00, 'income', salary, '2026-06-01')
    await tx(1000_00, 'expense', food, '2026-06-10')
    await tx(2000_00, 'expense', food, '2026-06-15')
    // Outside the queried window:
    await tx(9999_00, 'expense', food, '2026-05-20')
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

  function tx(amountCents: number, kind: string, categoryId: string, occurredAt: string): Promise<unknown> {
    return app.inject({
      method: 'POST',
      url: '/transactions',
      headers: auth(),
      payload: { amountCents, kind, categoryId, occurredAt },
    })
  }

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/reports/summary' })
    expect(res.statusCode).toBe(401)
  })

  it('summarises totals, balance and breakdown for a period', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/summary?from=2026-06-01&to=2026-06-30',
      headers: auth(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.period).toEqual({ from: '2026-06-01', to: '2026-06-30' })
    expect(body.totals).toEqual({
      incomeCents: 500000,
      expenseCents: 300000,
      balanceCents: 200000,
      transactionCount: 3,
    })

    const food = body.byCategory.find((c: { name: string }) => c.name === 'Alimentação')
    expect(food).toMatchObject({ kind: 'expense', totalCents: 300000, transactionCount: 2, archived: false })
    const salary = body.byCategory.find((c: { name: string }) => c.name === 'Salário')
    expect(salary).toMatchObject({ kind: 'income', totalCents: 500000, transactionCount: 1 })
  })

  it('excludes transactions outside the period', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/summary?from=2026-01-01&to=2026-01-31',
      headers: auth(),
    })
    const body = res.json()
    expect(body.totals).toEqual({ incomeCents: 0, expenseCents: 0, balanceCents: 0, transactionCount: 0 })
    expect(body.byCategory).toEqual([])
  })

  it('rejects from after to', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/summary?from=2026-06-30&to=2026-06-01',
      headers: auth(),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })

  it('isolates reports per user', async () => {
    const otherToken = await authenticate(app, sent, 'report-other@example.com', 'password123')
    const res = await app.inject({
      method: 'GET',
      url: '/reports/summary?from=2026-06-01&to=2026-06-30',
      headers: auth(otherToken),
    })
    const body = res.json()
    expect(body.totals).toEqual({ incomeCents: 0, expenseCents: 0, balanceCents: 0, transactionCount: 0 })
  })
})
