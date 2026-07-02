/**
 * L3 (R36-38 audit) — model-ON governance-password rotation propagates to the
 * MAESTRO UserRecord (services/governance-service.ts::setGovernancePassword).
 *
 * THE BUG: under the user-authority model, sudo verifies against the ACTING
 * user's own UserRecord.passwordHash (sudo-auth.ts::resolveSudoPasswordHash →
 * getUser(subject)), NOT the global governance.passwordHash. setGovernancePassword
 * rotated ONLY the global hash, leaving the MAESTRO record on the OLD hash — so
 * the OLD password still minted sudo and the NEW one could not (credential not
 * actually rotated). The fix copies the freshly-written global hash into the
 * MAESTRO record (and ONLY the MAESTRO — the delegate keeps its own per-user
 * credential per R37.4).
 *
 * Isolation (leaf dependencies only — the SUT logic runs for real):
 *   - @/lib/governance: loadGovernance returns a mutable config; setPassword
 *     mutates that config's passwordHash/passwordSetAt exactly as the real one
 *     does (write the new hash + timestamp). isUserAuthorityModelEnabled is the
 *     flag under test. setUserName is a no-op spy.
 *   - @/lib/user-registry: getMaestroUserId / getUser / saveUser back a small
 *     in-memory record map so we can assert WHAT setGovernancePassword wrote.
 *   - verifyPasswordAuto is the REAL argon2 auto-verifier — so "old no longer
 *     mints sudo" is proven against the actual hash that landed on the record,
 *     not a mock equality.
 *
 * These mocks cover only the symbols setGovernancePassword touches; the SUT's
 * own rotation/propagation logic is exercised unmocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UserRecord } from '@/types/user'

// ── @/lib/governance mock: a mutable config + a setPassword that mutates it ──
// We stub argon2 hashing with a deterministic marker hash so the test is fast
// and the assertions are exact, but verifyPasswordAuto stays REAL so the
// round-trip "old fails / new passes" is genuine.
let _governance: { passwordHash: string | null; passwordSetAt: string | null; userAuthorityModelEnabled: boolean }
let _modelOn = false
const setUserNameSpy = vi.fn(async (_name: string) => {})

vi.mock('@/lib/governance', () => ({
  loadGovernance: () => _governance,
  // Mirror the real setPassword side effect: write a NEW argon2 hash + timestamp
  // onto governance. We synthesize a marker hash so the test can assert the exact
  // value propagated, while keeping verifyPasswordAuto able to distinguish it.
  setPassword: vi.fn(async (plaintext: string) => {
    const { hashPassword } = await import('@/lib/argon2')
    _governance.passwordHash = await hashPassword(plaintext)
    _governance.passwordSetAt = new Date().toISOString()
  }),
  setUserName: (...a: [string]) => setUserNameSpy(...a),
  isUserAuthorityModelEnabled: () => _modelOn,
  // The change path verifies currentPassword against the live global hash —
  // verify for real (against _governance.passwordHash) so the change branch is
  // genuinely exercised (mirrors the real lib/governance.verifyPassword).
  verifyPassword: async (plaintext: string) => {
    if (!_governance.passwordHash) return false
    const { verifyPasswordAuto } = await import('@/lib/argon2')
    return verifyPasswordAuto(_governance.passwordHash, plaintext)
  },
  setManager: vi.fn(),
  removeManager: vi.fn(),
  isManager: vi.fn(),
  isChiefOfStaffAnywhere: vi.fn(),
  getManagerId: vi.fn(),
}))

// ── @/lib/user-registry mock: an in-memory record map ────────────────────────
let _users: Map<string, UserRecord>
let _maestroId: string | null
const saveUserSpy = vi.fn(async (rec: UserRecord) => {
  _users.set(rec.id, rec)
  return rec
})
vi.mock('@/lib/user-registry', () => ({
  getMaestroUserId: () => _maestroId,
  getUser: (id: string) => _users.get(id) ?? null,
  saveUser: (rec: UserRecord) => saveUserSpy(rec),
}))

import { setGovernancePassword } from '@/services/governance-service'
import { verifyPasswordAuto } from '@/lib/argon2'

const OLD_PW = 'old-password-123'
const NEW_PW = 'new-password-456'

function makeUser(over: Partial<UserRecord>): UserRecord {
  return {
    id: 'u',
    aid: '',
    name: 'n',
    title: 'user',
    native: true,
    passwordHash: null,
    passwordSetAt: null,
    assistantAgentId: null,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  _modelOn = false
  _users = new Map()
  _maestroId = null
  // Seed governance with the OLD password already set (so a rotation requires
  // currentPassword and exercises the change path).
  const { hashPassword } = await import('@/lib/argon2')
  _governance = {
    passwordHash: await hashPassword(OLD_PW),
    passwordSetAt: new Date().toISOString(),
    userAuthorityModelEnabled: false,
  }
})

describe('setGovernancePassword — model-ON credential rotation (L3 fix)', () => {
  it('rotation propagates the NEW hash to the MAESTRO record so the OLD password no longer mints sudo', async () => {
    _modelOn = true
    const maestro = makeUser({ id: 'maestro-1', title: 'maestro', passwordHash: await import('@/lib/argon2').then(m => m.hashPassword(OLD_PW)) })
    _maestroId = 'maestro-1'
    _users.set('maestro-1', maestro)

    const res = await setGovernancePassword({ password: NEW_PW, currentPassword: OLD_PW })
    expect(res.status).toBe(200)

    // The MAESTRO record was re-saved with the freshly-written global hash.
    expect(saveUserSpy).toHaveBeenCalledTimes(1)
    const saved = _users.get('maestro-1')!
    expect(saved.passwordHash).toBe(_governance.passwordHash)
    expect(saved.passwordHash).not.toBeNull()

    // The crux: sudo reads UserRecord.passwordHash. Against the rotated record,
    // the NEW password verifies and the OLD password does NOT — i.e. the
    // credential is actually rotated (this assertion FAILS before the fix,
    // because the record would still hold the OLD hash).
    expect(await verifyPasswordAuto(saved.passwordHash!, NEW_PW)).toBe(true)
    expect(await verifyPasswordAuto(saved.passwordHash!, OLD_PW)).toBe(false)
  })

  it('does NOT clobber an existing MAESTRO-DELEGATE record (R37.4 — delegate keeps its own credential)', async () => {
    _modelOn = true
    const { hashPassword } = await import('@/lib/argon2')
    const maestro = makeUser({ id: 'maestro-1', title: 'maestro', passwordHash: await hashPassword(OLD_PW) })
    const delegateOwnHash = await hashPassword('delegate-own-pw')
    const delegate = makeUser({ id: 'delegate-1', title: 'maestro-delegate', passwordHash: delegateOwnHash })
    _maestroId = 'maestro-1'
    _users.set('maestro-1', maestro)
    _users.set('delegate-1', delegate)

    await setGovernancePassword({ password: NEW_PW, currentPassword: OLD_PW })

    // Only the maestro was saved; the delegate's record is untouched and still
    // holds its OWN credential (the global password must not overwrite it).
    expect(saveUserSpy).toHaveBeenCalledTimes(1)
    expect(saveUserSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'maestro-1' }))
    const delegateAfter = _users.get('delegate-1')!
    expect(delegateAfter.passwordHash).toBe(delegateOwnHash)
    expect(await verifyPasswordAuto(delegateAfter.passwordHash!, 'delegate-own-pw')).toBe(true)
    expect(await verifyPasswordAuto(delegateAfter.passwordHash!, NEW_PW)).toBe(false)
  })

  it('FLAG-OFF: model disabled → no UserRecord is touched (zero-regression)', async () => {
    _modelOn = false
    // A maestro record exists but the model is OFF: it must be left alone.
    const maestro = makeUser({ id: 'maestro-1', title: 'maestro', passwordHash: await import('@/lib/argon2').then(m => m.hashPassword(OLD_PW)) })
    _maestroId = 'maestro-1'
    _users.set('maestro-1', maestro)

    const res = await setGovernancePassword({ password: NEW_PW, currentPassword: OLD_PW })
    expect(res.status).toBe(200)
    // The global hash WAS rotated (legacy behavior) ...
    expect(await verifyPasswordAuto(_governance.passwordHash!, NEW_PW)).toBe(true)
    // ... but no user record was written under the model-off path.
    expect(saveUserSpy).not.toHaveBeenCalled()
  })

  it('model-ON but no MAESTRO record yet (pre-migration) → password still sets, no throw', async () => {
    _modelOn = true
    _maestroId = null // migration has not created the maestro record yet
    const res = await setGovernancePassword({ password: NEW_PW, currentPassword: OLD_PW })
    expect(res.status).toBe(200)
    expect(saveUserSpy).not.toHaveBeenCalled()
  })
})
