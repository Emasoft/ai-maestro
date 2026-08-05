/**
 * GET /api/agents/hibernation — the AUTH gate (TRDD-14HI8ZPR).
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT A CURL. An earlier revision of this work shipped a
 * standalone CLI that read `~/.aimaestro` directly with no authentication, dumped the whole fleet
 * roster — every agent uuid, name and tmux session name — and worked with the server DOWN. It was
 * reverted (3f069c22) on the USER's ruling: agent status is not public data, and with no server
 * there is nothing to validate signatures against, so nothing may execute.
 *
 * An unauthenticated `curl` against the running server DOES return 401 — and that proves nothing
 * about this route, because the middleware refuses first and the route was not even in `.next` yet.
 * "An earlier layer refuses first" is exactly how a route-level gate goes untested while looking
 * verified. So this drives the exported GET handler DIRECTLY, with the middleware out of the
 * picture, which is the only altitude at which the route's own check is observable.
 *
 * THE DENIAL ASSERTION IS THAT NOTHING RAN. Asserting `status === 401` alone would pass against a
 * route that gathers the roster first and refuses afterwards — the data would still have been read,
 * and any logging or timing side channel would still have leaked it. So every denial also asserts
 * the service was never called, and that no agent identifier appears in the response body.
 *
 * NEUTER RUN (recorded 2026-08-05): deleting the `if (auth.error)` block from the route reddens all
 * three denial closures below and leaves the positive control green — the split that proves the
 * closures pin the gate rather than the handler merely existing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAgentAuth, mockService } = vi.hoisted(() => ({
  mockAgentAuth: { authenticateFromRequest: vi.fn() },
  mockService: { gatherHibernationRoster: vi.fn() },
}))

vi.mock('@/lib/agent-auth', () => mockAgentAuth)
vi.mock('@/services/agent-hibernation-service', () => mockService)

import { GET } from '@/app/api/agents/hibernation/route'

/** A roster shaped like the real one, so a leak would be visibly present in the body. */
const ROSTER = {
  agents: [
    {
      agentId: 'aaaaaaaa-1111-4111-8111-111111111111',
      name: 'secret-agent-name',
      sessionName: 'secret-agent-name',
      state: 'hibernated',
      reason: 'not persisted and no tmux — cleanly hibernated',
      persisted: false,
      tmux: false,
    },
  ],
  orphanedPersistedSessions: [],
  counts: { running: 0, hibernated: 1, crashed: 0, never_woken: 0, orphaned: 0 },
}

function get() {
  return GET(new Request('http://localhost:23000/api/agents/hibernation') as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockService.gatherHibernationRoster.mockResolvedValue(ROSTER)
})

describe('GET /api/agents/hibernation — auth is required', () => {
  it('an unauthenticated caller is refused, and the roster is never gathered', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ error: 'auth_required', status: 401 })
    const res = await get()
    expect(res.status).toBe(401)
    expect(mockService.gatherHibernationRoster).not.toHaveBeenCalled()
    expect(JSON.stringify(await res.json())).not.toContain('secret-agent-name')
  })

  it('a refusal with no explicit status still fails CLOSED (401), never open', async () => {
    // An auth result carrying an error but no status must not fall through to a 200. `status || 401`
    // is the fail-closed default and this is what pins it.
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ error: 'malformed token' })
    const res = await get()
    expect(res.status).toBe(401)
    expect(mockService.gatherHibernationRoster).not.toHaveBeenCalled()
  })

  it('a 403 principal is refused too, and leaks no agent identifier', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ error: 'forbidden', status: 403 })
    const res = await get()
    expect(res.status).toBe(403)
    expect(mockService.gatherHibernationRoster).not.toHaveBeenCalled()
    const body = JSON.stringify(await res.json())
    for (const leak of ['secret-agent-name', 'aaaaaaaa-1111-4111-8111-111111111111', 'hibernated']) {
      expect(body).not.toContain(leak)
    }
  })

  // POSITIVE CONTROL. Without it every assertion above is satisfied by a handler that refuses
  // everything — including legitimate callers — which would look like a perfectly secure route.
  it('an AUTHENTICATED caller gets the roster', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ agentId: 'caller-1', governanceTitle: 'manager' })
    const res = await get()
    expect(res.status).toBe(200)
    expect(mockService.gatherHibernationRoster).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ counts: { hibernated: 1 } })
  })
})
