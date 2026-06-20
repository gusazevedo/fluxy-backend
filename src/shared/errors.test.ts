import { describe, expect, it } from 'vitest'
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from './errors.js'

describe('AppError helpers', () => {
  it('badRequest maps to 400 BAD_REQUEST and keeps details', () => {
    const err = badRequest('invalid input', { field: 'email' })
    expect(err).toBeInstanceOf(AppError)
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.message).toBe('invalid input')
    expect(err.details).toEqual({ field: 'email' })
  })

  it('maps the remaining helpers to their HTTP status and code', () => {
    expect(unauthorized().statusCode).toBe(401)
    expect(unauthorized().code).toBe('UNAUTHORIZED')
    expect(forbidden().statusCode).toBe(403)
    expect(notFound().statusCode).toBe(404)
    expect(conflict('email already used').statusCode).toBe(409)
    expect(conflict('email already used').code).toBe('CONFLICT')
  })
})
