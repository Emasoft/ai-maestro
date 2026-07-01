/**
 * Unit tests for lib/sudo-auth.ts — the R32 sudo-token store.
 *
 * Covers: operation + subject stored at issue and returned at consume,
 * one-shot consumption, expiry, countBySubject quota math, the legacy
 * unbound-token (operation===undefined) round-trip, AND the SUDO-01/02
 * token-burn hardening: a wrong-subject or wrong-operation consume attempt is
 * rejected WITHOUT burning a still-valid token (authenticate-before-consume).
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
  verifyAndConsumeSudoToken,
  countBySubject,
  activeSudoTokenCount,
} from '@/lib/sudo-auth'

// Predicate that accepts any subject — used where a test cares only about
// validity / one-shot / operation binding, not the subject decision.
const acceptAny = () => true

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

describe('issueSudoToken + verifyAndConsumeSudoToken', () => {
  it('stores operation + subject at issue and returns them at a matching consume', async () => {
    const op = { method: 'DELETE', path: '/api/agents/[id]' }
    const { token } = await issueSudoToken('pw', 'system-owner', op)
    const result = verifyAndConsumeSudoToken(token, { operation: op, acceptSubject: acceptAny })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.subject).toBe('system-owner')
      expect(result.operation).toEqual(op)
    }
  })

  it('is one-shot — a second consume returns unknown', async () => {
    const op = { method: 'PUT', path: '/api/teams/[id]' }
    const { token } = await issueSudoToken('pw', 'system-owner', op)
    const first = verifyAndConsumeSudoToken(token, { operation: op, acceptSubject: acceptAny })
    expect(first.ok).toBe(true)
    const second = verifyAndConsumeSudoToken(token, { operation: op, acceptSubject: acceptAny })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('unknown')
  })

  it('returns missing for a null/empty token', () => {
    const op = { method: 'DELETE', path: '/api/agents/[id]' }
    expect(verifyAndConsumeSudoToken(null, { operation: op, acceptSubject: acceptAny })).toEqual({ ok: false, reason: 'missing' })
    expect(verifyAndConsumeSudoToken('', { operation: op, acceptSubject: acceptAny })).toEqual({ ok: false, reason: 'missing' })
  })

  it('returns unknown for a token never issued', () => {
    const op = { method: 'DELETE', path: '/api/agents/[id]' }
    const result = verifyAndConsumeSudoToken('totally-made-up-token', { operation: op, acceptSubject: acceptAny })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unknown')
  })

  it('legacy unbound token (no operation) matches any operation and returns operation===undefined', async () => {
    const { token } = await issueSudoToken('pw', 'system-owner')
    // An unbound token is consumable for ANY operation.
    const result = verifyAndConsumeSudoToken(token, {
      operation: { method: 'POST', path: '/api/governance/password' },
      acceptSubject: acceptAny,
    })
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
    // Advance well past the 60s TTL. NOTE: verifyAndConsumeSudoToken calls
    // sweep() first, which purges expired records — so a long-expired token
    // surfaces as 'unknown' (record already swept) rather than 'expired'
    // (record still present but past expiry). Both mean "rejected"; the
    // invariant under test is that an expired token is NEVER ok.
    vi.setSystemTime(new Date('2026-06-19T00:05:00Z'))
    const result = verifyAndConsumeSudoToken(token, {
      operation: { method: 'DELETE', path: '/api/agents/[id]' },
      acceptSubject: acceptAny,
    })
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

// ─────────────────────────────────────────────────────────────────────────────
// SUDO-01/02 token-burn hardening — authenticate BEFORE consume. The load-
// bearing property: a mismatched attempt must return a mismatch reason AND leave
// the still-valid token consumable, so it cannot be burned by a wrong request.
describe('verifyAndConsumeSudoToken — verify BEFORE burn (no token-burn on mismatch)', () => {
  it('rejects a SUBJECT mismatch and does NOT burn the token (a later matching consume still works)', async () => {
    const op = { method: 'DELETE', path: '/api/agents/[id]' }
    const { token } = await issueSudoToken('pw', 'system-owner', op)

    // Attacker request: correct token + operation, but the subject predicate
    // rejects the token's stored subject.
    const mismatch = verifyAndConsumeSudoToken(token, { operation: op, acceptSubject: () => false })
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.reason).toBe('subject_mismatch')

    // THE assertion: the victim's token was NOT burned — a legitimate consume
    // (subject accepted, op matches) still succeeds.
    const legit = verifyAndConsumeSudoToken(token, { operation: op, acceptSubject: acceptAny })
    expect(legit.ok).toBe(true)
  })

  it('rejects an OPERATION mismatch and does NOT burn the token (a later matching consume still works)', async () => {
    const boundOp = { method: 'DELETE', path: '/api/agents/[id]' }
    const { token } = await issueSudoToken('pw', 'system-owner', boundOp)

    // Attacker request: correct token + subject, but a DIFFERENT operation.
    const mismatch = verifyAndConsumeSudoToken(token, {
      operation: { method: 'POST', path: '/api/governance/password' },
      acceptSubject: acceptAny,
    })
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.reason).toBe('operation_mismatch')

    // THE assertion: the token survived the wrong-op attempt and is still
    // consumable for its real operation.
    const legit = verifyAndConsumeSudoToken(token, { operation: boundOp, acceptSubject: acceptAny })
    expect(legit.ok).toBe(true)
  })

  it('subject is checked BEFORE operation (a wrong-subject wrong-op attempt reports subject_mismatch, no burn)', async () => {
    const boundOp = { method: 'DELETE', path: '/api/agents/[id]' }
    const { token } = await issueSudoToken('pw', 'system-owner', boundOp)

    const both = verifyAndConsumeSudoToken(token, {
      operation: { method: 'POST', path: '/api/governance/password' },
      acceptSubject: () => false,
    })
    expect(both.ok).toBe(false)
    if (!both.ok) expect(both.reason).toBe('subject_mismatch')

    // Still not burned.
    const legit = verifyAndConsumeSudoToken(token, { operation: boundOp, acceptSubject: acceptAny })
    expect(legit.ok).toBe(true)
  })

  it('happy path: a fully-matching consume burns the token (one-shot) so a replay fails', async () => {
    const op = { method: 'PUT', path: '/api/teams/[id]' }
    const { token } = await issueSudoToken('pw', 'system-owner', op)
    expect(verifyAndConsumeSudoToken(token, { operation: op, acceptSubject: acceptAny }).ok).toBe(true)
    const replay = verifyAndConsumeSudoToken(token, { operation: op, acceptSubject: acceptAny })
    expect(replay.ok).toBe(false)
    if (!replay.ok) expect(replay.reason).toBe('unknown')
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
    // Unbound token → any operation matches; accept any subject to consume it.
    verifyAndConsumeSudoToken(token, {
      operation: { method: 'DELETE', path: '/api/agents/[id]' },
      acceptSubject: acceptAny,
    })
    expect(countBySubject('system-owner')).toBe(before)

    vi.useRealTimers()
  })
})
