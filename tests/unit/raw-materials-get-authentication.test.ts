import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-DQVPODKW item 9 — `GET /api/agents/creation-helper/raw-materials` authenticates.
 *
 * The route's own POST ran `enforceAuth` while the GET handler took no request at
 * all — an anonymous read of the wizard's upload state. Found during the
 * first-hand verification of the 7 sub-agent-reported creation-helper routes
 * (the sub-agent's sweep keyed on the POST handlers and missed it). No caller
 * needs anonymity: Haephestos reads the state FILE directly, and the dashboard
 * is an authenticated browser session.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

function getReq() {
  return new Request('http://localhost/api/agents/creation-helper/raw-materials', {
    method: 'GET',
  }) as never
}

describe('TRDD-DQVPODKW — raw-materials GET authenticates', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
  })

  it('refuses an unauthenticated GET', async () => {
    /** Validates the wizard upload state is no longer anonymously readable */
    mockAuthenticate.mockReturnValue({ error: 'Missing or invalid authorization', status: 401 })
    const { GET } = await import('@/app/api/agents/creation-helper/raw-materials/route')
    const res = await GET(getReq() as never)
    expect(res.status).toBe(401)
  })

  it('POSITIVE CONTROL — an authenticated GET passes the gate', async () => {
    /** Validates the gate can say yes, so the refusal above is the gate and not a broken route */
    mockAuthenticate.mockReturnValue({ agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member' })
    const { GET } = await import('@/app/api/agents/creation-helper/raw-materials/route')
    const res = await GET(getReq() as never)
    // Whatever the state file holds (or ENOENT default), the caller was not
    // stopped BY the gate.
    expect(res.status).not.toBe(401)
  })
})

/**
 * NEUTER RUN (recorded after first green run):
 *   mutation: s/if (authErr) return authErr/if (false) return authErr/ in the GET
 *   predicted: the unauthenticated-refusal test reds, the positive control stays green.
 */
