/** Canonical form of an e-mail address: trimmed and lowercased (RN-1). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** `minutes` from `from`, defaulting to now. */
export function minutesFromNow(minutes: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + minutes * 60 * 1000)
}
