/**
 * R1.1 — "Teams have isolated messaging, ACL, governance titles, and a COS."
 *
 * The ACL clause is the one `lib/team-acl.ts` owns (COS is R1.3/R1.4, messaging
 * is R6, titles are R9 — each has its own row and its own guard), and the word
 * carrying the weight is ISOLATED: access to a team is not a property of being
 * an agent, it is a property of belonging to THAT team. So every membership
 * test here is a PAIR — allowed on the agent's own team, denied on the other —
 * because a guard that returned `allowed` unconditionally satisfies "a member
 * can access their team" and violates the rule completely.
 *
 * The two deliberate crossings are asserted too, or "isolated" would be a
 * claim about code nobody checked: a MANAGER reaches every team, and an
 * ORCHESTRATOR reaches its own team only ("not any team", per the guard's own
 * decision-order comment).
 *
 * Anonymous access gets its own test because it is the documented bypass this
 * guard was hardened against (LIB2-CRIT-02, 2026-05-06): the previous "if
 * requestingAgentId is undefined, allow" shortcut let any local or Tailscale
 * peer obtain MANAGER-equivalent team access by simply omitting a header. Both
 * anonymous shapes are driven — no AuthContext at all, and an AuthContext that
 * is present but not system-owner — since "missing context falls through to
 * deny" is exactly the sentence a future refactor would undo.
 *
 * Every assertion pins the REASON, never just `allowed === false`: a bare
 * falsy check passes on ANY earlier refusal in the ladder, so it cannot tell
 * "denied because you are not a member" from "denied because the team does not
 * exist" — and under neuter B that is precisely the difference.
 *
 * `getTeam` / `isManager` / `isOrchestrator` are mocked because they are the
 * guard's DATA SOURCES, not the guard. The decision ladder under test runs for
 * real. (Mocking `checkTeamAccess` itself is what every pre-existing reference
 * to this module does — five files, all `vi.fn(() => ({allowed: true}))` — and
 * is why none of them pins this rule.)
 *
 * Neuter record (2026-07-30), complementary — one per branch of the ladder:
 *   • step 6 `return { allowed: false, reason: 'Access denied: …' }`
 *     → `return { allowed: true }`
 *     → the outsider test and BOTH isolation pairs fail; the anonymous tests
 *       stay green, proving they exercise a different branch.
 *   • delete the `if (!input.requestingAgentId)` deny
 *     → ONLY the two anonymous tests fail — and they fail on the REASON, not on
 *       `allowed`, because the request then falls all the way through to step 6
 *       and is denied for the wrong stated cause. A test asserting only
 *       `allowed === false` would have stayed green through this neuter.
 */
import { describe, it, expect, vi } from 'vitest'
import { checkTeamAccess } from '@/lib/team-acl'
import type { AuthContext } from '@/lib/agent-auth'

const TEAMS: Record<string, { chiefOfStaffId: string; agentIds: string[] }> = {
  'team-alpha': { chiefOfStaffId: 'cos-alpha', agentIds: ['member-alpha'] },
  'team-beta': { chiefOfStaffId: 'cos-beta', agentIds: ['member-beta'] },
}

vi.mock('@/lib/governance', () => ({
  isManager: (agentId: string) => agentId === 'the-manager',
  // Orchestrator authority is scoped to ONE team by design.
  isOrchestrator: (agentId: string, teamId: string) =>
    agentId === 'orch-of-alpha' && teamId === 'team-alpha',
}))

vi.mock('@/lib/team-registry', () => ({
  getTeam: (teamId: string) => TEAMS[teamId] ?? null,
}))

/** Only `isSystemOwner` is read by the guard; the rest of the context is irrelevant here. */
const SYSTEM_OWNER = { isSystemOwner: true } as unknown as AuthContext
const NOT_SYSTEM_OWNER = { isSystemOwner: false } as unknown as AuthContext

describe('R1.1 — a team ACL is ISOLATED: membership does not travel between teams', () => {
  it('denies an agent who belongs to no team', () => {
    const res = checkTeamAccess({ teamId: 'team-alpha', requestingAgentId: 'stranger' })
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/not a member of this team/)
  })

  it('denies an anonymous request with no auth context at all (LIB2-CRIT-02)', () => {
    const res = checkTeamAccess({ teamId: 'team-alpha' })
    expect(res.allowed).toBe(false)
    // The REASON is the assertion: omitting the header must be refused AS
    // anonymous, not silently absorbed by a later branch of the ladder.
    expect(res.reason).toMatch(/anonymous request/)
  })

  it('denies an anonymous request whose auth context is present but not system-owner', () => {
    const res = checkTeamAccess({ teamId: 'team-alpha', authContext: NOT_SYSTEM_OWNER })
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/anonymous request/)
  })

  it('lets a member into their OWN team and keeps them out of another one', () => {
    expect(checkTeamAccess({ teamId: 'team-alpha', requestingAgentId: 'member-alpha' }).allowed).toBe(true)

    const crossing = checkTeamAccess({ teamId: 'team-beta', requestingAgentId: 'member-alpha' })
    expect(crossing.allowed).toBe(false)
    expect(crossing.reason).toMatch(/not a member of this team/)
  })

  it('lets a chief-of-staff into their OWN team and keeps them out of another one', () => {
    expect(checkTeamAccess({ teamId: 'team-alpha', requestingAgentId: 'cos-alpha' }).allowed).toBe(true)

    const crossing = checkTeamAccess({ teamId: 'team-beta', requestingAgentId: 'cos-alpha' })
    expect(crossing.allowed).toBe(false)
    expect(crossing.reason).toMatch(/not a member of this team/)
  })

  it('scopes an ORCHESTRATOR to its own team — the title is not a master key', () => {
    expect(checkTeamAccess({ teamId: 'team-alpha', requestingAgentId: 'orch-of-alpha' }).allowed).toBe(true)

    const crossing = checkTeamAccess({ teamId: 'team-beta', requestingAgentId: 'orch-of-alpha' })
    expect(crossing.allowed).toBe(false)
    expect(crossing.reason).toMatch(/not a member of this team/)
  })

  it('lets a MANAGER into every team — the one deliberate crossing', () => {
    expect(checkTeamAccess({ teamId: 'team-alpha', requestingAgentId: 'the-manager' }).allowed).toBe(true)
    expect(checkTeamAccess({ teamId: 'team-beta', requestingAgentId: 'the-manager' }).allowed).toBe(true)
  })

  it('lets a verified system-owner through (the web-UI path)', () => {
    // Positive control: without this the whole suite would still pass against a
    // guard that denied unconditionally.
    expect(checkTeamAccess({ teamId: 'team-alpha', authContext: SYSTEM_OWNER }).allowed).toBe(true)
  })
})
