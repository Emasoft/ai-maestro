/**
 * TRDD-91TLL7DW — `notifyTeamAgents` must authorize the CALLER against the named team, and
 * must refuse target agents that are not members of it.
 *
 * Why this file exists: `POST /api/teams/notify` authenticated the caller and then never used
 * `auth` again, so caller-supplied `agentIds[]` reached `notifyTeamAgents` -> `notifyAgent`,
 * which terminates in a tmux send-keys primitive. The service sanitizes the MESSAGE and never
 * asked whether the CALLER may address those agents — cross-agent keystroke injection through
 * the server, available to any authenticated agent of any title.
 *
 * WHY THE GUARD IS IN THE SERVICE AND SO ARE THESE TESTS. The first version of this fix put
 * both checks in the Next.js route. That left the vulnerability FULLY LIVE in headless mode:
 * `services/headless-router.ts` calls notifyTeamAgents directly and never executes
 * `app/api/**`. In a codebase whose second server mode reimplements routes, a route-level
 * guard protects exactly one of the two modes — and a route-level TEST reports it as fixed.
 * So the guards live in the service, and the route keeps one job these tests still cover:
 * handing the service a VERIFIED identity rather than a body field.
 *
 * NAMED NEUTERS — each must redden the test beside it:
 *   1. `if (!access.allowed)` -> `if (false)`      -> "refuses a caller with no access"
 *   2. `if (foreign.length > 0)` -> `if (false)`   -> "refuses target agents outside the team"
 *   3. in the route, spread `...parsed.data` AFTER requestingAgentId
 *                                                  -> "identity comes from auth, not the body"
 * The happy-path test is the non-vacuity control and must stay green under 1 and 2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEAM_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_A = '22222222-2222-4222-8222-222222222222'
const MEMBER_B = '33333333-3333-4333-8333-333333333333'
const OUTSIDER = '44444444-4444-4444-8444-444444444444'

let accessResult: { allowed: boolean; reason?: string } = { allowed: true }
let seenAccessInput: Record<string, unknown> = {}
const notifyAgentSpy = vi.fn(async () => ({ success: true }))

vi.mock('@/lib/team-acl', () => ({
  checkTeamAccess: (input: Record<string, unknown>) => {
    seenAccessInput = input
    return accessResult
  },
}))

vi.mock('@/lib/team-registry', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadTeams: () => [{ id: TEAM_ID, name: 'alpha', agentIds: [MEMBER_A, MEMBER_B] }],
}))

vi.mock('@/lib/notification-service', () => ({
  notifyAgent: (...a: unknown[]) => notifyAgentSpy(...(a as [])),
}))

vi.mock('@/lib/agent-registry', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getAgent: (id: string) => ({ id, name: `agent-${id.slice(0, 4)}`, tmuxSession: 's' }),
}))

describe('notifyTeamAgents — TRDD-91TLL7DW authorization (in the SERVICE, so both modes get it)', () => {
  beforeEach(() => {
    accessResult = { allowed: true }
    seenAccessInput = {}
    notifyAgentSpy.mockClear()
  })

  it('NON-VACUITY CONTROL: a member notifying fellow members is allowed through to delivery', async () => {
    const { notifyTeamAgents } = await import('@/services/teams-service')
    const r = await notifyTeamAgents({
      agentIds: [MEMBER_B],
      teamName: 'alpha',
      requestingAgentId: MEMBER_A,
    })
    expect(r.error).toBeUndefined()
    // Must prove delivery was REACHED. A no-error result with zero notifyAgent calls would
    // mean the happy path short-circuits, and every refusal below would pass for the wrong
    // reason.
    expect(notifyAgentSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses a caller with no access to the team', async () => {
    accessResult = { allowed: false, reason: 'Access denied: not a member' }
    const { notifyTeamAgents } = await import('@/services/teams-service')
    const r = await notifyTeamAgents({
      agentIds: [MEMBER_B],
      teamName: 'alpha',
      requestingAgentId: OUTSIDER,
    })
    expect(r.status).toBe(403)
    // Assert the REASON, not just the status — a bare 403 is equally satisfied by the
    // membership guard below, so status alone cannot tell the two guards apart.
    expect(r.error).toMatch(/not a member/i)
    expect(notifyAgentSpy).not.toHaveBeenCalled()
  })

  it('refuses target agents outside the team even when the caller is authorized', async () => {
    const { notifyTeamAgents } = await import('@/services/teams-service')
    const r = await notifyTeamAgents({
      agentIds: [MEMBER_B, OUTSIDER],
      teamName: 'alpha',
      requestingAgentId: MEMBER_A,
    })
    expect(r.status).toBe(403)
    expect(r.error).toMatch(/not members of team/i)
    expect(notifyAgentSpy).not.toHaveBeenCalled()
  })

  it('refuses an unknown team name rather than notifying on an unresolvable team', async () => {
    const { notifyTeamAgents } = await import('@/services/teams-service')
    const r = await notifyTeamAgents({
      agentIds: [MEMBER_B],
      teamName: 'does-not-exist',
      requestingAgentId: MEMBER_A,
    })
    expect(r.status).toBe(404)
    expect(notifyAgentSpy).not.toHaveBeenCalled()
  })

  it('refuses an anonymous caller — a missing identity is never treated as system-owner', async () => {
    // The failure this pins is specific and has bitten this repo before (LIB2-CRIT-02): a
    // "no agentId means web UI, allow it" shortcut turns an omitted header into full access.
    accessResult = { allowed: false, reason: 'Access denied: anonymous request' }
    const { notifyTeamAgents } = await import('@/services/teams-service')
    const r = await notifyTeamAgents({ agentIds: [MEMBER_B], teamName: 'alpha' })
    expect(r.status).toBe(403)
    expect(notifyAgentSpy).not.toHaveBeenCalled()
    // And the service must actually have consulted the ACL with an undefined id, rather than
    // silently skipping the check when there is no caller.
    expect(seenAccessInput).toHaveProperty('requestingAgentId', undefined)
  })
})
