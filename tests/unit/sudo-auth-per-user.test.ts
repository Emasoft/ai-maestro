/**
 * R37.4 / R32 — per-user sudo token verification (lib/sudo-auth.ts).
 *
 * issueSudoToken verifies the supplied password against a hash chosen by
 * resolveSudoPasswordHash:
 *   - FLAG OFF (default): the single global governance.passwordHash — identical
 *     to pre-model behavior (the existing tests/lib/sudo-auth.test.ts covers the
 *     happy path; here we assert the flag-off path still uses the global hash and
 *     ignores the subject).
 *   - FLAG ON (R37.4): the ACTING user's own UserRecord.passwordHash (looked up
 *     by subject=userId). While a delegate acts, sudo accepts the DELEGATE's
 *     password (the delegate IS the acting maestro).
 *
 * R32 GUARD: under the model, subject MUST resolve to a USER record. An agent-id
 * subject is REJECTED (sudo is USER-via-UI only) — never silently falling back
 * to the global hash.
 *
 * Isolation:
 *   - @/lib/argon2.verifyPasswordAuto is mocked to compare (hash, pw) literally,
 *     so a test asserts WHICH hash issueSudoToken verified against.
 *   - @/lib/governance is mocked (ESM import) to flip the flag + provide the
 *     global hash.
 *   - @/lib/security-config is mocked for the TTL.
 *   - the runtime require('./user-registry') is redirected to a .cjs stub.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import path from 'path'
import { Module } from 'module'

// verifyPasswordAuto(hash, pw): our mock returns true only when pw matches the
// hash's marker, so the test can prove which hash was used.
const mockVerify = vi.fn<(hash: string, pw: string) => Promise<boolean>>()
vi.mock('@/lib/argon2', () => ({
  verifyPasswordAuto: (...a: [string, string]) => mockVerify(...a),
}))

const mockLoadGovernance = vi.fn<() => { passwordHash?: string | null; userAuthorityModelEnabled?: boolean }>()
const mockIsModelEnabled = vi.fn<() => boolean>()
vi.mock('@/lib/governance', () => ({
  loadGovernance: () => mockLoadGovernance(),
  isUserAuthorityModelEnabled: () => mockIsModelEnabled(),
}))

vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ sessionAuth: { sudoTokenTtlSeconds: 60, sessionTtlDays: 7 } }),
}))

// Redirect the runtime require('./user-registry') to a .cjs stub.
const USER_STUB = path.join(__dirname, '__sudo_auth_stubs__', 'user-registry.cjs')
const _origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request === './user-registry' || request === '@/lib/user-registry' || request.endsWith('/lib/user-registry')) {
    return USER_STUB
  }
  return _origResolve.call(this, request, ...rest)
}
const userStub = require('@/lib/user-registry') as {
  __setUsers: (u: { id: string; passwordHash: string | null; title?: string; deletedAt?: string }[]) => void
  __reset: () => void
}

import { issueSudoToken, validateAndConsumeSudoToken } from '@/lib/sudo-auth'

beforeEach(() => {
  vi.clearAllMocks()
  userStub.__reset()
  // Default: model OFF, global hash set.
  mockIsModelEnabled.mockReturnValue(false)
  mockLoadGovernance.mockReturnValue({ passwordHash: 'GLOBAL_HASH' })
  // verifyPasswordAuto returns true iff pw === ('pw-for-' + hash).
  mockVerify.mockImplementation(async (hash, pw) => pw === `pw-for-${hash}`)
})

describe('FLAG OFF — global governance password (legacy, unchanged)', () => {
  it('verifies against the GLOBAL hash, ignoring the subject', async () => {
    const { token } = await issueSudoToken('pw-for-GLOBAL_HASH', 'system-owner')
    expect(mockVerify).toHaveBeenCalledWith('GLOBAL_HASH', 'pw-for-GLOBAL_HASH')
    const r = validateAndConsumeSudoToken(token)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.subject).toBe('system-owner')
  })

  it('rejects a wrong password against the global hash', async () => {
    await expect(issueSudoToken('wrong', 'system-owner')).rejects.toThrow('sudo_mode_bad_password')
  })

  it('throws sudo_mode_unavailable when no global password is configured', async () => {
    mockLoadGovernance.mockReturnValue({})
    await expect(issueSudoToken('whatever', 'system-owner')).rejects.toThrow(/sudo_mode_unavailable/)
  })

  it('never consults the user registry when the model is off', async () => {
    // No users set; a system-owner subject still works against the global hash.
    await issueSudoToken('pw-for-GLOBAL_HASH', 'system-owner')
    expect(mockVerify).toHaveBeenCalledWith('GLOBAL_HASH', 'pw-for-GLOBAL_HASH')
  })
})

describe('FLAG ON — per-user password (R37.4)', () => {
  beforeEach(() => {
    mockIsModelEnabled.mockReturnValue(true)
  })

  it('verifies against the ACTING user (delegate) own hash, not the maestro/global', async () => {
    userStub.__setUsers([
      { id: 'maestro-1', passwordHash: 'MAESTRO_HASH', title: 'maestro' },
      { id: 'delegate-1', passwordHash: 'DELEGATE_HASH', title: 'maestro-delegate' },
    ])
    // The route binds the token to the ACTIVE user's id (the delegate). The
    // delegate's OWN password must be accepted.
    const { token } = await issueSudoToken('pw-for-DELEGATE_HASH', 'delegate-1')
    expect(mockVerify).toHaveBeenCalledWith('DELEGATE_HASH', 'pw-for-DELEGATE_HASH')
    expect(validateAndConsumeSudoToken(token).ok).toBe(true)
  })

  it("rejects the maestro's password when the subject is the delegate (R37.4)", async () => {
    userStub.__setUsers([{ id: 'delegate-1', passwordHash: 'DELEGATE_HASH', title: 'maestro-delegate' }])
    // Passing the maestro's password (against the delegate subject) must fail —
    // sudo while a delegate acts accepts the DELEGATE's password only.
    await expect(issueSudoToken('pw-for-MAESTRO_HASH', 'delegate-1')).rejects.toThrow('sudo_mode_bad_password')
  })

  it('verifies against a normal user own hash when that user is the subject', async () => {
    userStub.__setUsers([{ id: 'user-7', passwordHash: 'USER7_HASH', title: 'user' }])
    const { token } = await issueSudoToken('pw-for-USER7_HASH', 'user-7')
    expect(mockVerify).toHaveBeenCalledWith('USER7_HASH', 'pw-for-USER7_HASH')
    expect(validateAndConsumeSudoToken(token).ok).toBe(true)
  })

  it('R32 GUARD — an unknown/agent-id subject is REJECTED (never falls back to global)', async () => {
    userStub.__setUsers([{ id: 'user-7', passwordHash: 'USER7_HASH' }])
    // 'agent-abc' is NOT a user id → reject; do NOT verify against the global hash.
    await expect(issueSudoToken('pw-for-GLOBAL_HASH', 'agent-abc')).rejects.toThrow(/sudo_subject_not_a_user/)
    // Critically, the global hash was never tried — proving no R32 fallback hole.
    expect(mockVerify).not.toHaveBeenCalledWith('GLOBAL_HASH', expect.anything())
  })

  it('throws sudo_mode_unavailable when the resolved user has no password set', async () => {
    userStub.__setUsers([{ id: 'user-7', passwordHash: null }])
    await expect(issueSudoToken('whatever', 'user-7')).rejects.toThrow(/sudo_mode_unavailable/)
  })
})
