import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-DQVPODKW — the three OTHER agent-minting routes authorize the caller.
 *
 * TRDD-F1SL03CK closed `POST /api/agents`: minting an agent requires
 * `authorize(auth, 'create-agent')`, MANAGER or CHIEF-OF-STAFF only (R30.1/R30.2).
 * Three sibling routes mint agents too and were reachable by ANY authenticated
 * agent token of ANY title, because they used `enforceAuth` — whose own docstring
 * (`lib/route-auth.ts:133-138`) says it is for mutations where
 *
 *     "any authenticated caller can call this"
 *
 * It authenticates and returns null. No title check, no ownership check. So the
 * front door was locked and three side doors were not.
 *
 * WHAT MADE IT AN OVERSIGHT RATHER THAN A DECISION: the same subtree's
 * `startup` / `normalize-hosts` / `directory/sync` use `enforceSystemOwner`
 * ("routes that MUST NOT be callable by any agent, no matter how its AID token is
 * scoped"), defined twenty lines away in the same file. Six routes, two guards, and
 * the split did not follow blast radius — the three that MINT AGENTS got the weak one.
 *
 * `createPersona` could not have authorized internally even if it wanted to: its
 * signature (`services/role-plugin-service.ts:1182-1188`) takes no `authContext` at
 * all. The gate has to live at the route, which is where it now is.
 *
 * WHY THESE TESTS USE NON-SYSTEM-OWNER CONTEXTS: `authorize()` grants a
 * system-owner caller everything, so a fixture built on one passes whether or not
 * the gate exists. Every case below carries a real agent identity and a title.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

// `requireAuth` calls `authenticateFromRequest`, NOT `authenticateAgent`. Mocking the
// wrong one is silent: the real authenticator runs, every request 401s, and the 401 is
// indistinguishable from a working denial until you assert the STATUS rather than just
// "not 200". Cost one red run here; recording it so the next reader mocks the seam the
// caller actually traverses.
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The services must never be reached on a denied call. Mocking them also keeps the
// test from minting anything on disk if a gate ever regresses.
const mockCreatePersona = vi.fn()
const mockCreateDockerAgent = vi.fn()
vi.mock('@/services/role-plugin-service', () => ({
  createPersona: (...a: unknown[]) => mockCreatePersona(...a),
}))
vi.mock('@/services/agents-docker-service', () => ({
  createDockerAgent: (...a: unknown[]) => mockCreateDockerAgent(...a),
}))

function req(body: unknown, token = 'tok') {
  return new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }) as never
}

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const MANAGER = { agentId: 'cccccccc-3333-4333-8333-cccccccccccc', governanceTitle: 'manager', teamId: null }

type PostRoute = { POST: (r: never) => Promise<Response> }
const ROUTES: Array<[string, () => Promise<PostRoute>]> = [
  ['create-persona', () => import('@/app/api/agents/create-persona/route')],
  ['create-from-toml', () => import('@/app/api/agents/create-from-toml/route')],
  ['docker/create', () => import('@/app/api/agents/docker/create/route')],
]

describe('TRDD-DQVPODKW — agent-minting routes authorize, not merely authenticate', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockCreatePersona.mockReset()
    mockCreateDockerAgent.mockReset()
    mockCreatePersona.mockResolvedValue({ ok: true })
    mockCreateDockerAgent.mockResolvedValue({ ok: true })
  })

  for (const [name, load] of ROUTES) {
    it(`${name} refuses a MEMBER — an authenticated agent is not an authorized one`, async () => {
      /** Validates that authentication no longer stands in for authorization on an agent-minting route */
      mockAuthenticate.mockReturnValue(MEMBER)
      const { POST } = await load()
      const res = await POST(req({ personaName: 'peter-bot', name: 'x', image: 'y' }))

      expect(res.status).toBe(403)
      // Pin the REASON. `status !== 200` alone is satisfied by a later validation
      // failure (the bodies above are deliberately thin), which would pass with the
      // authorization gate deleted.
      const body = await res.json()
      expect(String(body.error)).toMatch(/cannot create-agent|only MANAGER|chief-of-staff/i)

      // And prove nothing was minted: a refusal that still called the service
      // would be a 403 over a completed side effect.
      expect(mockCreatePersona).not.toHaveBeenCalled()
      expect(mockCreateDockerAgent).not.toHaveBeenCalled()
    })
  }

  it('POSITIVE CONTROL — a MANAGER is NOT refused by the authorization gate', async () => {
    /** Validates the gate can say yes, so the denials above are a decision and not a blanket refusal */
    mockAuthenticate.mockReturnValue(MANAGER)
    const { POST } = await import('@/app/api/agents/create-persona/route')
    const res = await POST(req({ personaName: 'peter-bot' }))

    // What happens AFTER the gate is not this file's subject. What matters is that
    // the caller was not stopped BY the gate — a 403 here would mean the gate
    // refuses everyone, which would make every assertion above vacuous.
    expect(res.status).not.toBe(403)
  })
})

/**
 * NEUTER RUN (2026-08-22 — OBSERVED, restore verified by blob hash): see the card
 * TRDD-DQVPODKW for the recorded red set. Deleting any one route's
 * `authorize(auth, 'create-agent')` call reds that route's denial test and leaves
 * the other two green, which is what proves the three gates are independent rather
 * than one shared guard being exercised three times.
 */
