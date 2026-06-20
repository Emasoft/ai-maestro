/**
 * Model-ON mint→consume round-trip tests for lib/sudo-guard.ts
 * (security remediation: sudo-subject-model — finding L2).
 *
 * WHY THIS FILE EXISTS (separate from tests/lib/sudo-guard.test.ts):
 *   The canonical adjacent guard test mocks validateAndConsumeSudoToken
 *   wholesale, so it only ever exercises the legacy 'system-owner' subject and
 *   NEVER proves that a token whose subject is the active-maestro user id is
 *   ACCEPTED with the user-authority model ON. That is the exact path of the
 *   L2 fix. These tests close that gap with a GENUINE round-trip: a real token
 *   is minted via the real issueSudoToken into the real globalThis token store,
 *   then consumed by the guard's own real call to validateAndConsumeSudoToken.
 *
 * THE FIX UNDER TEST (lib/sudo-guard.ts ~line 148):
 *   The mint binds a sudo token's subject to ctx.userId under the model, so the
 *   guard's accepted-subject set is model-aware:
 *     - model OFF → exactly {'system-owner'}  (byte-equivalent to pre-model)
 *     - model ON  → {'system-owner', getActiveMaestroUserId()}
 *   Without the widening, EVERY sudo-gated route 403s with the model on, because
 *   the real consume returns a UUID subject the unchanged check rejected.
 *
 * Each ALLOW test below FAILS before the fix (guard 403s sudo_subject_mismatch
 * on the UUID subject) and PASSES after it. The negative tests pin the
 * properties the widening must NOT weaken (only the active-maestro id is added,
 * never an arbitrary UUID; flag-off stays system-owner-only; one-shot + op
 * binding preserved).
 *
 * MOCKING NOTE — two seams for the same dependency:
 *   lib/sudo-guard.ts reads './governance' + './user-registry' via a runtime
 *   require() (deliberate, to avoid a static import cycle). vitest's vi.mock /
 *   resolve.alias do NOT intercept a runtime require, so — exactly like
 *   tests/unit/sudo-auth-per-user.test.ts — we patch Module._resolveFilename to
 *   redirect those specifiers to .cjs stubs. lib/sudo-auth.ts's STATIC
 *   `import ... from './governance'` is the other seam, handled by vi.mock.
 *   Both seams read the SAME globalThis flag (__sudoGuardModelOnFlag) so the
 *   model is consistent across the mint (sudo-auth) and the consume (guard).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import { Module } from 'module'
import type { AgentAuthResult } from '@/lib/agent-auth'

// Shared, test-controlled state read by BOTH seams of each dependency.
interface ModelOnGlobals {
  __sudoGuardModelOnFlag?: boolean
  __sudoGuardModelOnUR?: { users: { id: string; passwordHash: string | null; deletedAt?: string }[]; activeMaestroId: string | null }
}
const g = globalThis as unknown as ModelOnGlobals
function urState() {
  if (!g.__sudoGuardModelOnUR) g.__sudoGuardModelOnUR = { users: [], activeMaestroId: null }
  return g.__sudoGuardModelOnUR
}

// A stable userId that getActiveMaestroUserId() reports under the model and that
// the mint stamps as the token subject. The L2 fix is exactly about the guard
// accepting THIS value (and not 'system-owner') under the model.
const MAESTRO_UUID = '11111111-1111-4111-8111-111111111111'
const OTHER_UUID = '22222222-2222-4222-8222-222222222222'

// ── Redirect the RUNTIME require() seams to .cjs stubs (governance + user-registry) ──
// (The static-import seams are handled by vi.mock below.)
const GOV_STUB = path.join(__dirname, '__sudo_guard_model_on_stubs__', 'governance.cjs')
const UR_STUB = path.join(__dirname, '__sudo_guard_model_on_stubs__', 'user-registry.cjs')
const _origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request === './governance' || request === '@/lib/governance' || request.endsWith('/lib/governance')) {
    return GOV_STUB
  }
  if (request === './user-registry' || request === '@/lib/user-registry' || request.endsWith('/lib/user-registry')) {
    return UR_STUB
  }
  return _origResolve.call(this, request, ...rest)
}

// ── Mocks for the STATIC-import (ESM) seams ──────────────────────────────────

// Treat every route in these tests as strict.
const mockRequiresSudo = vi.fn<(m: string, p: string) => boolean>(() => true)
vi.mock('@/lib/security-registry', () => ({
  requiresSudo: (m: string, p: string) => mockRequiresSudo(m, p),
}))

// The caller is the USER / system owner: no agentId, no error → the guard takes
// the sudo path (buildAuthContext.isSystemOwner = !agentId, mirrored here).
const mockAuthenticate = vi.fn<() => AgentAuthResult>()
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: () => mockAuthenticate(),
  buildAuthContext: (r: AgentAuthResult) => ({
    agentId: r.agentId,
    isSystemOwner: !r.agentId,
    governanceTitle: r.governanceTitle,
    teamId: r.teamId,
  }),
}))

// authorize() / getAgentBySession are only used on the AGENT branch, which these
// tests never take; stub them so the module imports cleanly.
vi.mock('@/lib/authorization', () => ({ authorize: () => ({ allowed: true }) }))
vi.mock('@/lib/agent-registry', () => ({ getAgentBySession: () => null }))

// lib/sudo-auth.ts's STATIC `import { ..., isUserAuthorityModelEnabled } from './governance'`.
// Reads the SAME globalThis flag the runtime-require governance stub reads.
vi.mock('@/lib/governance', () => ({
  isUserAuthorityModelEnabled: () => g.__sudoGuardModelOnFlag === true,
  loadGovernance: () => ({ passwordHash: 'argon2$stub' }),
}))

// Mint verifies the password via argon2 — stub the verify so we can mint a real
// token for any subject without a real hash on disk (same technique as the
// canonical lib/sudo-auth.test.ts). The TOKEN STORE + consume path stay REAL.
vi.mock('@/lib/argon2', () => ({
  verifyPasswordAuto: () => Promise.resolve(true),
}))

// 60s TTL so freshly-minted tokens are valid when the guard consumes them.
vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ sessionAuth: { sudoTokenTtlSeconds: 60, sessionTtlDays: 7 } }),
}))

// REAL sudo-auth (NOT mocked) — this is the round-trip: real mint, real store,
// real consume invoked from inside the guard.
import { issueSudoToken } from '@/lib/sudo-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

// ── Helpers ──────────────────────────────────────────────────────────────────

function reqWithToken(token: string, pathname = '/api/agents/abc'): import('next/server').NextRequest {
  const headers = new Map<string, string>([['x-sudo-token', token]])
  return {
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    nextUrl: { pathname },
  } as unknown as import('next/server').NextRequest
}

async function bodyOf(res: import('next/server').NextResponse | null): Promise<Record<string, unknown>> {
  if (!res) throw new Error('expected a NextResponse but got null (allow)')
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequiresSudo.mockReturnValue(true)
  mockAuthenticate.mockReturnValue({}) // system owner: no agentId, no error
  g.__sudoGuardModelOnFlag = false
  g.__sudoGuardModelOnUR = {
    // The mint resolves the acting user's hash under the model; give both UUIDs a hash.
    users: [
      { id: MAESTRO_UUID, passwordHash: 'argon2$stub' },
      { id: OTHER_UUID, passwordHash: 'argon2$stub' },
    ],
    activeMaestroId: MAESTRO_UUID,
  }
})

// ─────────────────────────────────────────────────────────────────────────────
describe('model ON — mint→consume round-trip (the L2 fix)', () => {
  it('ACCEPTS a real token minted with subject = the active-maestro user id', async () => {
    g.__sudoGuardModelOnFlag = true
    // Real mint: under the model the route stamps the acting user's id as subject.
    const { token } = await issueSudoToken('pw', MAESTRO_UUID, {
      method: 'DELETE',
      path: '/api/agents/[id]',
    })
    // Real consume happens INSIDE the guard. Pre-fix this 403s (the UUID subject
    // was not in {'system-owner'}); post-fix the guard widens to include the
    // active-maestro id, so it ALLOWS.
    const res = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(res).toBeNull()
  })

  it('ACCEPTS a model-bound UUID-subject token even with NO operation (unbound)', async () => {
    g.__sudoGuardModelOnFlag = true
    const { token } = await issueSudoToken('pw', MAESTRO_UUID) // legacy/unbound
    const res = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(res).toBeNull()
  })

  it('still ACCEPTS the legacy system-owner subject under the model (superset, not replacement)', async () => {
    g.__sudoGuardModelOnFlag = true
    // A token issued before the flip carries subject 'system-owner'. Make the
    // stub resolve it to a user so the model-ON mint hash lookup succeeds.
    urState().users.push({ id: 'system-owner', passwordHash: 'argon2$stub' })
    const { token } = await issueSudoToken('pw', 'system-owner', {
      method: 'DELETE',
      path: '/api/agents/[id]',
    })
    const res = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(res).toBeNull()
  })

  it('REJECTS a real token whose subject is a DIFFERENT user id → sudo_subject_mismatch', async () => {
    g.__sudoGuardModelOnFlag = true
    // The widening adds ONLY getActiveMaestroUserId() (= MAESTRO_UUID), never an
    // arbitrary UUID. A token minted for OTHER_UUID must still be rejected.
    const { token } = await issueSudoToken('pw', OTHER_UUID, {
      method: 'DELETE',
      path: '/api/agents/[id]',
    })
    const res = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('sudo_subject_mismatch')
  })

  it('preserves OP-BINDING under the model — UUID subject, wrong op → sudo_operation_mismatch', async () => {
    g.__sudoGuardModelOnFlag = true
    const { token } = await issueSudoToken('pw', MAESTRO_UUID, {
      method: 'PUT',
      path: '/api/teams/[id]',
    })
    // Subject is accepted (active-maestro id), but the op binding fails first-class.
    const res = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('sudo_operation_mismatch')
  })

  it('preserves ONE-SHOT under the model — a second consume of the same token 403s', async () => {
    g.__sudoGuardModelOnFlag = true
    const { token } = await issueSudoToken('pw', MAESTRO_UUID, {
      method: 'DELETE',
      path: '/api/agents/[id]',
    })
    const first = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(first).toBeNull() // consumed
    const second = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(second?.status).toBe(403)
    expect((await bodyOf(second)).reason).toBe('unknown') // token already burned
  })

  it('does not widen when getActiveMaestroUserId() returns null (model on, no active maestro)', async () => {
    g.__sudoGuardModelOnFlag = true
    urState().activeMaestroId = null
    // No active maestro id → the set stays {'system-owner'}; a UUID-subject token
    // must be rejected, so a stale model-on configuration can only DENY.
    const { token } = await issueSudoToken('pw', MAESTRO_UUID, {
      method: 'DELETE',
      path: '/api/agents/[id]',
    })
    const res = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('sudo_subject_mismatch')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('model OFF — byte-equivalent to pre-model (zero-regression invariant)', () => {
  it('ACCEPTS a real system-owner token (legacy path, unchanged)', async () => {
    g.__sudoGuardModelOnFlag = false
    // Model OFF: the mint uses the global hash and ignores the subject, so a
    // 'system-owner' token mints without any user lookup.
    const { token } = await issueSudoToken('pw', 'system-owner', {
      method: 'DELETE',
      path: '/api/agents/[id]',
    })
    const res = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(res).toBeNull()
  })

  it('REJECTS a UUID-subject token with the model OFF → sudo_subject_mismatch', async () => {
    g.__sudoGuardModelOnFlag = false
    // With the model OFF the guard NEVER consults getActiveMaestroUserId(); the
    // only valid subject is 'system-owner'. (A model-OFF mint never stamps a UUID
    // subject in production — the route passes 'system-owner' — but the model-OFF
    // mint branch ignores the subject, so we CAN mint a UUID-subject token here to
    // pin the guard's model-OFF acceptance set.)
    const { token } = await issueSudoToken('pw', MAESTRO_UUID, {
      method: 'DELETE',
      path: '/api/agents/[id]',
    })
    const res = requireSudoToken(reqWithToken(token), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('sudo_subject_mismatch')
  })
})
