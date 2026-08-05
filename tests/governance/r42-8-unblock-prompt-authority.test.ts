/**
 * R42.8 — the UNBLOCK exception, at the `authorize()` boundary.
 *
 * TRDD-AODXPI5E. The USER ruled on 2026-08-05, in the first person and having
 * been reminded R42 is absolute, that a question or permission query blocking an
 * agent from its work is the ONE case where reading and answering another
 * agent's terminal is necessary — "only the MANAGER and the CHIEF-OF-STAFF are
 * allowed". This file is the guard that ruling asked for.
 *
 * WHAT MAKES THIS AN ADVERSARIAL TEST AND NOT A HAPPY-PATH ONE: an exception to
 * an IRON rule is dangerous exactly in proportion to how far it reaches, so the
 * assertions that matter are the REFUSALS — a non-MANAGER/COS caller, a COS
 * reaching outside its team, ANY caller aiming at an ASSISTANT, and an
 * unresolvable target. The final block is the complement: cross-agent
 * `send-command` must still be REVOKED for a MANAGER. If that ever goes green
 * as "allowed", the exception has eaten the rule and this file says so.
 *
 * FILESYSTEM STRATEGY: copied deliberately from tests/authorization.test.ts —
 * `lookupTeamIdForAgent()` reads a real teams.json through a RELATIVE
 * `./team-registry` import that `vi.mock('@/lib/team-registry')` does not
 * intercept under this project's vite-node setup. Mocking it would silently
 * fail closed to "team-less" and make every COS assertion pass for the WRONG
 * reason. So team-registry stays REAL and `fs` is stubbed for its one file.
 */

import { describe, it, expect, vi } from 'vitest'
import type { AgentAuthResult } from '@/lib/agent-auth'

const fsStubFns = vi.hoisted(() => {
  const realFs = require('fs') as typeof import('fs')
  const nodePath = require('path') as typeof import('path')

  const teamsFileSuffix = nodePath.join('teams', 'teams.json')
  const isTeamsFilePath = (p: unknown) => typeof p === 'string' && p.endsWith(teamsFileSuffix)
  const isTeamsDirPath = (p: unknown) => typeof p === 'string' && p.endsWith(nodePath.sep + 'teams')

  // `type: 'closed'` avoids loadTeams()'s convergent-migration write path.
  const teamsFixtureJson = JSON.stringify({
    teams: [
      { id: 'team-a', name: 'Team A', type: 'closed', chiefOfStaffId: 'cos-a', orchestratorId: null, agentIds: ['cos-a', 'member-a1'] },
      { id: 'team-b', name: 'Team B', type: 'closed', chiefOfStaffId: 'cos-b', orchestratorId: null, agentIds: ['cos-b', 'member-b1'] },
    ],
  })

  return {
    ...realFs,
    existsSync: (p: unknown) => {
      if (isTeamsFilePath(p)) return true
      if (isTeamsDirPath(p)) return true
      return realFs.existsSync(p as never)
    },
    mkdirSync: (p: unknown, opts?: unknown) =>
      isTeamsDirPath(p) ? undefined : realFs.mkdirSync(p as never, opts as never),
    readFileSync: (p: unknown, enc?: unknown) => {
      if (isTeamsFilePath(p)) return teamsFixtureJson
      return realFs.readFileSync(p as never, enc as never)
    },
    writeFileSync: (p: unknown, data?: unknown, opts?: unknown) =>
      isTeamsFilePath(p) ? undefined : realFs.writeFileSync(p as never, data as never, opts as never),
    renameSync: (p: unknown, q: unknown) =>
      isTeamsFilePath(p) ? undefined : realFs.renameSync(p as never, q as never),
  }
})
vi.mock('fs', () => ({ default: fsStubFns, ...fsStubFns }))

// The registry the R42.8 gate reads to learn the TARGET's title. `unknown-agent`
// is deliberately absent so the fail-closed case has something to aim at.
const AGENTS: Record<string, { id: string; name: string; governanceTitle: string | null }> = {
  'member-a1': { id: 'member-a1', name: 'member-a1', governanceTitle: 'member' },
  'member-b1': { id: 'member-b1', name: 'member-b1', governanceTitle: 'member' },
  'cos-a': { id: 'cos-a', name: 'cos-a', governanceTitle: 'chief-of-staff' },
  'lone-auto': { id: 'lone-auto', name: 'lone-auto', governanceTitle: 'autonomous' },
  'the-assistant': { id: 'the-assistant', name: 'the-assistant', governanceTitle: 'assistant' },
  'titleless': { id: 'titleless', name: 'titleless', governanceTitle: null },
}
const mockGetAgent = vi.fn((id: string) => AGENTS[id])
vi.mock('@/lib/agent-registry', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...(args as [string])),
  updateAgent: vi.fn(),
  loadAgents: () => Object.values(AGENTS),
}))

import { authorize } from '@/lib/authorization'

/**
 * Every caller here carries an EXPLICIT governanceTitle, which is what a real
 * AID session secret carries. That keeps lookupGovernanceTitle() — and with it
 * lib/governance — out of the decision, so a failure in this file is always
 * about the R42.8 gate and never about title resolution.
 */
const caller = (agentId: string, governanceTitle: string, teamId?: string): AgentAuthResult =>
  ({ agentId, governanceTitle, teamId } as AgentAuthResult)

const MANAGER = caller('the-manager', 'manager')
const COS_A = caller('cos-a', 'chief-of-staff', 'team-a')
const COS_B = caller('cos-b', 'chief-of-staff', 'team-b')

describe('R42.8 — who may unblock a stalled agent', () => {
  it('ALLOWS a MANAGER to unblock any ordinary agent', () => {
    expect(authorize(MANAGER, 'unblock-prompt', 'member-a1').allowed).toBe(true)
    expect(authorize(MANAGER, 'unblock-prompt', 'lone-auto').allowed).toBe(true)
    // Including one with no title at all — a misconfigured agent is exactly the
    // kind that gets stuck, and R42.8 names ASSISTANT as the only exclusion.
    expect(authorize(MANAGER, 'unblock-prompt', 'titleless').allowed).toBe(true)
  })

  it('ALLOWS a CHIEF-OF-STAFF to unblock an agent of its OWN team', () => {
    expect(authorize(COS_A, 'unblock-prompt', 'member-a1').allowed).toBe(true)
  })

  it('DENIES a CHIEF-OF-STAFF reaching into ANOTHER team', () => {
    const r = authorize(COS_A, 'unblock-prompt', 'member-b1')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/own team/i)

    // Symmetric — not a property of team-a in particular.
    expect(authorize(COS_B, 'unblock-prompt', 'member-a1').allowed).toBe(false)
  })

  it('DENIES every other governance title', () => {
    for (const title of ['autonomous', 'member', 'orchestrator', 'architect', 'integrator', 'maintainer', 'assistant']) {
      const r = authorize(caller('someone', title, 'team-a'), 'unblock-prompt', 'member-a1')
      expect(r.allowed, `${title} must not be able to unblock`).toBe(false)
      expect(r.reason).toMatch(/only a MANAGER or a CHIEF-OF-STAFF/i)
    }
  })
})

describe('R42.8 — the ASSISTANT is never a target, under any title', () => {
  // An ASSISTANT's session is the surface a human converses THROUGH, so injected
  // text is indistinguishable from something its human said. An unblock there
  // would forge the human's intent — the one thing the exception must not buy.
  it('DENIES a MANAGER unblocking an ASSISTANT', () => {
    const r = authorize(MANAGER, 'unblock-prompt', 'the-assistant')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/ASSISTANT/)
  })

  it('DENIES a CHIEF-OF-STAFF unblocking an ASSISTANT, even in its own team', () => {
    // Put the assistant in team-a so ONLY the assistant rule can produce the
    // denial — otherwise this test would pass on the own-team check instead and
    // prove nothing about the exclusion it is named for.
    AGENTS['the-assistant'] = { id: 'the-assistant', name: 'the-assistant', governanceTitle: 'assistant' }
    const r = authorize(COS_A, 'unblock-prompt', 'the-assistant')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/ASSISTANT/)
  })
})

describe('R42.8 — fails CLOSED when the target cannot be established', () => {
  it('DENIES an unresolved (undefined) target', () => {
    const r = authorize(MANAGER, 'unblock-prompt', undefined)
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/resolved target/i)
  })

  it('DENIES a target that is not in the registry', () => {
    const r = authorize(MANAGER, 'unblock-prompt', 'unknown-agent')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/not in the registry/i)
  })

  it('DENIES when the registry read THROWS', () => {
    mockGetAgent.mockImplementationOnce(() => {
      throw new Error('registry corrupt')
    })
    const r = authorize(MANAGER, 'unblock-prompt', 'member-a1')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/could not read/i)
  })
})

describe('R42.8 — self-unblock is unaffected and needs no title', () => {
  it('ALLOWS any agent to answer its OWN pending prompt', () => {
    // This predates R42.8: answering your own prompt is self-drive, and the
    // `ama-session` skill's original documented use case.
    expect(authorize(caller('lone-auto', 'autonomous'), 'unblock-prompt', 'lone-auto').allowed).toBe(true)
    expect(authorize(caller('member-a1', 'member', 'team-a'), 'unblock-prompt', 'member-a1').allowed).toBe(true)
  })
})

describe('R42.8 did NOT widen R42 — the general drive verbs stay REVOKED', () => {
  // The complement. R42.8 is a NEW action precisely so that these stay denied;
  // if a future change reaches the unblock path by loosening 'send-command'
  // instead, this block goes red and names what was traded away.
  it('still DENIES a MANAGER cross-agent send-command', () => {
    const r = authorize(MANAGER, 'send-command', 'member-a1')
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/^R42:/)
  })

  it('still DENIES a MANAGER cross-agent restart-session', () => {
    expect(authorize(MANAGER, 'restart-session', 'member-a1').allowed).toBe(false)
  })

  it('still DENIES an own-team COS cross-agent send-command', () => {
    expect(authorize(COS_A, 'send-command', 'member-a1').allowed).toBe(false)
  })
})
