import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-DQVPODKW — `POST /api/agents/role-plugins/inject-skill` authorizes the caller.
 *
 * The route used `enforceAuth` — "any authenticated caller can call this"
 * (`lib/route-auth.ts:133-138`). Injecting AI Maestro skills into a shared
 * local-marketplace plugin is a fleet-wide capability change (every agent using the
 * plugin inherits the skills), so authentication standing in for authorization was
 * the same hole the three minting siblings carried. The gate is
 * `authorize(auth, 'manage-skills')` with no target agent: MANAGER and system owner
 * only.
 *
 * WHY NON-SYSTEM-OWNER FIXTURES: `authorize()` grants a system-owner caller
 * everything, so a fixture built on one passes whether or not the gate exists.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The service must never be reached on a denied call — a 403 over a completed
// injection is not a refusal. Mocking it also keeps the test off the real
// ~/agents/role-plugins tree.
const mockInject = vi.fn()
vi.mock('@/services/role-plugin-service', () => ({
  injectAiMaestroSkills: (...a: unknown[]) => mockInject(...a),
}))

function req(body: unknown, token = 'tok') {
  return new Request('http://localhost/api/agents/role-plugins/inject-skill', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }) as never
}

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const COS = { agentId: 'dddddddd-4444-4444-8444-dddddddddddd', governanceTitle: 'chief-of-staff', teamId: 'team-1' }
const MANAGER = { agentId: 'cccccccc-3333-4333-8333-cccccccccccc', governanceTitle: 'manager', teamId: null }

describe('TRDD-DQVPODKW — inject-skill authorizes, not merely authenticates', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockInject.mockReset()
    mockInject.mockResolvedValue(['skill-a'])
  })

  it('refuses a MEMBER — an authenticated agent is not an authorized one', async () => {
    /** Validates that mutating a shared plugin's skills requires manage-skills authority */
    mockAuthenticate.mockReturnValue(MEMBER)
    const { POST } = await import('@/app/api/agents/role-plugins/inject-skill/route')
    const res = await POST(req({ pluginName: 'some-plugin' }) as never)

    expect(res.status).toBe(403)
    // Pin the REASON: `status !== 200` alone is satisfied by the 404
    // plugin-not-found branch, which would pass with the gate deleted.
    const body = await res.json()
    expect(String(body.error)).toMatch(/cannot manage-skills/i)
    expect(mockInject).not.toHaveBeenCalled()
  })

  it('refuses a CHIEF-OF-STAFF — a plugin mutation is fleet-wide, not team-scoped', async () => {
    /** Pins the EMERGENT policy: authorize() has no explicit manage-skills rule, so the COS
     * denial falls out of the general no-target branch ("Chief-of-Staff must specify a target
     * agent"). Without this test a refactor of that general branch would silently change the
     * decided policy with nothing naming it. */
    mockAuthenticate.mockReturnValue(COS)
    const { POST } = await import('@/app/api/agents/role-plugins/inject-skill/route')
    const res = await POST(req({ pluginName: 'some-plugin' }) as never)

    expect(res.status).toBe(403)
    expect(mockInject).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — a MANAGER is NOT refused by the authorization gate', async () => {
    /** Validates the gate can say yes, so the denial above is a decision and not a blanket refusal */
    mockAuthenticate.mockReturnValue(MANAGER)
    const { POST } = await import('@/app/api/agents/role-plugins/inject-skill/route')
    // Nonexistent plugin name on purpose: what happens AFTER the gate (404) is not
    // this file's subject — what matters is the caller was not stopped BY the gate.
    const res = await POST(req({ pluginName: 'no-such-plugin-zzz' }) as never)

    expect(res.status).not.toBe(403)
  })
})

/**
 * NEUTER RUN (2026-08-26 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(!authz\.allowed\)/if (false)/   [inject-skill/route.ts]
 *   → 1 red / 1 green, exactly as predicted:
 *       RED: refuses a MEMBER — an authenticated agent is not an authorized one
 *       green: the MANAGER positive control (a disabled gate refuses nobody)
 */
