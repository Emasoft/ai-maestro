/**
 * Portfolio issue-guard tests (R28.2 / R29 / R30) — who may mint which token.
 *
 * Matrix: MANAGER mints anything; system-owner (USER/dashboard) mints anything;
 * COS mints ONLY own-team-MEMBER `agent:create` mandates and is denied
 * team:create / non-member / approval-kind / non-allowed scope; MEMBER and
 * other titles are refused; malformed bodies are rejected.
 *
 * isAgentInTeam reads the team registry via require(), so team-registry is
 * mocked to a controllable membership table.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import path from 'path'
import Module from 'module'

// portfolio-issue-guard reaches the team registry via a runtime
// `require('@/lib/team-registry')`, which vitest's resolve.alias does NOT
// rewrite (alias applies to ESM import only). Redirect that one specifier to a
// CJS stub via Module._resolveFilename so the real canIssue runs against
// controllable membership. See the stub's header for the full rationale.
const TEAM_STUB = path.join(__dirname, '__portfolio_stubs__', 'team-registry.cjs')
const _origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request === '@/lib/team-registry') return TEAM_STUB
  return _origResolve.call(this, request, ...rest)
}

const teamStub = require('@/lib/team-registry') as {
  __setTeams: (t: Array<{ id: string; chiefOfStaffId?: string | null; agentIds: string[] }>) => void
  __setThrows: (v: boolean) => void
}

import { canIssue, type IssueRequestBody } from '@/lib/portfolio-issue-guard'
import type { AuthContext } from '@/lib/agent-auth'

beforeAll(() => {
  teamStub.__setTeams([
    { id: 'team-cos', chiefOfStaffId: 'cos-self', agentIds: ['cos-self', 'member-in', 'orch-1'] },
    { id: 'team-other', chiefOfStaffId: 'cos-other', agentIds: ['cos-other', 'member-other', 'cos-self-lookalike'] },
  ])
})

function ctx(over: Partial<AuthContext> = {}): AuthContext {
  return { isSystemOwner: false, ...over }
}

const mandateAgentCreate: IssueRequestBody = {
  kind: 'mandate',
  scope: 'agent:create',
  subject_agent_id: 'member-in',
}

describe('canIssue — body validation', () => {
  it('rejects a scope without a colon', () => {
    expect(canIssue(ctx({ isSystemOwner: true }), { ...mandateAgentCreate, scope: 'bogus' }).ok).toBe(false)
  })
  it('rejects a missing subject_agent_id', () => {
    expect(canIssue(ctx({ isSystemOwner: true }), { ...mandateAgentCreate, subject_agent_id: '' }).ok).toBe(false)
  })
  it('rejects an invalid kind', () => {
    expect(canIssue(ctx({ isSystemOwner: true }), { ...mandateAgentCreate, kind: 'bogus' as IssueRequestBody['kind'] }).ok).toBe(false)
  })
})

describe('canIssue — bypass authorities', () => {
  it('system-owner (USER/dashboard) may mint anything', () => {
    expect(canIssue(ctx({ isSystemOwner: true }), { kind: 'mandate', scope: 'team:create', subject_agent_id: 'x' }).ok).toBe(true)
  })
  it('MANAGER may mint a team:create mandate for any subject', () => {
    expect(canIssue(ctx({ governanceTitle: 'manager' }), { kind: 'mandate', scope: 'team:create', subject_agent_id: 'anyone' }).ok).toBe(true)
  })
  it('MANAGER may mint an approval for any subject', () => {
    expect(canIssue(ctx({ governanceTitle: 'manager' }), { kind: 'approval', scope: 'agent:create', subject_agent_id: 'anyone' }).ok).toBe(true)
  })
})

describe('canIssue — CHIEF-OF-STAFF (narrow)', () => {
  const cos = (teamId = 'team-cos', agentId = 'cos-self') => ctx({ governanceTitle: 'chief-of-staff', teamId, agentId })

  it('may mint an agent:create mandate for an OWN-team member', () => {
    expect(canIssue(cos(), mandateAgentCreate).ok).toBe(true)
  })
  it('is DENIED team:create (MANAGER-only scope)', () => {
    expect(canIssue(cos(), { kind: 'mandate', scope: 'team:create', subject_agent_id: 'member-in' }).ok).toBe(false)
  })
  it('is DENIED a non-allowed scope', () => {
    expect(canIssue(cos(), { kind: 'mandate', scope: 'plugin:install', subject_agent_id: 'member-in' }).ok).toBe(false)
  })
  it('is DENIED an approval-kind token (mandate-only)', () => {
    expect(canIssue(cos(), { ...mandateAgentCreate, kind: 'approval' }).ok).toBe(false)
  })
  it('is DENIED empowering a NON-member', () => {
    expect(canIssue(cos(), { ...mandateAgentCreate, subject_agent_id: 'outsider' }).ok).toBe(false)
  })
  it('is DENIED when the COS chairs no team', () => {
    expect(canIssue(cos('team-cos', 'nobody'), mandateAgentCreate)).toEqual({
      ok: false,
      reason: 'A CHIEF-OF-STAFF may only empower members of its OWN team.',
    })
  })
  it('TRDD-A50RC5G8: the registry chair of the member\'s team is ALLOWED', () => {
    expect(canIssue(cos(), mandateAgentCreate)).toEqual({ ok: true })
  })
  it('TRDD-A50RC5G8: a COS-titled agent whose token teamId names the member\'s team but who is not its chair is DENIED', () => {
    expect(canIssue(cos('team-cos', 'cos-other'), mandateAgentCreate)).toEqual({
      ok: false,
      reason: 'A CHIEF-OF-STAFF may only empower members of its OWN team.',
    })
  })
  it('TRDD-A50RC5G8: a wrong token teamId does not stop the registry chair (ALLOWED)', () => {
    expect(canIssue(cos('team-other'), mandateAgentCreate)).toEqual({ ok: true })
  })
  it('TRDD-A50RC5G8: an unreadable team registry is DENIED with its own reason and logged', () => {
    /** Fail closed: a throwing registry read must not read as "chairs no team" nor as allowed */
    teamStub.__setThrows(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(canIssue(cos(), mandateAgentCreate)).toEqual({
        ok: false,
        reason: 'Team registry could not be read; refusing to mint (TRDD-A50RC5G8).',
      })
      expect(warn).toHaveBeenCalled()
    } finally {
      teamStub.__setThrows(false)
      warn.mockRestore()
    }
  })
})

describe('canIssue — everyone else', () => {
  it('a MEMBER may not mint', () => {
    expect(canIssue(ctx({ governanceTitle: 'member' }), mandateAgentCreate).ok).toBe(false)
  })
  it('an AUTONOMOUS agent may not mint', () => {
    expect(canIssue(ctx({ governanceTitle: 'autonomous' }), mandateAgentCreate).ok).toBe(false)
  })
  it('a title-less agent may not mint', () => {
    expect(canIssue(ctx({}), mandateAgentCreate).ok).toBe(false)
  })
})
