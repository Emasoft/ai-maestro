/**
 * R12 composition-check — AUTHORITY COMES FROM `governanceTitle`, NEVER FROM `role`.
 * (ai-maestro#122 / TRDD-4Z62YRDG, filed by the assistant-manager from a live session.)
 *
 * THE BUG THIS FORBIDS. The route computed each member's title as
 * `(agent.governanceTitle || agent.role || 'unknown')`. `role` is the MESSAGING role — a
 * DIFFERENT field that merely shares the `AgentRole` vocabulary, and which DEFAULTS to
 * 'autonomous'. Two consequences, and the second is the serious one:
 *
 *   1. an agent with NO governance title was reported as holding the title 'autonomous';
 *   2. an agent whose `role` read 'architect' with `governanceTitle: null` SATISFIED the
 *      ARCHITECT requirement of a governance composition check it had never been granted.
 *
 * (2) is why this is pinned rather than left to the type system: it is a false PASS on a
 * governance gate, produced by a field any caller can set and which nothing treats as
 * authority anywhere else. `isManager()` reads the governance config; the AMP role
 * attestation hardcodes its literals. This route was the outlier.
 *
 * THE FALSIFICATION PAIR — the first test alone is satisfied by a route that always reports
 * 'unknown' and can never find any title. So the second drives the same fixture with a REAL
 * `governanceTitle` and asserts it IS counted. Neither means anything alone; together they
 * pin that the route reads exactly one field.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/route-auth', () => ({
  requireAuth: () => ({ ok: true as const, agentId: null }),
}))

const team = { id: 'team-1', name: 'Team One', agentIds: ['a1'] }
let agentRecord: Record<string, unknown>

vi.mock('@/lib/team-registry', () => ({ getTeam: (id: string) => (id === 'team-1' ? team : null) }))
vi.mock('@/lib/agent-registry', () => ({ getAgent: (id: string) => (id === 'a1' ? agentRecord : null) }))

import { GET } from '@/app/api/teams/[id]/composition-check/route'

async function check() {
  const res = await GET(
    new Request('http://localhost/api/teams/team-1/composition-check') as never,
    { params: Promise.resolve({ id: 'team-1' }) },
  )
  // Field names taken from the route's own return, not guessed — an earlier draft asserted
  // `present`/`missing`, got `undefined`, and one of its assertions passed VACUOUSLY through a
  // `?? []`. Read the shape; never infer it from the variable names inside the handler.
  return res.json() as Promise<{
    presentTitles: string[]
    missingTitles: string[]
    agents: { id: string; name: string; title: string }[]
  }>
}

beforeEach(() => {
  agentRecord = { id: 'a1', name: 'frank' }
})

describe('composition-check reads governanceTitle only', () => {
  it('an untitled agent whose messaging role says "architect" does NOT satisfy ARCHITECT', async () => {
    // The exact shape the bug produced a false pass on: authority-looking value in the
    // non-authority field, no governance title at all.
    agentRecord = { id: 'a1', name: 'frank', governanceTitle: null, role: 'architect' }
    const body = await check()
    expect(body.presentTitles).not.toContain('architect')
    expect(body.missingTitles).toContain('architect')
  })

  it('a DEFAULTED role: "autonomous" is not reported as the agent holding a title', async () => {
    agentRecord = { id: 'a1', name: 'frank', governanceTitle: null, role: 'autonomous' }
    const body = await check()
    // 'autonomous' is not a REQUIRED title, so it never appears in present/missing either way —
    // what must not happen is it being carried as this agent's title in the roster.
    expect(body.agents).toHaveLength(1)  // non-vacuity: the roster really was built
    expect(body.agents.map((a) => a.title)).not.toContain('autonomous')
  })

  it('FALSIFICATION PAIR: a REAL governanceTitle IS counted (so the above is not vacuous)', async () => {
    agentRecord = { id: 'a1', name: 'frank', governanceTitle: 'architect', role: 'autonomous' }
    const body = await check()
    expect(body.presentTitles).toContain('architect')
    expect(body.missingTitles).not.toContain('architect')
  })
})
