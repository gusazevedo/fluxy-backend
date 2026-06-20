import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from './crypto.js'

describe('token crypto', () => {
  it('generates distinct, non-empty tokens', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(20)
  })

  it('hashes deterministically and differs per input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
    expect(hashToken('abc')).toHaveLength(64) // sha256 hex
  })
})
