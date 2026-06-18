/**
 * Unit tests for lib/sudo-guard.ts — the R32 dual-path guard.
 *
 * USER path: valid op-bound token → allow; wrong op → sudo_operation_mismatch;
 * wrong subject → sudo_subject_mismatch; missing/expired/replayed → sudo_required;
 * forged cookie (auth fails) → 401 with validateAndConsumeSudoToken NOT CALLED
 * (the SUDO-04 regression).
 *
 * AGENT path: MANAGER AID on a delete route → allow (no token consumed);
 * MEMBER AID → 403 aid_title_forbidden; agent on a system-owner-only route →
 * 403; MANAGER on manage-team → allow; non-MANAGER on manage-team → 403; an
 * own-team COS restarting a SESSION → allow (D1 session→agentId resolution).
 *
 * Plus the SYSTEM_OWNER_ONLY_STRICT superset guardrail (Risk R-2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import type { AgentAuthResult } from '@/lib/agent-auth'

// ── Mocks (declared before importing the module under test) ──────────────────

// Every strict route in our tests is treated as strict.
const mockRequiresSudo = vi.fn<(m: string, p: string) => boolean>(() => true)
vi.mock('@/lib/security-registry', () => ({
  requiresSudo: (m: string, p: string) => mockRequiresSudo(m, p),
}))

// The token validator — we assert it is NOT called on the agent path NOR on a
// failed-auth USER request (SUDO-04).
const mockValidateAndConsume = vi.fn()
vi.mock('@/lib/sudo-auth', () => ({
  validateAndConsumeSudoToken: (t: unknown) => mockValidateAndConsume(t),
}))

// The discriminator: a controlled AgentAuthResult per test. buildAuthContext is
// the REAL logic (isSystemOwner = !agentId), reimplemented here in the mock so
// the guard's branch decision matches production exactly.
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

// authorize() — the single RBAC source of truth. Controlled per test.
const mockAuthorize = vi.fn<() => { allowed: boolean; reason?: string }>()
vi.mock('@/lib/authorization', () => ({
  authorize: (...args: unknown[]) => mockAuthorize(...(args as [])),
}))

// getAgentBySession — D1 session→agentId resolution.
const mockGetAgentBySession = vi.fn<(s: string) => { id: string } | null>()
vi.mock('@/lib/agent-registry', () => ({
  getAgentBySession: (s: string) => mockGetAgentBySession(s),
}))

import { requireSudoToken, SYSTEM_OWNER_ONLY_STRICT } from '@/lib/sudo-guard'

// ── Helpers ──────────────────────────────────────────────────────────────────

interface FakeReqOpts {
  sudoToken?: string
  pathname?: string
}
function fakeRequest(opts: FakeReqOpts = {}): import('next/server').NextRequest {
  const headers = new Map<string, string>()
  if (opts.sudoToken !== undefined) headers.set('x-sudo-token', opts.sudoToken)
  return {
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    nextUrl: { pathname: opts.pathname ?? '/api/agents/abc' },
  } as unknown as import('next/server').NextRequest
}

async function bodyOf(res: import('next/server').NextResponse | null): Promise<Record<string, unknown>> {
  if (!res) throw new Error('expected a NextResponse but got null (allow)')
  return (await res.json()) as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequiresSudo.mockReturnValue(true)
})

// ─────────────────────────────────────────────────────────────────────────────
describe('non-strict routes', () => {
  it('returns null (no gate) when the route is not strict', () => {
    mockRequiresSudo.mockReturnValue(false)
    const res = requireSudoToken(fakeRequest(), 'GET', '/api/agents/[id]')
    expect(res).toBeNull()
    expect(mockAuthenticate).not.toHaveBeenCalled()
    expect(mockValidateAndConsume).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('USER / system-owner path', () => {
  beforeEach(() => {
    mockAuthenticate.mockReturnValue({}) // no agentId, no error → system owner
  })

  it('allows when a valid op-bound token matches the route', () => {
    mockValidateAndConsume.mockReturnValue({
      ok: true,
      subject: 'system-owner',
      operation: { method: 'DELETE', path: '/api/agents/[id]' },
    })
    const res = requireSudoToken(fakeRequest({ sudoToken: 't' }), 'DELETE', '/api/agents/[id]')
    expect(res).toBeNull()
  })

  it('allows a legacy unbound token (no operation)', () => {
    mockValidateAndConsume.mockReturnValue({ ok: true, subject: 'system-owner' })
    const res = requireSudoToken(fakeRequest({ sudoToken: 't' }), 'DELETE', '/api/agents/[id]')
    expect(res).toBeNull()
  })

  it('rejects a token bound to a DIFFERENT operation → sudo_operation_mismatch', async () => {
    mockValidateAndConsume.mockReturnValue({
      ok: true,
      subject: 'system-owner',
      operation: { method: 'PUT', path: '/api/teams/[id]' },
    })
    const res = requireSudoToken(fakeRequest({ sudoToken: 't' }), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('sudo_operation_mismatch')
  })

  it('rejects a token whose subject is not system-owner → sudo_subject_mismatch', async () => {
    mockValidateAndConsume.mockReturnValue({ ok: true, subject: 'agent-xyz' })
    const res = requireSudoToken(fakeRequest({ sudoToken: 't' }), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('sudo_subject_mismatch')
  })

  it('rejects a missing token → sudo_required (reason missing)', async () => {
    mockValidateAndConsume.mockReturnValue({ ok: false, reason: 'missing' })
    const res = requireSudoToken(fakeRequest(), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    const body = await bodyOf(res)
    expect(body.error).toBe('sudo_required')
    expect(body.reason).toBe('missing')
  })

  it('rejects an expired token → sudo_required (reason expired)', async () => {
    mockValidateAndConsume.mockReturnValue({ ok: false, reason: 'expired' })
    const res = requireSudoToken(fakeRequest({ sudoToken: 't' }), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).reason).toBe('expired')
  })

  it('rejects a replayed/unknown token → sudo_required (reason unknown)', async () => {
    mockValidateAndConsume.mockReturnValue({ ok: false, reason: 'unknown' })
    const res = requireSudoToken(fakeRequest({ sudoToken: 't' }), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).reason).toBe('unknown')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('SUDO-04 regression — auth-first, never burn a token on a forged cookie', () => {
  it('returns 401 and does NOT call validateAndConsumeSudoToken when auth fails', async () => {
    mockAuthenticate.mockReturnValue({ error: 'Authentication required.', status: 401 })
    const res = requireSudoToken(fakeRequest({ sudoToken: 'forged' }), 'DELETE', '/api/agents/[id]')
    expect(res?.status).toBe(401)
    expect((await bodyOf(res)).error).toBe('Authentication required.')
    // THE assertion: the token validator must not have run.
    expect(mockValidateAndConsume).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('AGENT path (R32 — never sudo)', () => {
  it('MANAGER AID on DELETE /api/agents/[id] → allow, NO token consumed', () => {
    mockAuthenticate.mockReturnValue({ agentId: 'mgr', governanceTitle: 'manager' })
    mockAuthorize.mockReturnValue({ allowed: true })
    const res = requireSudoToken(
      fakeRequest({ pathname: '/api/agents/target-uuid' }),
      'DELETE',
      '/api/agents/[id]'
    )
    expect(res).toBeNull()
    expect(mockValidateAndConsume).not.toHaveBeenCalled()
    // authorize() called with the path-id target.
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'mgr' }),
      'delete-agent',
      'target-uuid'
    )
  })

  it('MEMBER AID on DELETE /api/agents/[id] → 403 aid_title_forbidden', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'mbr', governanceTitle: 'member' })
    mockAuthorize.mockReturnValue({ allowed: false, reason: 'Only MANAGER can delete agents' })
    const res = requireSudoToken(
      fakeRequest({ pathname: '/api/agents/target-uuid' }),
      'DELETE',
      '/api/agents/[id]'
    )
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('aid_title_forbidden')
    expect(mockValidateAndConsume).not.toHaveBeenCalled()
  })

  it('agent on POST /api/governance/password → 403 (system-owner-only set)', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'mgr', governanceTitle: 'manager' })
    const res = requireSudoToken(
      fakeRequest({ pathname: '/api/governance/password' }),
      'POST',
      '/api/governance/password'
    )
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('aid_title_forbidden')
    // System-owner-only routes short-circuit before authorize() is consulted.
    expect(mockAuthorize).not.toHaveBeenCalled()
    expect(mockValidateAndConsume).not.toHaveBeenCalled()
  })

  it('MANAGER on PUT /api/teams/[id] → allow (manage-team)', () => {
    mockAuthenticate.mockReturnValue({ agentId: 'mgr', governanceTitle: 'manager' })
    mockAuthorize.mockReturnValue({ allowed: true })
    const res = requireSudoToken(
      fakeRequest({ pathname: '/api/teams/team-uuid' }),
      'PUT',
      '/api/teams/[id]'
    )
    expect(res).toBeNull()
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'mgr' }),
      'manage-team',
      undefined // manage-team has no path target
    )
  })

  it('non-MANAGER on PUT /api/teams/[id] → 403', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'cos', governanceTitle: 'chief-of-staff' })
    mockAuthorize.mockReturnValue({ allowed: false, reason: 'Only MANAGER can manage teams' })
    const res = requireSudoToken(
      fakeRequest({ pathname: '/api/teams/team-uuid' }),
      'PUT',
      '/api/teams/[id]'
    )
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('aid_title_forbidden')
  })

  it('an unmapped strict route fails CLOSED for an agent', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'mgr', governanceTitle: 'manager' })
    const res = requireSudoToken(
      fakeRequest({ pathname: '/api/v1/agents/me' }),
      'DELETE',
      '/api/v1/agents/me'
    )
    expect(res?.status).toBe(403)
    expect((await bodyOf(res)).error).toBe('aid_title_forbidden')
    expect(mockAuthorize).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('AGENT path — session routes (D1 session→agentId resolution)', () => {
  it('resolves the session name to an agentId and passes it to authorize()', () => {
    mockAuthenticate.mockReturnValue({ agentId: 'cos', governanceTitle: 'chief-of-staff', teamId: 'team-1' })
    mockGetAgentBySession.mockReturnValue({ id: 'resolved-agent-uuid' })
    mockAuthorize.mockReturnValue({ allowed: true })
    const res = requireSudoToken(
      fakeRequest({ pathname: '/api/sessions/my-session/restart' }),
      'POST',
      '/api/sessions/[id]/restart'
    )
    expect(res).toBeNull()
    expect(mockGetAgentBySession).toHaveBeenCalledWith('my-session')
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'cos' }),
      'restart-session',
      'resolved-agent-uuid'
    )
    expect(mockValidateAndConsume).not.toHaveBeenCalled()
  })

  it('an own-team COS restarting a resolvable own-team session is allowed', () => {
    mockAuthenticate.mockReturnValue({ agentId: 'cos', governanceTitle: 'chief-of-staff', teamId: 'team-1' })
    mockGetAgentBySession.mockReturnValue({ id: 'member-uuid' })
    // authorize() returns allowed because the resolved target is in the COS's team.
    mockAuthorize.mockReturnValue({ allowed: true })
    const res = requireSudoToken(
      fakeRequest({ pathname: '/api/sessions/member-session/stop' }),
      'POST',
      '/api/sessions/[id]/stop'
    )
    expect(res).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('SYSTEM_OWNER_ONLY_STRICT superset guardrail (Risk R-2)', () => {
  it('contains every strict route whose handler imports enforceSystemOwner', () => {
    const repoRoot = path.resolve(__dirname, '..', '..')
    const registry = JSON.parse(
      readFileSync(path.join(repoRoot, 'security-registry.json'), 'utf8')
    ) as { entries: Record<string, string> }

    const offenders: string[] = []
    for (const key of Object.keys(registry.entries)) {
      // key is METHOD_/api/path-template
      const m = key.match(/^([A-Z]+)_(.+)$/)
      if (!m) continue
      const method = m[1]
      const template = m[2]
      const routeKey = `${method} ${template}`

      // Resolve the route's file path from the template:
      // /api/foo/[id]/bar → app/api/foo/[id]/bar/route.ts
      const routeFile = path.join(repoRoot, 'app', template, 'route.ts')
      let src: string
      try {
        if (!statSync(routeFile).isFile()) continue
        src = readFileSync(routeFile, 'utf8')
      } catch {
        continue
      }
      if (src.includes('enforceSystemOwner')) {
        if (!SYSTEM_OWNER_ONLY_STRICT.has(routeKey)) {
          offenders.push(routeKey)
        }
      }
    }

    expect(
      offenders,
      `These strict routes import enforceSystemOwner but are NOT in SYSTEM_OWNER_ONLY_STRICT: ${offenders.join(', ')}`
    ).toEqual([])
  })

  // Sanity: the readdir import is used (keeps lint quiet) and the repo layout is intact.
  it('app/api directory exists', () => {
    const repoRoot = path.resolve(__dirname, '..', '..')
    const apiDir = path.join(repoRoot, 'app', 'api')
    expect(readdirSync(apiDir).length).toBeGreaterThan(0)
  })
})
