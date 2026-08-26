/**
 * TRDD-91TLL7DW — `POST /api/teams/notify` must authorize the CALLER against the
 * named team, and must refuse target agents that are not members of it.
 *
 * Why this file exists: the route authenticated the caller and then never used
 * `auth` again, so caller-supplied `agentIds[]` reached `notifyTeamAgents` ->
 * `notifyAgent`, which terminates in a tmux send-keys primitive. The service
 * sanitizes the MESSAGE and never asked whether the CALLER may address those
 * agents — cross-agent keystroke injection through the server, available to any
 * authenticated agent of any title.
 *
 * NAMED NEUTERS — each must redden the test named beside it, or that test is
 * vacuous:
 *   1. delete the `checkTeamAccess` block   -> "refuses a caller with no access to the team"
 *   2. delete the `foreign.length` block    -> "refuses target agents outside the team"
 *   3. delete BOTH                          -> both of the above, and NOT the happy path
 * The happy-path test is the non-vacuity control: it must stay green under every
 * neuter, which is what proves the two refusals above are the guards talking and
 * not an unrelated failure.
 *
 * NEUTER RUN (2026-08-26 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(!access\.allowed\)/if (false)/
 *   → 1 red / 3 green:
 *       refuses a caller with no access to the team
 *
 *   s/if \(foreign\.length > 0\)/if (false)/
 *   → 1 red / 3 green:
 *       refuses target agents outside the team even when the caller is authorized
 *
 * Each neuter reddens EXACTLY the test named for it and nothing else, and the
 * control stays green under both — so the two guards are independently pinned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEAM_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_A = '22222222-2222-4222-8222-222222222222'
const MEMBER_B = '33333333-3333-4333-8333-333333333333'
const OUTSIDER = '44444444-4444-4444-8444-444444444444'

let authResult: Record<string, unknown> = {}
let accessResult: { allowed: boolean; reason?: string } = { allowed: true }
const notifySpy = vi.fn(async () => ({ data: { results: [] } }))

vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: () => authResult,
  buildAuthContext: (a: Record<string, unknown>) => ({ agentId: a.agentId, isSystemOwner: false }),
}))

vi.mock('@/lib/team-acl', () => ({
  checkTeamAccess: () => accessResult,
}))

vi.mock('@/lib/team-registry', () => ({
  loadTeams: () => [{ id: TEAM_ID, name: 'alpha', agentIds: [MEMBER_A, MEMBER_B] }],
}))

vi.mock('@/services/teams-service', () => ({
  notifyTeamAgents: (...args: unknown[]) => notifySpy(...(args as [])),
}))

function req(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

describe('POST /api/teams/notify — TRDD-91TLL7DW authorization', () => {
  beforeEach(() => {
    authResult = { agentId: MEMBER_A }
    accessResult = { allowed: true }
    notifySpy.mockClear()
  })

  it('NON-VACUITY CONTROL: a team member notifying fellow members succeeds and reaches the service', async () => {
    const { POST } = await import('@/app/api/teams/notify/route')
    const res = await POST(req({ agentIds: [MEMBER_B], teamName: 'alpha' }))
    expect(res.status).toBe(200)
    // The control must prove the service was REACHED — a 200 with no call would
    // mean the happy path is short-circuiting somewhere and every refusal below
    // would pass for the wrong reason.
    expect(notifySpy).toHaveBeenCalledTimes(1)
  })

  it('refuses a caller with no access to the team', async () => {
    accessResult = { allowed: false, reason: 'Access denied: not a member' }
    const { POST } = await import('@/app/api/teams/notify/route')
    const res = await POST(req({ agentIds: [MEMBER_B], teamName: 'alpha' }))
    expect(res.status).toBe(403)
    // Assert the REASON, not just the status: a bare 403 is equally satisfied by
    // the membership guard below, so status alone cannot tell the two apart.
    expect((await res.json()).error).toMatch(/not a member/i)
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it('refuses target agents outside the team even when the caller is authorized', async () => {
    const { POST } = await import('@/app/api/teams/notify/route')
    const res = await POST(req({ agentIds: [MEMBER_B, OUTSIDER], teamName: 'alpha' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not members of team/i)
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it('refuses an unknown team name rather than notifying on an unresolvable team', async () => {
    const { POST } = await import('@/app/api/teams/notify/route')
    const res = await POST(req({ agentIds: [MEMBER_B], teamName: 'does-not-exist' }))
    expect(res.status).toBe(404)
    expect(notifySpy).not.toHaveBeenCalled()
  })
})
