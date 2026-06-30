import { describe, expect, it } from 'vitest'
import { generateOtp, generateToken, hashToken } from './crypto.js'

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

describe('generateOtp', () => {
  it('always returns a zero-padded 6-digit string', () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateOtp()
      expect(code).toMatch(/^[0-9]{6}$/)
      expect(code).toHaveLength(6)
    }
  })

  it('respects a custom number of digits', () => {
    expect(generateOtp(4)).toMatch(/^[0-9]{4}$/)
  })
})
