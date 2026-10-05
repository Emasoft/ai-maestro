/**
 * TRDD-0IPK36MS — the RBAC 403/401 authorization test SCEN-001 S014/S032
 * defer to but that never existed.
 *
 * Exercises the REAL post-authentication RBAC decision for governance title
 * changes: real AID governance Bearer tokens (minted via the REAL
 * `lib/aid-token.ts` engine), fed through the REAL, UNMOCKED
 * `lib/agent-auth.ts` (`authenticateFromRequest`, `buildAuthContext`) and
 * `lib/authorization.ts` (`authorize()`, action `'change-title'`) — the
 * single source of truth `ChangeTitle`'s own Gate 0 (`gate0Auth`) calls, and
 * that `PATCH /api/agents/[id]`'s agent-path guard (`requireAidTitle`) would
 * ALSO call for any route mapped to it.
 *
 * (Verified 2026-07 while writing this test: `PATCH /api/agents/[id]` itself
 * has NO entry in `lib/sudo-guard.ts`'s `STRICT_AGENT_RULES`, so an AGENT
 * Bearer caller — MEMBER, COS, or even MANAGER — is fail-closed rejected by
 * that route's guard before `authorize()` is ever reached; governance title
 * changes over that route are web-UI/system-owner-only today. This is an
 * existing, separate belt-and-braces layer, not the RBAC decision itself —
 * testing at the `authorize()` boundary directly is what SCEN-001 S014/S032
 * defer to and is stable regardless of which HTTP route wires it.)
 *
 * FILESYSTEM STRATEGY: `lib/authorization.ts`'s team-registry reads (`cosSupervision` / `orchestratorOverAssignee`) and
 * `lib/aid-token.ts`'s token store both read real on-disk files (under
 * `~/.aimaestro/`). Rather than `vi.mock('@/lib/team-registry', ...)` — which
 * does NOT get picked up by `lib/authorization.ts`'s internal
 * `require('./team-registry')` under this project's Vitest/vite-node setup
 * (verified empirically: the mock is never observed, the relative require
 * fails to resolve, and the team lookup fails closed to "team-less"
 * every time, silently making every COS-own-team assertion pass or fail for
 * the WRONG reason) — this file leaves BOTH `lib/team-registry.ts` and
 * `lib/aid-token.ts` completely real and unmocked, and instead stubs the
 * underlying `fs` calls for their two specific on-disk files so their real,
 * unmocked logic runs against synthetic fixture content. This is equivalent
 * to seeding a database for an integration test — the DECISION logic in
 * lib/authorization.ts and the token engine in lib/aid-token.ts are both
 * entirely real.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const fsStubFns = vi.hoisted(() => {
  // require() (not a static import) is necessary here: vi.hoisted() callbacks
  // run before other module-level imports, so this is the only way to reach
  // the real, un-mocked 'fs'/'path' modules from inside the factory.
  const realFs = require('fs') as typeof import('fs')
  const nodePath = require('path') as typeof import('path')

  const isTokenStorePath = (p: unknown) => typeof p === 'string' && p.includes('governance-tokens')
  const teamsFileSuffix = nodePath.join('teams', 'teams.json')
  const isTeamsFilePath = (p: unknown) => typeof p === 'string' && p.endsWith(teamsFileSuffix)
  const isTeamsDirPath = (p: unknown) => typeof p === 'string' && p.endsWith(nodePath.sep + 'teams')

  // Fixture team data — real lib/team-registry.ts::loadTeams() reads and
  // parses this exactly as it would a real teams.json on disk. `type:
  // 'closed'` avoids loadTeams()'s convergent-migration write path.
  const teamsFixtureJson = JSON.stringify({
    teams: [
      { id: 'team-a', name: 'Team A', type: 'closed', chiefOfStaffId: 'cos-a', orchestratorId: null, agentIds: ['cos-a', 'member-a1', 'member-a2'] },
      { id: 'team-b', name: 'Team B', type: 'closed', chiefOfStaffId: 'cos-b', orchestratorId: null, agentIds: ['cos-b', 'member-b1'] },
    ],
  })

  // Per-test override of the teams store: `json` replaces the fixture above, `throws` makes the read fail.
  // beforeEach resets both, so the default fixture is what every other test sees.
  const teamsState = { json: null as string | null, throws: false }

  return {
    ...realFs,
    teamsState,
    existsSync: (p: unknown) => {
      if (isTokenStorePath(p)) return false
      if (isTeamsFilePath(p)) return true
      if (isTeamsDirPath(p)) return true // ensureTeamsDir() skips mkdirSync
      return realFs.existsSync(p as never)
    },
    mkdirSync: (p: unknown, opts?: unknown) =>
      (isTokenStorePath(p) || isTeamsDirPath(p)) ? undefined : realFs.mkdirSync(p as never, opts as never),
    readFileSync: (p: unknown, enc?: unknown) => {
      if (isTokenStorePath(p)) return '[]'
      if (isTeamsFilePath(p)) {
        if (teamsState.throws) throw new Error('EIO: simulated team store read failure')
        return teamsState.json ?? teamsFixtureJson
      }
      return realFs.readFileSync(p as never, enc as never)
    },
    writeFileSync: (p: unknown, data?: unknown, opts?: unknown) =>
      (isTokenStorePath(p) || isTeamsFilePath(p)) ? undefined : realFs.writeFileSync(p as never, data as never, opts as never),
    renameSync: (p: unknown, q: unknown) =>
      (isTokenStorePath(p) || isTeamsFilePath(p)) ? undefined : realFs.renameSync(p as never, q as never),
  }
})
vi.mock('fs', () => ({ default: fsStubFns, ...fsStubFns }))

// R34.1 SPEND gate + sudo TTL config — enforceAidAssociation OFF is the
// shipped default; this mock just makes that default explicit and hermetic
// (assertAidLedgerBacked short-circuits to `true` without touching
// lib/aid-ledger-authority at all when this flag is off).
vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({
    ledger: { enforceAidAssociation: false },
    sessionAuth: { sudoTokenTtlSeconds: 60, sessionTtlDays: 7 },
  }),
}))

// Spies for the registry write path — used to prove a DENIED ChangeTitle
// call never reaches a mutation. Not used to fake the auth decision itself.
const mockGetAgent = vi.fn()
// isSoftDeletedAgent reads the STRICT registry (TRDD-8E6XMDEX); default: a readable, empty registry
const mockLoadAgentsStrict = vi.fn((): unknown[] => [])
const mockUpdateAgent = vi.fn()
vi.mock('@/lib/agent-registry', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
  loadAgents: () => [],
  loadAgentsStrict: () => mockLoadAgentsStrict(),
}))

import { issueGovernanceToken } from '@/lib/aid-token'
import { authenticateFromRequest, buildAuthContext, type AgentAuthResult } from '@/lib/agent-auth'
import { authorize, decideFromPolicy, ACTION_POLICY, type AuthAction } from '@/lib/authorization'
import { ChangeTitle } from '@/services/element-management-service'

function requestWith(headers: Record<string, string>, agentId = 'member-a2'): NextRequest {
  return new NextRequest(`http://localhost:23000/api/agents/${agentId}`, {
    method: 'PATCH',
    headers,
  })
}

let memberToken: string
let cosAToken: string
let managerToken: string

beforeAll(async () => {
  // Real AID governance tokens — minted through the REAL crypto/hash/store
  // engine in lib/aid-token.ts, embedding governanceTitle + teamId exactly
  // as a live agent's token would.
  memberToken = (await issueGovernanceToken('member-a1', 'member-a1', 'member', 'team-a')).access_token
  cosAToken = (await issueGovernanceToken('cos-a', 'cos-a', 'chief-of-staff', 'team-a')).access_token
  managerToken = (await issueGovernanceToken('manager-1', 'manager-1', 'manager', null)).access_token
})

beforeEach(() => {
  fsStubFns.teamsState.json = null
  fsStubFns.teamsState.throws = false
  mockGetAgent.mockReset()
  mockLoadAgentsStrict.mockReset()
  mockLoadAgentsStrict.mockImplementation(() => [])
  mockUpdateAgent.mockReset()
})

describe('TRDD-0IPK36MS — RBAC change-title authorization matrix (real AID Bearer tokens)', () => {
  it('MEMBER attempting to change ANOTHER agent\'s title is DENIED', () => {
    const req = requestWith({ Authorization: `Bearer ${memberToken}` })
    const auth = authenticateFromRequest(req)
    expect(auth.error).toBeUndefined()
    expect(auth.agentId).toBe('member-a1')

    const decision = authorize(auth, 'change-title', 'member-a2')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/MANAGER or CHIEF-OF-STAFF/i)
  })

  it('CHIEF-OF-STAFF changing a title for a member of their OWN team is ALLOWED', () => {
    const req = requestWith({ Authorization: `Bearer ${cosAToken}` })
    const auth = authenticateFromRequest(req)
    expect(auth.error).toBeUndefined()
    expect(auth.agentId).toBe('cos-a')
    expect(auth.teamId).toBe('team-a')

    // member-a2 belongs to team-a, the same team as cos-a. The target's title is now read from the registry.
    mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'member' }))
    const decision = authorize(auth, 'change-title', 'member-a2')
    expect(decision.allowed).toBe(true)
  })

  it('CHIEF-OF-STAFF attempting a title change OUTSIDE their team is DENIED', () => {
    const req = requestWith({ Authorization: `Bearer ${cosAToken}` }, 'member-b1')
    const auth = authenticateFromRequest(req)
    expect(auth.error).toBeUndefined()

    // member-b1 belongs to team-b, NOT cos-a's team-a.
    const decision = authorize(auth, 'change-title', 'member-b1')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/own team/i)
  })

  it('MANAGER changing ANY agent\'s title is ALLOWED', () => {
    const req = requestWith({ Authorization: `Bearer ${managerToken}` })
    const auth = authenticateFromRequest(req)
    expect(auth.error).toBeUndefined()
    expect(auth.agentId).toBe('manager-1')

    const decision = authorize(auth, 'change-title', 'member-a2')
    expect(decision.allowed).toBe(true)
  })

  it('MEMBER-denied ChangeTitle call is rejected at Gate 0, BEFORE any agent-registry access (target unchanged)', async () => {
    const req = requestWith({ Authorization: `Bearer ${memberToken}` })
    const auth = authenticateFromRequest(req)
    const authContext = buildAuthContext(auth)
    // Authenticating the caller reads the caller's OWN row (soft-delete check); forget that call so the
    // assertion below sees only what the pipeline itself touches.
    mockGetAgent.mockClear()

    const result = await ChangeTitle('member-a2', 'member', { authContext })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/MANAGER or CHIEF-OF-STAFF/i)
    // Gate 0 returns before Gate 2 ever calls getAgent, and long before any
    // updateAgent write — the target agent record is provably untouched.
    expect(mockGetAgent).not.toHaveBeenCalled()
    expect(mockUpdateAgent).not.toHaveBeenCalled()
  })

  it('a registry read that THROWS for the CALLER\'s own id refuses the credential (fail closed)', () => {
    mockGetAgent.mockImplementation(() => { throw new Error('boom') })
    mockLoadAgentsStrict.mockImplementation(() => { throw new Error('boom') })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const auth = authenticateFromRequest(requestWith({ Authorization: `Bearer ${memberToken}` }))
      expect(auth.error).toMatch(/Invalid or expired governance token/)
      expect(auth.agentId).toBeUndefined()
    } finally { spy.mockRestore() }
  })

  it('no Bearer token but X-Agent-Id present (identity spoofing shape) -> 401, per lib/agent-auth.ts', () => {
    const req = requestWith({ 'X-Agent-Id': 'member-a1' })
    const auth = authenticateFromRequest(req)

    expect(auth.error).toBeDefined()
    expect(auth.status).toBe(401)
    expect(auth.agentId).toBeUndefined()
  })

  it('valid Bearer token but X-Agent-Id claims a DIFFERENT identity -> 403, per lib/agent-auth.ts', () => {
    const req = requestWith({ Authorization: `Bearer ${memberToken}`, 'X-Agent-Id': 'someone-else' })
    const auth = authenticateFromRequest(req)

    expect(auth.error).toBeDefined()
    expect(auth.status).toBe(403)
    expect(auth.agentId).toBeUndefined()
  })
})

/**
 * TRDD-D3RP7KQZ — the self-drive / self-configure split (USER decision 2026-07-09).
 *
 * An agent may DRIVE its own surface and may never RECONFIGURE itself. These
 * tests are written against the boundary that decides it — `authorize()` — so
 * they hold regardless of which HTTP routes are wired to which action.
 *
 * Read the two groups together: the second is what gives the first its meaning.
 * A test suite that only asserted the allows would pass just as happily against
 * an authorize() that allowed an agent everything on itself.
 */
describe('TRDD-D3RP7KQZ — an agent may drive its own surface', () => {
  const asMember = () => {
    const auth = authenticateFromRequest(requestWith({ Authorization: `Bearer ${memberToken}` }))
    expect(auth.agentId).toBe('member-a1')
    return auth
  }

  it('MEMBER sending a command to its OWN terminal is ALLOWED', () => {
    expect(authorize(asMember(), 'send-command', 'member-a1').allowed).toBe(true)
  })

  it('MEMBER hibernating ITSELF is ALLOWED', () => {
    expect(authorize(asMember(), 'hibernate-agent', 'member-a1').allowed).toBe(true)
  })

  it('MEMBER sending a command to ANOTHER agent is DENIED', () => {
    // The self-drive exemption must not become a general send-command grant:
    // driving your own terminal says nothing about driving a teammate's.
    const decision = authorize(asMember(), 'send-command', 'member-a2')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/^R42:/)
  })
})

/**
 * R42 — NO AGENT MAY DRIVE ANOTHER AGENT (USER mandate, 2026-07-14).
 * TRDD-BF3JN4TL · docs/GOVERNANCE-RULES.md R42.
 *
 * THIS BLOCK SUPERSEDES three assertions that used to live in the D3RP7KQZ
 * describe above — "COS driving an agent in its OWN team is ALLOWED", "COS
 * driving an agent OUTSIDE its team is DENIED" (denied for the wrong reason
 * now), and "MANAGER driving any agent is ALLOWED". Those encoded the policy
 * R42 revokes. They are not deleted quietly: they are INVERTED here, so the
 * suite states the new rule as loudly as it once stated the old one.
 *
 * These are ADVERSARIAL tests, and they have to be. A missing authorization
 * guard produces a SUCCESS, not an error — so a happy-path suite is
 * constitutionally blind to one, and every hole R42 closes had been live for
 * months under a fully green test run. The only test that can prove a
 * prohibition is one that ATTEMPTS the forbidden act and asserts the REFUSAL.
 *
 * The MANAGER case is the load-bearing one: it is the title everyone assumes is
 * exempt, and it is the title whose exemption would make the rule meaningless —
 * an agent that can make the MANAGER type on its behalf has the MANAGER's
 * authority without ever holding it.
 */
describe('R42 — no agent may drive another agent (not even MANAGER or COS)', () => {
  const DRIVE_ACTIONS = ['send-command', 'restart-session'] as const

  const asManager = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${managerToken}` }))
  const asCosA = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${cosAToken}` }))
  const asMember = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${memberToken}` }))

  it.each(DRIVE_ACTIONS)('MANAGER attempting "%s" on ANOTHER agent is DENIED', (action) => {
    const decision = authorize(asManager(), action, 'member-b1')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/^R42:/)
  })

  it.each(DRIVE_ACTIONS)('CHIEF-OF-STAFF attempting "%s" on its OWN-TEAM agent is DENIED', (action) => {
    // The sharpest inversion: this exact call was ALLOWED before R42. A COS
    // owning its team is not a licence to act AS its members.
    const decision = authorize(asCosA(), action, 'member-a2')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/^R42:/)
  })

  it.each(DRIVE_ACTIONS)('MEMBER attempting "%s" on a peer is DENIED', (action) => {
    expect(authorize(asMember(), action, 'member-a2').allowed).toBe(false)
  })

  it.each(DRIVE_ACTIONS)('an UNRESOLVED target for "%s" FAILS CLOSED', (action) => {
    // The session routes resolve `[id]` (a tmux session NAME) to an agent id via
    // a registry read; a drifted/unknown name yields undefined. If that read as
    // "no target ⇒ no restriction", renaming a session would bypass R42 outright.
    // "We could not prove this is you" must never read as "it is you".
    expect(authorize(asManager(), action, undefined).allowed).toBe(false)
    expect(authorize(asMember(), action, undefined).allowed).toBe(false)
  })

  it('SELF-drive must NOT regress — an agent may still send-command to ITSELF', () => {
    // R42.4. This is what the janitor does (`/compact`, `/reload-plugins`), and
    // it grants an agent nothing it could not already do by typing into its own
    // terminal. A fix that closed the cross-agent path by breaking this one
    // would have broken the product to enforce the rule.
    expect(authorize(asMember(), 'send-command', 'member-a1').allowed).toBe(true)
    expect(authorize(asManager(), 'send-command', 'manager-1').allowed).toBe(true)
  })

  it('CONFIGURATION authority must NOT regress — MANAGER may still reconfigure another agent', () => {
    // R42.6. The boundary is DRIVE, not authority: configuring an agent changes
    // what it IS and leaves its judgment intact; driving it replaces its judgment
    // with yours. A fix that revoked configuration too would have gutted
    // governance (R9/R10/R11) in the name of protecting it.
    expect(authorize(asManager(), 'modify-agent', 'member-b1').allowed).toBe(true)
    expect(authorize(asManager(), 'change-title', 'member-b1').allowed).toBe(true)
    expect(authorize(asManager(), 'manage-skills', 'member-b1').allowed).toBe(true)
  })

  it('LIFECYCLE authority must NOT regress — MANAGER may still hibernate/wake another agent', () => {
    // Hibernate/wake stop or start a PROCESS; they never make the victim ACT.
    // R42 is about who may speak with an agent's own voice, not about who may
    // turn it off.
    expect(authorize(asManager(), 'hibernate-agent', 'member-b1').allowed).toBe(true)
    expect(authorize(asManager(), 'wake-agent', 'member-b1').allowed).toBe(true)
  })

  it('the system-owner (the human) is UNAFFECTED — the dashboard still drives agents', () => {
    // R42 binds AGENTS. The USER typing into the MANAGER's chat box is the
    // ENTRY POINT of the whole fleet; a rule that closed it would have made the
    // product unusable rather than safe.
    //
    // The system-owner's shape AT THE authorize() BOUNDARY is `{}` — no error,
    // no agentId (lib/agent-auth.ts `authenticateAgent`, Case 1: a web session
    // with the user-authority model off). We construct it directly rather than
    // via authenticateFromRequest because this suite mints real AID Bearer
    // tokens and has no session-cookie fixture; and authorize()'s contract is
    // over the AgentAuthResult, not over how it was obtained. A header-less
    // request would authenticate to an ERROR, which is a different case
    // entirely (it is already covered above, and it fails closed).
    const human = {} as AgentAuthResult
    expect(authorize(human, 'send-command', 'manager-1').allowed).toBe(true)
    expect(authorize(human, 'restart-session', 'member-b1').allowed).toBe(true)
  })
})

describe('TRDD-D3RP7KQZ — an agent may never reconfigure itself', () => {
  /**
   * The whole point of the decision: an agent that could reconfigure itself
   * could uninstall the role plugin that makes it able to do its job, or walk
   * itself out of its team, and nothing would be left to put it back.
   *
   * Every self-targeted action OUTSIDE the self-drive set must be denied — for
   * a MANAGER exactly as for a MEMBER, since the MANAGER's blanket grant sits
   * BELOW the self rule in authorize() and must never be reached by it.
   */
  const SELF_FORBIDDEN = [
    'modify-agent',
    'manage-skills',
    'change-title',
    'delete-agent',
    'restart-session',
    'delete-session',
    'create-session',
    'link-session',
    'wake-agent',
  ] as const

  it.each(SELF_FORBIDDEN)('MEMBER attempting "%s" on ITSELF is DENIED', (action) => {
    const auth = authenticateFromRequest(requestWith({ Authorization: `Bearer ${memberToken}` }))
    expect(authorize(auth, action, 'member-a1').allowed).toBe(false)
  })

  it.each(SELF_FORBIDDEN)('MANAGER attempting "%s" on ITSELF is DENIED', (action) => {
    const auth = authenticateFromRequest(requestWith({ Authorization: `Bearer ${managerToken}` }))
    expect(authorize(auth, action, 'manager-1').allowed).toBe(false)
  })

  it('a MANAGER still holds those same powers over OTHER agents', () => {
    // Guards against "fixing" the self rule by denying the action outright.
    const auth = authenticateFromRequest(requestWith({ Authorization: `Bearer ${managerToken}` }))
    expect(authorize(auth, 'modify-agent', 'member-a1').allowed).toBe(true)
    expect(authorize(auth, 'manage-skills', 'member-a1').allowed).toBe(true)
    expect(authorize(auth, 'change-title', 'member-a1').allowed).toBe(true)
  })

  it('wake-agent is NOT self-drive — a sleeping agent cannot be the one to wake itself', () => {
    const auth = authenticateFromRequest(requestWith({ Authorization: `Bearer ${memberToken}` }))
    const decision = authorize(auth, 'wake-agent', 'member-a1')
    expect(decision.allowed).toBe(false)
    // Denied by the self rule, not by a title rule — the distinction matters:
    // wake-agent on ANOTHER agent is allowed for MANAGER/COS.
    expect(decision.reason).toMatch(/No agent can modify itself/i)
  })
})

/**
 * TRDD-F1SL03CK — `create-agent`: R30.1/R30.2 enforcement that did not exist.
 *
 * `POST /api/agents` called `authenticateFromRequest` and NOTHING else. There was no
 * `create-agent` action in the enum at all, so R30.1 ("the CHIEF-OF-STAFF requires the
 * MANAGER's approval/mandate to create agents") was law with no enforcement, and any
 * authenticated agent of ANY title could mint agents.
 *
 * The MEMBER case below is the hole itself: before this action existed it was ALLOWED.
 */
describe('TRDD-F1SL03CK — create-agent authorization (R30.1/R30.2)', () => {
  const asManager = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${managerToken}` }))
  const asCosA = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${cosAToken}` }))
  const asMember = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${memberToken}` }))

  it('MANAGER may create agents (R29 authority)', () => {
    expect(authorize(asManager(), 'create-agent').allowed).toBe(true)
  })

  it('CHIEF-OF-STAFF may create agents — R30.2 makes it NORMAL team operation', () => {
    // Deliberately allowed at THIS layer. A team-creation mandate authorizes the COS to
    // create the 5 base members plus specialised MEMBERs, so denying it here would break
    // team creation outright. Whether it holds a mandate for THIS act is a separate,
    // per-act question owned by the portfolio-token gate (lib/portfolio-check.ts) —
    // see tests/services/portfolio-create-agent-authz.test.ts.
    expect(authorize(asCosA(), 'create-agent').allowed).toBe(true)
  })

  it('MEMBER may NOT create agents — this is the hole that was open', () => {
    const decision = authorize(asMember(), 'create-agent')
    expect(decision.allowed).toBe(false)
    // Pin the REASON, not just the boolean: `allowed === false` is satisfied by ANY
    // earlier refusal, so a bare falsy assertion would pass even if the denial came
    // from an unrelated gate.
    expect(decision.reason).toMatch(/Only MANAGER and CHIEF-OF-STAFF can create agents/)
  })

  it('the two gates are INDEPENDENT — a title check is not a mandate check', () => {
    // The composition is the whole finding, so it gets an assertion rather than only a
    // comment: this layer answers "is this caller allowed to HOLD the authority", and it
    // says YES to a COS regardless of any mandate, because mandates are not its question.
    // If this ever starts returning false for a COS, the token gate has been folded into
    // the title gate and one of the two rules has silently stopped being enforced.
    expect(authorize(asCosA(), 'create-agent').allowed).toBe(true)
    expect(authorize(asManager(), 'create-agent').allowed).toBe(true)
    expect(authorize(asMember(), 'create-agent').allowed).toBe(false)
  })
})

/**
 * TRDD-L6VV9Q7U — authorize() is no longer default-ALLOW for MANAGER and COS.
 *
 * The defect was structural. authorize() ended with two blanket branches — MANAGER
 * unconditionally allowed, COS allowed across its own team — so an AuthAction with
 * no dedicated branch ABOVE them was GRANTED to the two most powerful titles in the
 * system. The grant was invisible precisely because it was the ABSENCE of code:
 * adding an AuthAction granted it, with no diff to review and no test to fail.
 *
 * The fix replaces the blankets with ACTION_POLICY, a Record<AuthAction, Policy>.
 * THIS CHANGE IS A PURE NO-OP: today's behaviour is preserved row-for-row, pinned by
 * the HEAD baseline fixture below. Properties, each with its OWN assertion:
 *
 *   1. The record is exhaustive — a new AuthAction without a row is a TYPE error
 *      (tsc, not vitest; asserted structurally below).
 *   2. The four actions the card found UNRULED keep their legacy grant, flagged as
 *      'UNRULED' (not a decision, awaiting USER rulings); a FUTURE undecided action
 *      must use kind 'unruled', which DENIES. The negative half (other-team COS,
 *      MEMBER) stays denied, so a blanket-allow regression is still caught.
 *   3. The tail's three guards (unknown action, lost branch, unruled) each deny.
 *
 * R42 revokes cross-agent DRIVE for every title, so the card's claim that those
 * remain R42-denied is asserted too — as the RULE, not the old accident.
 */
describe('TRDD-L6VV9Q7U — the matrix preserves today\'s behaviour and denies by default', () => {
  const asManager = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${managerToken}` }))
  const asCosA = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${cosAToken}` }))
  const asMember = () => authenticateFromRequest(requestWith({ Authorization: `Bearer ${memberToken}` }))

  // The four actions TRDD-L6VV9Q7U names as UNRULED: their grant was never a
  // decision, only the absence of a branch. The matrix keeps today's grant (no-op)
  // and flags them 'UNRULED' until a USER ruling moves each row (the card's rulings).
  const UNRULED = ['delete-session', 'create-session', 'link-session', 'manage-group'] as const

  it.each(UNRULED)('MANAGER keeps the legacy grant on "%s" — status quo, NOT a decision', (action) => {
    expect(authorize(asManager(), action, 'member-b1').allowed).toBe(true)
  })

  it.each(UNRULED)('CHIEF-OF-STAFF keeps the legacy grant on "%s" for its OWN-TEAM agent, and stays DENIED out of team', (action) => {
    expect(authorize(asCosA(), action, 'member-a2').allowed).toBe(true)
    // Negative half: the team scope survived the rewrite.
    const other = authorize(asCosA(), action, 'member-b1')
    expect(other.allowed).toBe(false)
    expect(other.reason).toMatch(/own team/i)
  })

  it.each(UNRULED)('MEMBER is DENIED "%s" on a peer', (action) => {
    expect(authorize(asMember(), action, 'member-a2').allowed).toBe(false)
  })

  it('the system-owner (the human) is UNAFFECTED — the dashboard still manages sessions and groups', () => {
    // The matrix is reached only by an AGENT: the `!auth.agentId` grant above it
    // returns first. A fix that closed the human out would have made the product
    // unusable rather than safe.
    const human = {} as AgentAuthResult
    for (const action of UNRULED) {
      expect(authorize(human, action, 'member-b1').allowed).toBe(true)
    }
  })

  it('R42 REVOKE still holds: cross-agent DRIVE is denied for MANAGER and COS, as the RULE not an accident', () => {
    // These rows carry `grant: false/false` NOW. Before the fix they were denied
    // only because the R42 branch happened to sit ABOVE the blankets — re-order
    // the branches and the grant would have come back. The row is the second net.
    expect(authorize(asManager(), 'send-command', 'member-b1').allowed).toBe(false)
    expect(authorize(asCosA(), 'restart-session', 'member-a2').allowed).toBe(false)
  })

  it('the DECIDED grants must NOT regress — R42.6 config and R10.3 lifecycle still pass', () => {
    // The fix must not have "solved" default-allow by denying everything. These
    // are the rows with an authorising rule; a regression here would be the
    // opposite failure, and just as silent.
    for (const action of ['modify-agent', 'manage-skills', 'wake-agent', 'hibernate-agent'] as const) {
      expect(authorize(asManager(), action, 'member-b1').allowed).toBe(true)
    }
    // COS own-team, and COS out-of-team denied — the team scope survived the rewrite.
    expect(authorize(asCosA(), 'modify-agent', 'member-a2').allowed).toBe(true)
    expect(authorize(asCosA(), 'modify-agent', 'member-b1').allowed).toBe(false)
  })

  it('ACTION_POLICY covers every AuthAction — the exhaustiveness the Record<AuthAction, …> buys', () => {
    // The type system enforces this at compile time; the assertion here documents
    // the contract and fails loudly if a cast ever sneaks past the checker.
    // A `branch`-kind row whose branch is REMOVED fails closed at the matrix tail
    // (asserted by the delete-agent/register-agent suites above).
    // The Record<AuthAction, Policy> type enforces exhaustiveness at COMPILE time.
    // This test is the BEHAVIOURAL half, which a type cannot state: for every
    // AuthAction, a MANAGER acting on ANOTHER agent is allowed ONLY for the rows
    // that cite a rule. Anything else — including an action nobody listed — is
    // DENIED. That is "deny by default" as a property, not as an example.
    // The expectation is derived from the matrix itself, never a hand-written list.
    const ALL_ACTIONS = Object.keys(ACTION_POLICY) as AuthAction[]
    const managerMismatch: string[] = []
    const cosOwnMismatch: string[] = []
    const cosOtherMismatch: string[] = []
    const unruled: string[] = []
    let grantManagerTrue = 0
    let grantManagerFalse = 0
    for (const action of ALL_ACTIONS) {
      const policy = ACTION_POLICY[action]
      if (policy.kind === 'grant') {
        if (policy.manager) grantManagerTrue++
        else grantManagerFalse++
        const m = authorize(asManager(), action, 'member-b1')
        if (m.allowed !== policy.manager) managerMismatch.push(`${action}: got ${m.allowed}, matrix ${policy.manager}`)
        const own = authorize(asCosA(), action, 'member-a2')
        if (own.allowed !== policy.cosOwnTeam) cosOwnMismatch.push(`${action}: got ${own.allowed}, matrix ${policy.cosOwnTeam}`)
        const other = authorize(asCosA(), action, 'member-b1')
        if (other.allowed !== false) cosOtherMismatch.push(`${action}: got ${other.allowed}, expected false`)
      } else if (policy.kind === 'unruled') {
        unruled.push(action)
        const d = authorize(asManager(), action, 'member-b1')
        expect(d.allowed).toBe(false)
        expect(d.reason).toMatch(/TRDD-L6VV9Q7U/)
      }
      // kind 'branch': decided by its own dedicated branch, pinned by the suites above.
    }
    expect(managerMismatch).toEqual([])
    expect(cosOwnMismatch).toEqual([])
    expect(cosOtherMismatch).toEqual([])
    // Non-vacuity: both polarities of 'grant' exist.
    expect(grantManagerTrue).toBeGreaterThan(0)
    expect(grantManagerFalse).toBeGreaterThan(0)
    // LITERAL expectations, deliberately NOT read from ACTION_POLICY: the loop above
    // derives its expectation from the matrix, so it cannot detect a wrong matrix row.
    const literal: Array<[AuthAction, boolean]> = [
      ['modify-agent', true], ['manage-skills', true], ['wake-agent', true],
      ['hibernate-agent', true], ['view-agent', true],
      ['send-command', false], ['restart-session', false], ['delete-session', true],
      ['create-session', true], ['link-session', true], ['manage-group', true],
    ]
    for (const [action, expected] of literal) {
      expect({ action, allowed: authorize(asManager(), action, 'member-b1').allowed }).toEqual({ action, allowed: expected })
    }
    // No row is kind 'unruled' today: the four legacy rows are flagged grants.
    expect(unruled).toEqual([])
  })

  // An action cast in from outside the enum must be DENIED at the matrix tail, never inherit a grant (TRDD-L6VV9Q7U).
  it('an action absent from ACTION_POLICY is DENIED for MANAGER and COS — the tail guard', () => {
    const unknown = 'not-a-real-action' as AuthAction
    const m = authorize(asManager(), unknown, 'member-b1')
    expect(m.allowed).toBe(false)
    expect(m.reason).toMatch(/No authorization policy is defined/)
    const c = authorize(asCosA(), unknown, 'member-a2')
    expect(c.allowed).toBe(false)
    expect(c.reason).toMatch(/No authorization policy is defined/)
  })

  it('lost-branch guard: a kind "branch" row whose branch never ran is DENIED for MANAGER, not granted', () => {
    const name = 'synthetic-branch-action' as AuthAction
    const table = { ...ACTION_POLICY, [name]: { kind: 'branch', rule: 'synthetic' } } as const
    const d = decideFromPolicy(table, asManager(), 'manager', name, 'member-b1')
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/decided by its own branch, which did not run/)
    expect(name in ACTION_POLICY).toBe(false)
  })

  it('unruled guard: a kind "unruled" row is DENIED for MANAGER and names the card', () => {
    const name = 'synthetic-unruled-action' as AuthAction
    const table = { ...ACTION_POLICY, [name]: { kind: 'unruled', rule: 'synthetic' } } as const
    const d = decideFromPolicy(table, asManager(), 'manager', name, 'member-b1')
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/TRDD-L6VV9Q7U/)
    expect(name in ACTION_POLICY).toBe(false)
  })

  it('ACTION_POLICY is immutable at runtime: row edits and new keys are refused and authorize() is unchanged', () => {
    const before = authorize(asCosA(), 'send-command', 'member-a2')
    const table = ACTION_POLICY as unknown as Record<string, Record<string, unknown>>
    expect(() => { table['send-command'].manager = true }).toThrow(TypeError)
    expect(() => { table['synthetic-new-key'] = { kind: 'unruled', rule: 'x' } }).toThrow(TypeError)
    expect(Object.isFrozen(ACTION_POLICY)).toBe(true)
    expect(Object.values(ACTION_POLICY).every((r) => Object.isFrozen(r))).toBe(true)
    expect(ACTION_POLICY['send-command']).toMatchObject({ manager: false, cosOwnTeam: false })
    expect(authorize(asCosA(), 'send-command', 'member-a2')).toEqual(before)
    expect(authorize(asManager(), 'send-command', 'member-b1').allowed).toBe(false)
  })

  it('COS on a cosOwnTeam:false grant row gets its own reason; the own-team text stays for the other-team case', () => {
    const table = { synth: { kind: 'grant', manager: true, cosOwnTeam: false, rule: 'synthetic' } } as const
    const act = 'synth' as AuthAction
    const own = decideFromPolicy(table, asCosA(), 'chief-of-staff', act, 'member-a2')
    expect(own.allowed).toBe(false)
    expect(own.reason).toBe('Chief-of-Staff may not synth another agent (synthetic)')
    const grantTable = { synth: { kind: 'grant', manager: true, cosOwnTeam: true, rule: 'synthetic' } } as const
    const other = decideFromPolicy(grantTable, asCosA(), 'chief-of-staff', act, 'member-b1')
    expect(other.allowed).toBe(false)
    expect(other.reason).toBe('Chief-of-Staff can only synth agents in their own team')
  })

  it('the UNRULED marker: exactly the four legacy rows carry it; kind "unruled" is the only other place the word may appear', () => {
    const flagged = Object.entries(ACTION_POLICY)
      .filter(([, p]) => /^UNRULED/.test(p.rule))
      .map(([a]) => a)
      .sort()
    expect(flagged).toEqual(['create-session', 'delete-session', 'link-session', 'manage-group'])
    // Each legacy row is a flagged GRANT with its OWN question text (no shared sentence).
    const rules = flagged.map((a) => ACTION_POLICY[a as AuthAction].rule)
    expect(new Set(rules).size).toBe(4)
    for (const a of flagged) expect(ACTION_POLICY[a as AuthAction].kind).toBe('grant')
    // Anywhere else the word appears, the row must be kind 'unruled' (none today).
    const stray = Object.entries(ACTION_POLICY)
      .filter(([a, p]) => /UNRULED/i.test(p.rule) && !flagged.includes(a) && p.kind !== 'unruled')
      .map(([a]) => a)
    expect(stray).toEqual([])
    expect(Object.values(ACTION_POLICY).filter((p) => p.kind === 'unruled')).toEqual([])
  })
})

/**
 * TRDD-L6VV9Q7U acceptance: the refactor is a PURE NO-OP. Recorded from HEAD 7ba34ec25 on 2026-10-05
 * (the pre-matrix authorize(), run through the same fixtures); the refactor must reproduce it exactly.
 * Cell = '' when ALLOWED, else the FULL denial reason. Literal values — never derived from ACTION_POLICY.
 */
describe('TRDD-L6VV9Q7U — HEAD baseline: every (action x caller x target) cell is reproduced exactly', () => {
  const SELF_MOD = 'No agent can modify itself via the AI Maestro API'
  const SELF_TITLE = 'No agent can change its own governance title'
  const SELF_DEL = 'No agent can delete itself via API'
  const OWNER_REG = 'Only the system owner can register agent records'
  const OWNER_EXP = 'Only the system owner can export an agent — the archive contains keys/private.pem'
  const TRDD_CTX = 'manage-trdd requires the TRDD context (verb + min-approval-requirement)'
  // delete-agent row changed deliberately by the USER ruling of 2026-10-05 (TRDD-A50RC5G8); every other row is still the recorded baseline
  const DEL_DENY = 'Only MANAGER, or a CHIEF-OF-STAFF over its own team, can delete agents (soft delete only)'
  const DEL_COS_OTHER = 'Chief-of-Staff can only delete agents in their own team (soft delete only)'
  const MGR_ONLY_TEAM = 'Only MANAGER can manage teams'
  const CREATE_DENY = 'Only MANAGER and CHIEF-OF-STAFF can create agents (R30.1/R30.2); a COS additionally requires a MANAGER mandate'
  const r42 = (a: string) => `R42: no agent may ${a} on another agent — not even a MANAGER or CHIEF-OF-STAFF. Messaging is the only channel of agent-to-agent influence: ask, never inject.`
  const cosTail = (a: string) => `Chief-of-Staff can only ${a} agents in their own team`
  const memTail = (a: string) => `member cannot ${a} other agents`

  // Columns: MANAGER->member-b1, COS-A->member-a2 (own team), COS-A->member-b1 (other team), MEMBER->member-a2 (peer),
  // system-owner->member-b1, MANAGER->self, COS-A->self, MEMBER->self.
  const COLUMNS = ['MANAGER->member-b1', 'COS-A->member-a2', 'COS-A->member-b1', 'MEMBER->member-a2', 'OWNER->member-b1', 'MANAGER->self', 'COS-A->self', 'MEMBER->self']
  const BASELINE: Record<string, string[]> = {
    'modify-agent': ['', '', cosTail('modify-agent'), memTail('modify-agent'), '', SELF_MOD, SELF_MOD, SELF_MOD],
    'change-title': ['', '', 'Chief-of-Staff can only change titles of agents in their own team', 'Only MANAGER or CHIEF-OF-STAFF can change governance titles', '', SELF_TITLE, SELF_TITLE, SELF_TITLE],
    'delete-agent': ['', '', DEL_COS_OTHER, DEL_DENY, '', SELF_DEL, SELF_DEL, SELF_DEL],
    'send-command': [r42('send-command'), r42('send-command'), r42('send-command'), r42('send-command'), '', '', '', ''],
    'restart-session': [r42('restart-session'), r42('restart-session'), r42('restart-session'), r42('restart-session'), '', SELF_MOD, SELF_MOD, SELF_MOD],
    'unblock-prompt': ['', '', 'R42.8: a CHIEF-OF-STAFF may only unblock agents of its OWN team', 'R42.8: only a MANAGER or a CHIEF-OF-STAFF may unblock another agent (caller title: member)', '', '', '', ''],
    'hibernate-agent': ['', '', cosTail('hibernate-agent'), memTail('hibernate-agent'), '', '', '', ''],
    'wake-agent': ['', '', cosTail('wake-agent'), memTail('wake-agent'), '', SELF_MOD, SELF_MOD, SELF_MOD],
    'link-session': ['', '', cosTail('link-session'), memTail('link-session'), '', SELF_MOD, SELF_MOD, SELF_MOD],
    'delete-session': ['', '', cosTail('delete-session'), memTail('delete-session'), '', SELF_MOD, SELF_MOD, SELF_MOD],
    'create-session': ['', '', cosTail('create-session'), memTail('create-session'), '', SELF_MOD, SELF_MOD, SELF_MOD],
    'register-agent': [OWNER_REG, OWNER_REG, OWNER_REG, OWNER_REG, '', OWNER_REG, OWNER_REG, OWNER_REG],
    'create-agent': ['', '', '', CREATE_DENY, '', '', '', CREATE_DENY],
    'manage-team': ['', MGR_ONLY_TEAM, MGR_ONLY_TEAM, MGR_ONLY_TEAM, '', '', MGR_ONLY_TEAM, MGR_ONLY_TEAM],
    'manage-skills': ['', '', cosTail('manage-skills'), memTail('manage-skills'), '', SELF_MOD, SELF_MOD, SELF_MOD],
    'manage-group': ['', '', cosTail('manage-group'), memTail('manage-group'), '', SELF_MOD, SELF_MOD, SELF_MOD],
    'manage-trdd': [TRDD_CTX, TRDD_CTX, TRDD_CTX, TRDD_CTX, '', TRDD_CTX, TRDD_CTX, TRDD_CTX],
    'export-agent': [OWNER_EXP, OWNER_EXP, OWNER_EXP, OWNER_EXP, '', OWNER_EXP, OWNER_EXP, OWNER_EXP],
    'view-agent': ['', '', cosTail('view-agent'), memTail('view-agent'), '', SELF_MOD, SELF_MOD, SELF_MOD],
  }
  const ASSISTANT = 'R42.8: no title may unblock an ASSISTANT — its session is a human conversation surface, so injected text is indistinguishable from something the human said.'
  const mk = (t: string) => authenticateFromRequest(requestWith({ Authorization: `Bearer ${t}` }))
  const cell = (d: { allowed: boolean; reason?: string }) => (d.allowed ? '' : (d.reason ?? '<no reason>'))

  it('the fixture lists exactly the actions of ACTION_POLICY (none added or lost)', () => {
    expect(Object.keys(BASELINE).sort()).toEqual(Object.keys(ACTION_POLICY).sort())
  })

  it('the baseline is not degenerate: COS own-team differs from other-team, MANAGER differs from MEMBER', () => {
    const names = Object.keys(BASELINE)
    expect(names.some((a) => BASELINE[a][1] === '' && BASELINE[a][2] !== '')).toBe(true)
    expect(names.some((a) => BASELINE[a][0] === '' && BASELINE[a][3] !== '')).toBe(true)
    expect(names.every((a) => BASELINE[a][4] === '')).toBe(true)
  })

  it('every cell of the HEAD baseline is reproduced by the current source', () => {
    // Default registry answer: a resolvable non-assistant agent for any id (beforeEach resets the mock with no default),
    // so 'unblock-prompt' is decided by title/team and not by a fixture gap.
    mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'member' }))
    const mgr = mk(managerToken), cos = mk(cosAToken), mem = mk(memberToken)
    const owner = {} as AgentAuthResult
    const callers: Array<[AgentAuthResult, string]> = [
      [mgr, 'member-b1'], [cos, 'member-a2'], [cos, 'member-b1'], [mem, 'member-a2'],
      [owner, 'member-b1'], [mgr, 'manager-1'], [cos, 'cos-a'], [mem, 'member-a1'],
    ]
    const mismatches: string[] = []
    for (const [action, row] of Object.entries(BASELINE)) {
      callers.forEach(([auth, target], i) => {
        const got = cell(authorize(auth, action as AuthAction, target))
        if (got !== row[i]) mismatches.push(`${action} | ${COLUMNS[i]}: got ${JSON.stringify(got)}, baseline ${JSON.stringify(row[i])}`)
      })
    }
    expect(mismatches).toEqual([])
  })

  it('the unblock-prompt branch paths are reproduced: absent target, ASSISTANT target, registry read that THROWS', () => {
    const mgr = mk(managerToken), cos = mk(cosAToken)
    const cases: Array<[string, () => void, AgentAuthResult, string, string]> = [
      ['MANAGER absent', () => mockGetAgent.mockImplementation(() => undefined), mgr, 'member-b1', 'R42.8: target agent member-b1 is not in the registry — refusing to unblock an unknown session'],
      ['COS absent', () => mockGetAgent.mockImplementation(() => undefined), cos, 'member-a2', 'R42.8: target agent member-a2 is not in the registry — refusing to unblock an unknown session'],
      ['MANAGER ASSISTANT', () => mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'assistant' })), mgr, 'member-b1', ASSISTANT],
      ['COS ASSISTANT', () => mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'assistant' })), cos, 'member-a2', ASSISTANT],
      ['MANAGER THROWS', () => mockGetAgent.mockImplementation(() => { throw new Error('boom') }), mgr, 'member-b1', 'R42.8: could not read the target agent record — refusing to unblock'],
    ]
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const mismatches: string[] = []
      for (const [name, setup, auth, target, expected] of cases) {
        setup()
        const got = cell(authorize(auth, 'unblock-prompt', target))
        if (got !== expected) mismatches.push(`${name}: got ${JSON.stringify(got)}, baseline ${JSON.stringify(expected)}`)
      }
      expect(mismatches).toEqual([])
    } finally {
      errSpy.mockRestore()
    }
  })
})

/**
 * TRIPWIRE, not a control. `decideFromPolicy(table, ...)` evaluates only the matrix tail against a caller-supplied
 * table, so a production module calling it with its own table would bypass every dedicated branch of authorize().
 * This scan catches the obvious ways to reach it (any mention of the identifier, a wholesale re-export); it cannot
 * stop dynamic access such as `require('@/lib/authorization')['decide' + 'FromPolicy']`.
 */
describe('TRDD-A50RC5G8 — decideFromPolicy is referenced by lib/authorization.ts alone', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')
  const root = path.resolve(__dirname, '..')
  const owner = path.join(root, 'lib', 'authorization.ts')
  const scan = () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p) }
        else if (/\.(ts|tsx|mjs|js|sh)$/.test(e.name)) files.push(p)
      }
    }
    for (const d of ['app', 'services', 'lib', 'scripts']) walk(path.join(root, d))
    files.push(path.join(root, 'server.mjs'))
    return files.map((f) => ({ f, text: fs.readFileSync(f, 'utf-8') }))
  }

  it('no other file mentions the identifier anywhere in its text', () => {
    const all = scan()
    const hits = all.filter(({ text }) => text.includes('decideFromPolicy')).map(({ f }) => f)
    // Non-vacuity: the walk is real, and it does see the one legitimate owner.
    expect(all.length).toBeGreaterThan(100)
    expect(hits).toContain(owner)
    expect(hits.filter((f) => f !== owner)).toEqual([])
  })

  it('no other file re-exports lib/authorization wholesale', () => {
    const re = /export\s*\*\s*(as\s+\w+\s+)?from\s*['"](\.\/authorization|@\/lib\/authorization|(\.\.\/)+lib\/authorization)['"]/
    const offenders = scan().filter(({ f, text }) => f !== owner && re.test(text)).map(({ f }) => f)
    expect(offenders).toEqual([])
    expect(re.test("export * from '@/lib/authorization'")).toBe(true)
    expect(re.test("export * from './authorization'")).toBe(true)
  })
})

/**
 * TRDD-A50RC5G8 — USER ruling 2026-10-05: a CHIEF-OF-STAFF may delete an agent of its OWN team (soft-only is enforced
 * in DeleteAgent). Literal reasons, asserted directly (not derived from the policy table).
 */
describe('TRDD-A50RC5G8 — delete-agent: CHIEF-OF-STAFF over its own team', () => {
  const mk = (t: string) => authenticateFromRequest(requestWith({ Authorization: `Bearer ${t}` }))
  beforeEach(() => { mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'member' })) })

  it('COS deleting a member of its own team is allowed', () => {
    expect(authorize(mk(cosAToken), 'delete-agent', 'member-a2')).toEqual({ allowed: true })
  })
  it('COS deleting a member of another team is denied with the own-team reason', () => {
    expect(authorize(mk(cosAToken), 'delete-agent', 'member-b1')).toEqual({
      allowed: false, reason: 'Chief-of-Staff can only delete agents in their own team (soft delete only)',
    })
  })
  it('COS deleting itself is denied with the self reason', () => {
    expect(authorize(mk(cosAToken), 'delete-agent', 'cos-a')).toEqual({
      allowed: false, reason: 'No agent can delete itself via API',
    })
  })
  it('MEMBER deleting an agent is denied', () => {
    expect(authorize(mk(memberToken), 'delete-agent', 'member-a2')).toEqual({
      allowed: false, reason: 'Only MANAGER, or a CHIEF-OF-STAFF over its own team, can delete agents (soft delete only)',
    })
  })
  it('MANAGER deleting an agent is allowed', () => {
    expect(authorize(mk(managerToken), 'delete-agent', 'member-b1')).toEqual({ allowed: true })
  })

  // Target-title narrowing: the own-team test alone would let a COS delete a MANAGER / peer COS sitting in its team.
  const asTitle = (t: string | undefined) => () => mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: t }))
  it.each(['member', 'architect', 'orchestrator', 'integrator'])('COS deleting an own-team %s is allowed', (t) => {
    asTitle(t)()
    expect(authorize(mk(cosAToken), 'delete-agent', 'member-a2')).toEqual({ allowed: true })
  })
  const LIST = 'member, architect, orchestrator, integrator'
  const deniedTitle = (t: string) => ({ allowed: false, reason: `A CHIEF-OF-STAFF may delete only team members it supervises (${LIST}); target title is ${t}` })
  it.each(['manager', 'chief-of-staff', 'maintainer', 'autonomous', 'assistant', 'future-role'])('COS deleting an own-team %s is denied', (t) => {
    asTitle(t)()
    expect(authorize(mk(cosAToken), 'delete-agent', 'member-a2')).toEqual(deniedTitle(t))
  })
  it.each([[' Member '], ['ARCHITECT']])('COS deleting an own-team target titled "%s" is allowed (normalised)', (t) => {
    asTitle(t)()
    expect(authorize(mk(cosAToken), 'delete-agent', 'member-a2')).toEqual({ allowed: true })
  })
  it('COS deleting an own-team target titled " MANAGER " is denied (normalised)', () => {
    asTitle(' MANAGER ')()
    expect(authorize(mk(cosAToken), 'delete-agent', 'member-a2')).toEqual(deniedTitle('manager'))
  })
  it.each([['undefined', undefined], ['null', null], ['empty', ''], ['blank', '   '], ['non-string', 42]])('COS deleting an own-team target with %s title is denied', (_n, t) => {
    asTitle(t as string | undefined)()
    expect(authorize(mk(cosAToken), 'delete-agent', 'member-a2')).toEqual({
      allowed: false, reason: 'A CHIEF-OF-STAFF may not delete an agent that has no governance title (TRDD-A50RC5G8)',
    })
  })
  it('COS deleting an own-team target absent from the registry is denied', () => {
    mockGetAgent.mockImplementation(() => undefined)
    expect(authorize(mk(cosAToken), 'delete-agent', 'member-a2')).toEqual({
      allowed: false,
      reason: 'A CHIEF-OF-STAFF may not delete member-a2: target agent is not in the registry (TRDD-A50RC5G8)',
    })
  })
  it('COS deleting an own-team target whose registry read throws is denied', () => {
    // Throw only for the TARGET so the caller still authenticates (its own row is read at authentication).
    mockGetAgent.mockImplementation((id: string) => { if (id === 'member-a2') throw new Error('boom'); return { id, governanceTitle: 'member' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(authorize(mk(cosAToken), 'delete-agent', 'member-a2')).toEqual({
        allowed: false,
        reason: 'A CHIEF-OF-STAFF may not delete an agent whose record could not be read (TRDD-A50RC5G8)',
      })
    } finally { spy.mockRestore() }
  })
})

/**
 * TRDD-A50RC5G8 — a CHIEF-OF-STAFF's delete grant is decided by the REGISTRY: the caller must be the
 * chiefOfStaffId of a team that contains the target. The token's teamId is never consulted, and a COS-titled agent
 * that is merely a MEMBER of a team has no authority over it.
 */
describe('TRDD-A50RC5G8 — delete-agent: CHIEF-OF-STAFF must be the registry chiefOfStaffId of the target\'s team', () => {
  const OTHER = 'Chief-of-Staff can only delete agents in their own team (soft delete only)'
  const NOT_COS = 'You are not the chief of staff of any team that contains this agent (soft delete only)'
  const team = (id: string, chiefOfStaffId: string | null, agentIds: string[], orchestratorId: string | null = null) =>
    ({ id, name: id, type: 'closed', chiefOfStaffId, orchestratorId, agentIds })
  const setTeams = (...teams: unknown[]) => { fsStubFns.teamsState.json = JSON.stringify({ teams }) }
  const authFor = async (agentId: string, teamId: string | null) =>
    authenticateFromRequest(requestWith({ Authorization: `Bearer ${(await issueGovernanceToken(agentId, agentId, 'chief-of-staff', teamId)).access_token}` }))
  const member = (id: string) => ({ id, governanceTitle: 'member' })
  beforeEach(() => { mockGetAgent.mockImplementation((id: string) => member(id)) })

  it('the chiefOfStaffId of team A deleting a member of team A is ALLOWED', async () => {
    setTeams(team('team-a', 'cos-a', ['cos-a', 'm1']), team('team-b', 'cos-b', ['cos-b', 'm2']))
    expect(authorize(await authFor('cos-a', 'team-a'), 'delete-agent', 'm1')).toEqual({ allowed: true })
  })

  it('a COS-titled agent that is only a MEMBER of team B (not its chiefOfStaffId) is DENIED', async () => {
    setTeams(team('team-b', 'cos-b', ['cos-b', 'cos-x', 'm2']))
    const d = authorize(await authFor('cos-x', 'team-b'), 'delete-agent', 'm2')
    expect(d).toEqual({ allowed: false, reason: NOT_COS })
  })

  it('a stale token teamId (team B) cannot grant a target in team B to the chief of staff of team A', async () => {
    setTeams(team('team-a', 'cos-a', ['cos-a', 'm1']), team('team-b', 'cos-b', ['cos-b', 'm2']))
    const d = authorize(await authFor('cos-a', 'team-b'), 'delete-agent', 'm2')
    expect(d).toEqual({ allowed: false, reason: OTHER })
  })

  it('with the same stale token teamId, a target in team A is ALLOWED (the registry decides)', async () => {
    setTeams(team('team-a', 'cos-a', ['cos-a', 'm1']), team('team-b', 'cos-b', ['cos-b', 'm2']))
    expect(authorize(await authFor('cos-a', 'team-b'), 'delete-agent', 'm1')).toEqual({ allowed: true })
  })

  it('a target in BOTH teams, the other team listed first, is ALLOWED when the caller chairs the second', async () => {
    setTeams(team('team-b', 'cos-b', ['cos-b', 'shared']), team('team-a', 'cos-a', ['cos-a', 'shared']))
    expect(authorize(await authFor('cos-a', 'team-a'), 'delete-agent', 'shared')).toEqual({ allowed: true })
  })

  it('a target only in team B (listed first) is DENIED to the chief of staff of team A', async () => {
    setTeams(team('team-b', 'cos-b', ['cos-b', 'm2']), team('team-a', 'cos-a', ['cos-a', 'm1']))
    expect(authorize(await authFor('cos-a', 'team-a'), 'delete-agent', 'm2')).toEqual({ allowed: false, reason: OTHER })
  })

  it('the team\'s orchestratorId, absent from agentIds, is ALLOWED', async () => {
    setTeams(team('team-a', 'cos-a', ['cos-a'], 'orch-a'))
    mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'orchestrator' }))
    expect(authorize(await authFor('cos-a', 'team-a'), 'delete-agent', 'orch-a')).toEqual({ allowed: true })
  })

  it('a team store read that throws is DENIED', async () => {
    const auth = await authFor('cos-a', 'team-a')
    fsStubFns.teamsState.throws = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const d = authorize(auth, 'delete-agent', 'member-a2')
    expect(warn).toHaveBeenCalled() // positive control: the read really threw and was logged
    warn.mockRestore()
    expect(d).toEqual({ allowed: false, reason: 'Team registry could not be read; refusing (soft delete only)' })
  })
})

/**
 * TRDD-A50RC5G8 — every other CHIEF-OF-STAFF own-team grant (change-title, archive of a failed TRDD,
 * unblock-prompt, and the generic policy tail used by modify-agent) is decided by the REGISTRY like delete-agent:
 * the caller must be the chiefOfStaffId of a team that contains the target. The token's teamId is never consulted
 * and a COS-titled plain member has no authority.
 */
describe('TRDD-A50RC5G8 — sibling CHIEF-OF-STAFF grants require the registry chiefOfStaffId', () => {
  const team = (id: string, chiefOfStaffId: string | null, agentIds: string[]) =>
    ({ id, name: id, type: 'closed', chiefOfStaffId, orchestratorId: null, agentIds })
  const setTeams = (...teams: unknown[]) => { fsStubFns.teamsState.json = JSON.stringify({ teams }) }
  const authFor = async (agentId: string, teamId: string | null) =>
    authenticateFromRequest(requestWith({ Authorization: `Bearer ${(await issueGovernanceToken(agentId, agentId, 'chief-of-staff', teamId)).access_token}` }))
  beforeEach(() => { mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'member' })) })

  type Site = { name: string; deny: string; unreadable: string; run: (a: AgentAuthResult, target: string) => { allowed: boolean; reason?: string } }
  const sites: Site[] = [
    { name: 'change-title', unreadable: 'Team registry could not be read; refusing to change the title (TRDD-A50RC5G8)', deny: 'Chief-of-Staff can only change titles of agents in their own team',
      run: (a, t) => authorize(a, 'change-title', t) },
    { name: 'archive of a failed TRDD', unreadable: 'Team registry could not be read; refusing to archive a failed TRDD (TRDD-A50RC5G8)', deny: 'Archiving a failed TRDD makes it definitive — only MANAGER, or the CHIEF-OF-STAFF of its assignee\'s team, may decide that (owner rulings 2026-09-24)',
      run: (a, t) => authorize(a, 'manage-trdd', undefined, { verb: 'archive', minApproval: 'manager', zone: 'tasks', column: 'failed', assigneeAgentId: t, createdByAgentId: 'someone-else' }) },
    { name: 'unblock-prompt', unreadable: 'R42.8: team registry could not be read — refusing to unblock (TRDD-A50RC5G8)', deny: 'R42.8: a CHIEF-OF-STAFF may only unblock agents of its OWN team',
      run: (a, t) => authorize(a, 'unblock-prompt', t) },
    { name: 'generic policy tail (modify-agent)', unreadable: 'Team registry could not be read; refusing to modify-agent (TRDD-A50RC5G8)', deny: 'Chief-of-Staff can only modify-agent agents in their own team',
      run: (a, t) => authorize(a, 'modify-agent', t) },
  ]

  describe.each(sites)('$name', ({ deny, unreadable, run }) => {
    it('the registry chiefOfStaffId of the target\'s team is ALLOWED', async () => {
      setTeams(team('team-a', 'cos-a', ['cos-a', 'm1']), team('team-b', 'cos-b', ['cos-b', 'm2']))
      expect(run(await authFor('cos-a', 'team-a'), 'm1')).toEqual({ allowed: true })
    })
    it('a COS-titled agent that is only a MEMBER of the target\'s team is DENIED', async () => {
      setTeams(team('team-b', 'cos-b', ['cos-b', 'cos-x', 'm2']))
      expect(run(await authFor('cos-x', 'team-b'), 'm2')).toEqual({ allowed: false, reason: deny })
    })
    it('a stale token teamId naming the target\'s team cannot grant the chief of staff of another team', async () => {
      setTeams(team('team-a', 'cos-a', ['cos-a', 'm1']), team('team-b', 'cos-b', ['cos-b', 'm2']))
      expect(run(await authFor('cos-a', 'team-b'), 'm2')).toEqual({ allowed: false, reason: deny })
    })
    it('with that same stale token teamId, a target in the caller\'s registry team is ALLOWED', async () => {
      setTeams(team('team-a', 'cos-a', ['cos-a', 'm1']), team('team-b', 'cos-b', ['cos-b', 'm2']))
      expect(run(await authFor('cos-a', 'team-b'), 'm1')).toEqual({ allowed: true })
    })
    it('a chief of staff chairing TWO teams may act on a target of the second one', async () => {
      setTeams(team('team-a', 'cos-a', ['cos-a', 'm1']), team('team-c', 'cos-a', ['cos-a', 'm3']))
      expect(run(await authFor('cos-a', 'team-a'), 'm3')).toEqual({ allowed: true })
    })
    it('a TEAMLESS target is DENIED', async () => {
      setTeams(team('team-a', 'cos-a', ['cos-a', 'm1']))
      expect(run(await authFor('cos-a', 'team-a'), 'loner')).toEqual({ allowed: false, reason: deny })
    })
    it('a team store read that throws is DENIED', async () => {
      const auth = await authFor('cos-a', 'team-a')
      fsStubFns.teamsState.throws = true
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const d = run(auth, 'member-a2')
      expect(warn).toHaveBeenCalled() // positive control: the read really threw and was logged
      warn.mockRestore()
      expect(d).toEqual({ allowed: false, reason: unreadable })
    })
  })
})

/**
 * TRDD-A50RC5G8 — the ORCHESTRATOR TRDD-edit grant is decided by the registry (orchestratorId of a team containing
 * the assignee), and a chief of staff may not change the title of a MANAGER, a CHIEF-OF-STAFF or an ASSISTANT.
 */
describe('TRDD-A50RC5G8 — ORCHESTRATOR TRDD edit is decided by the registry orchestratorId', () => {
  const team = (id: string, orchestratorId: string | null, agentIds: string[]) =>
    ({ id, name: id, type: 'closed', chiefOfStaffId: null, orchestratorId, agentIds })
  const setTeams = (...teams: unknown[]) => { fsStubFns.teamsState.json = JSON.stringify({ teams }) }
  const orchAuth = async (agentId: string, teamId: string | null) =>
    authenticateFromRequest(requestWith({ Authorization: `Bearer ${(await issueGovernanceToken(agentId, agentId, 'orchestrator', teamId)).access_token}` }))
  const edit = (a: AgentAuthResult, assignee: string) =>
    authorize(a, 'manage-trdd', undefined, { verb: 'edit', minApproval: 'manager', assigneeAgentId: assignee, createdByAgentId: 'someone-else' })
  const DENY = 'ORCHESTRATOR can only edit TRDDs assigned within its own team'

  it('the registry orchestrator of the assignee\'s team is ALLOWED', async () => {
    setTeams(team('team-a', 'orch-1', ['orch-1', 'm1']))
    expect(edit(await orchAuth('orch-1', 'team-a'), 'm1')).toEqual({ allowed: true })
  })
  it('an orchestrator-titled caller whose token names the assignee\'s team but whom the registry does not name is DENIED', async () => {
    setTeams(team('team-a', 'orch-real', ['orch-real', 'orch-1', 'm1']))
    expect(edit(await orchAuth('orch-1', 'team-a'), 'm1')).toEqual({ allowed: false, reason: DENY })
  })
  it('a token naming another team does not stop the registry orchestrator (ALLOWED)', async () => {
    setTeams(team('team-a', 'orch-1', ['orch-1', 'm1']), team('team-b', 'orch-b', ['orch-b', 'm2']))
    expect(edit(await orchAuth('orch-1', 'team-b'), 'm1')).toEqual({ allowed: true })
  })
  it('the registry orchestrator is DENIED for an assignee of a different team', async () => {
    setTeams(team('team-a', 'orch-1', ['orch-1', 'm1']), team('team-b', 'orch-b', ['orch-b', 'm2']))
    expect(edit(await orchAuth('orch-1', 'team-a'), 'm2')).toEqual({ allowed: false, reason: DENY })
  })
  it('a team store read that throws is DENIED with the unreadable reason', async () => {
    const auth = await orchAuth('orch-1', 'team-a')
    fsStubFns.teamsState.throws = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const d = edit(auth, 'm1')
    expect(warn).toHaveBeenCalled() // positive control: the read really threw and was logged
    warn.mockRestore()
    expect(d).toEqual({ allowed: false, reason: 'Team registry could not be read; refusing to edit the TRDD (TRDD-A50RC5G8)' })
  })
})

describe('TRDD-A50RC5G8 — change-title: a CHIEF-OF-STAFF may not retitle a MANAGER or an ASSISTANT', () => {
  const setTeams = () => {
    fsStubFns.teamsState.json = JSON.stringify({
      teams: [{ id: 'team-a', name: 'team-a', type: 'closed', chiefOfStaffId: 'cos-a', orchestratorId: null, agentIds: ['cos-a', 'tgt'] }],
    })
  }
  const run = () => authorize(authenticateFromRequest(requestWith({ Authorization: `Bearer ${cosAToken}` })), 'change-title', 'tgt')
  const DENY = 'Chief-of-Staff cannot change the title of a MANAGER or an ASSISTANT (TRDD-A50RC5G8)'
  beforeEach(setTeams)

  it.each([['manager'], ['assistant']])('a listed %s target is DENIED with the exact reason', (t) => {
    mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: t }))
    expect(run()).toEqual({ allowed: false, reason: DENY })
  })
  it('a chief-of-staff-titled non-chair target is ALLOWED (control: the title confers no authority)', () => {
    mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'chief-of-staff' }))
    expect(run()).toEqual({ allowed: true })
  })
  it('a member target is ALLOWED', () => {
    mockGetAgent.mockImplementation((id: string) => ({ id, governanceTitle: 'member' }))
    expect(run()).toEqual({ allowed: true })
  })
  it('an untitled target is ALLOWED', () => {
    mockGetAgent.mockImplementation((id: string) => ({ id }))
    expect(run()).toEqual({ allowed: true })
  })
  it('a target absent from the registry is DENIED', () => {
    mockGetAgent.mockImplementation(() => undefined)
    expect(run()).toEqual({ allowed: false, reason: 'Chief-of-Staff cannot change the title of tgt: target agent is not in the registry (TRDD-A50RC5G8)' })
  })
  it('a target whose registry read THROWS is DENIED with the exact reason and the error is logged', () => {
    /** Fail closed: an unreadable target record must not be treated as a harmless untitled agent */
    // Throw only for the TARGET so the caller still authenticates (its own row is read at authentication).
    mockGetAgent.mockImplementation((id: string) => { if (id === 'tgt') throw new Error('boom'); return { id, governanceTitle: 'member' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(run()).toEqual({ allowed: false, reason: 'Chief-of-Staff cannot change the title of an agent whose record could not be read (TRDD-A50RC5G8)' })
      expect(spy).toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })
})
