/**
 * Unit tests for lib/sudo-auth.ts — the R32 sudo-token store.
 *
 * Covers: operation + subject stored at issue and returned at consume,
 * one-shot consumption, expiry, countBySubject quota math, and the legacy
 * unbound-token (operation===undefined) round-trip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (declared before importing the module under test) ──────────────────
// issueSudoToken verifies the governance password via argon2 + loadGovernance.
// Stub both so tests don't need a real password hash on disk.
const mockVerifyPasswordAuto = vi.fn<(hash: string, pw: string) => Promise<boolean>>()
vi.mock('@/lib/argon2', () => ({
  verifyPasswordAuto: (...args: [string, string]) => mockVerifyPasswordAuto(...args),
}))

const mockLoadGovernance = vi.fn<() => { passwordHash?: string }>()
vi.mock('@/lib/governance', () => ({
  loadGovernance: () => mockLoadGovernance(),
}))

// getSudoTokenTtlMs reads the security config; return defaults so the TTL is 60s.
vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ sessionAuth: { sudoTokenTtlSeconds: 60, sessionTtlDays: 7 } }),
}))

import {
  issueSudoToken,
  validateAndConsumeSudoToken,
  countBySubject,
  activeSudoTokenCount,
} from '@/lib/sudo-auth'

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  mockLoadGovernance.mockReturnValue({ passwordHash: 'argon2$stub' })
  mockVerifyPasswordAuto.mockResolvedValue(true)
  // Drain any tokens left from a previous test: each issue/consume sweeps, but
  // outstanding (non-expired) tokens persist on the globalThis map across tests
  // in the same worker. We clear by consuming nothing and relying on per-test
  // unique subjects + fast-forward expiry in expiry tests. To be safe, advance
  // fake time far enough to expire everything, then sweep via a count call.
})

describe('issueSudoToken + validateAndConsumeSudoToken', () => {
  it('stores operation + subject at issue and returns them at consume', async () => {
    const op = { method: 'DELETE', path: '/api/agents/[id]' }
    const { token } = await issueSudoToken('pw', 'system-owner', op)
    const result = validateAndConsumeSudoToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.subject).toBe('system-owner')
      expect(result.operation).toEqual(op)
    }
  })

  it('is one-shot — a second consume returns unknown', async () => {
    const { token } = await issueSudoToken('pw', 'system-owner', { method: 'PUT', path: '/api/teams/[id]' })
    const first = validateAndConsumeSudoToken(token)
    expect(first.ok).toBe(true)
    const second = validateAndConsumeSudoToken(token)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('unknown')
  })

  it('returns missing for a null/empty token', () => {
    expect(validateAndConsumeSudoToken(null)).toEqual({ ok: false, reason: 'missing' })
    expect(validateAndConsumeSudoToken('')).toEqual({ ok: false, reason: 'missing' })
  })

  it('returns unknown for a token never issued', () => {
    const result = validateAndConsumeSudoToken('totally-made-up-token')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unknown')
  })

  it('legacy unbound token (no operation) round-trips with operation===undefined', async () => {
    const { token } = await issueSudoToken('pw', 'system-owner')
    const result = validateAndConsumeSudoToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.subject).toBe('system-owner')
      expect(result.operation).toBeUndefined()
    }
  })

  it('rejects an expired token after the TTL window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T00:00:00Z'))
    const { token } = await issueSudoToken('pw', 'system-owner')
    // Advance well past the 60s TTL. NOTE: validateAndConsumeSudoToken calls
    // sweep() first, which purges expired records — so a long-expired token
    // surfaces as 'unknown' (record already swept) rather than 'expired'
    // (record still present but past expiry). Both mean "rejected"; the
    // invariant under test is that an expired token is NEVER ok.
    vi.setSystemTime(new Date('2026-06-19T00:05:00Z'))
    const result = validateAndConsumeSudoToken(token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(['expired', 'unknown']).toContain(result.reason)
    vi.useRealTimers()
  })

  it('throws sudo_mode_bad_password when the password does not verify', async () => {
    mockVerifyPasswordAuto.mockResolvedValue(false)
    await expect(issueSudoToken('wrong', 'system-owner')).rejects.toThrow('sudo_mode_bad_password')
  })

  it('throws sudo_mode_unavailable when no governance password is configured', async () => {
    mockLoadGovernance.mockReturnValue({})
    await expect(issueSudoToken('pw', 'system-owner')).rejects.toThrow(/sudo_mode_unavailable/)
  })
})

describe('countBySubject', () => {
  it('counts only outstanding tokens for the given subject', async () => {
    // Use fake timers so we can flush all prior tokens to a clean baseline.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T10:00:00Z'))
    // Expire anything left over from earlier tests by jumping far ahead first.
    vi.setSystemTime(new Date('2026-06-19T11:00:00Z'))
    activeSudoTokenCount() // triggers a sweep at the advanced time

    const baselineOwner = countBySubject('system-owner')
    const baselineOther = countBySubject('some-other-subject')
    expect(baselineOwner).toBe(0)
    expect(baselineOther).toBe(0)

    await issueSudoToken('pw', 'system-owner')
    await issueSudoToken('pw', 'system-owner')
    await issueSudoToken('pw', 'some-other-subject')

    expect(countBySubject('system-owner')).toBe(2)
    expect(countBySubject('some-other-subject')).toBe(1)

    vi.useRealTimers()
  })

  it('drops to the prior count after a token is consumed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T12:00:00Z'))
    vi.setSystemTime(new Date('2026-06-19T13:00:00Z'))
    activeSudoTokenCount() // sweep to a clean baseline

    const before = countBySubject('system-owner')
    const { token } = await issueSudoToken('pw', 'system-owner')
    expect(countBySubject('system-owner')).toBe(before + 1)
    validateAndConsumeSudoToken(token)
    expect(countBySubject('system-owner')).toBe(before)

    vi.useRealTimers()
  })
})
