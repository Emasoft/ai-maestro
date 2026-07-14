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
 * FILESYSTEM STRATEGY: `lib/authorization.ts`'s `lookupTeamIdForAgent()` and
 * `lib/aid-token.ts`'s token store both read real on-disk files (under
 * `~/.aimaestro/`). Rather than `vi.mock('@/lib/team-registry', ...)` — which
 * does NOT get picked up by `lib/authorization.ts`'s internal
 * `require('./team-registry')` under this project's Vitest/vite-node setup
 * (verified empirically: the mock is never observed, the relative require
 * fails to resolve, and `lookupTeamIdForAgent` fails closed to "team-less"
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

  return {
    ...realFs,
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
      if (isTeamsFilePath(p)) return teamsFixtureJson
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
const mockUpdateAgent = vi.fn()
vi.mock('@/lib/agent-registry', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
  updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
  loadAgents: () => [],
}))

import { issueGovernanceToken } from '@/lib/aid-token'
import { authenticateFromRequest, buildAuthContext, type AgentAuthResult } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
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
  mockGetAgent.mockReset()
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

    // member-a2 belongs to team-a, the same team as cos-a.
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

    const result = await ChangeTitle('member-a2', 'member', { authContext })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/MANAGER or CHIEF-OF-STAFF/i)
    // Gate 0 returns before Gate 2 ever calls getAgent, and long before any
    // updateAgent write — the target agent record is provably untouched.
    expect(mockGetAgent).not.toHaveBeenCalled()
    expect(mockUpdateAgent).not.toHaveBeenCalled()
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
