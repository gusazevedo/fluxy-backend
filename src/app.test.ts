import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { createFakeEmail, createTestDb } from './test/helpers.js'

describe('app foundation', () => {
  let app: FastifyInstance
  let close: () => Promise<void>

  beforeAll(async () => {
    const testDb = await createTestDb()
    close = testDb.close
    app = await buildApp({ logger: false, db: testDb.db, email: createFakeEmail().service })
  })

  afterAll(async () => {
    await app.close()
    await close()
  })

  it('GET /health returns an ok payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(body.stage).toBe('local')
    expect(typeof body.timestamp).toBe('string')
  })

  it('exposes the OpenAPI document including /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' })
    expect(res.statusCode).toBe(200)
    const doc = res.json()
    expect(doc.openapi).toBeDefined()
    expect(doc.paths['/health']).toBeDefined()
  })

  it('returns the error envelope for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' })
    expect(res.statusCode).toBe(404)
    const body = res.json()
    expect(body.error.code).toBe('NOT_FOUND')
    expect(body.error.statusCode).toBe(404)
  })
})
