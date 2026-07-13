/**
 * The `manage-trdd` authorization matrix (TRDD-K2WJH7RF Part 1).
 *
 * K2WJH7RF's Verification section names the cases that matter, and they are the
 * ones a careless implementation gets wrong:
 *   • an agent cannot approve its OWN proposal
 *   • an agent cannot approve ABOVE its tier
 *   • `archive failed` is refused
 *
 * The trap this file exists to catch: `manage-trdd` is the FIRST non-agent-targeted
 * action, so if it ever falls through to authorize()'s general rules, the
 * "MANAGER → always allowed" branch grants a MANAGER the two things the approval
 * system exists to deny — approving a USER-reserved TRDD, and approving its own.
 */
import { describe, it, expect } from 'vitest'
import { authorize, type TrddAuthContext } from '@/lib/authorization'
import { rejectUnarchivableState, readMinApproval, ARCHIVABLE_STATES } from '@/lib/trdd-authz'
import type { AgentAuthResult } from '@/lib/agent-auth'

const MANAGER_ID = '11111111-1111-4111-8111-111111111111'
const COS_ID = '22222222-2222-4222-8222-222222222222'
const ORCH_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_ID = '44444444-4444-4444-8444-444444444444'

const agent = (id: string, title: string): AgentAuthResult => ({
  agentId: id,
  governanceTitle: title,
})

const MANAGER = agent(MANAGER_ID, 'manager')
const COS = agent(COS_ID, 'chief-of-staff')
const ORCH = agent(ORCH_ID, 'orchestrator')
const MEMBER = agent(MEMBER_ID, 'member')

/** The human owner: no agentId. authorize() grants this before the matrix runs. */
const SYSTEM_OWNER: AgentAuthResult = {}

const ctx = (over: Partial<TrddAuthContext>): TrddAuthContext => ({
  verb: 'approve',
  minApproval: 'manager',
  ...over,
})

const can = (auth: AgentAuthResult, c: TrddAuthContext) =>
  authorize(auth, 'manage-trdd', undefined, c).allowed

describe('manage-trdd — fail-closed', () => {
  it('denies when no TRDD context is supplied (a guessed tier is a guessed approval)', () => {
    const res = authorize(MANAGER, 'manage-trdd', undefined, undefined)
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/requires the TRDD context/i)
  })

  it('grants the system owner before the matrix is ever consulted', () => {
    expect(can(SYSTEM_OWNER, ctx({ verb: 'approve', minApproval: 'user' }))).toBe(true)
  })
})

describe('manage-trdd — approve/promote by tier', () => {
  it('MANAGER may approve a manager-tier TRDD', () => {
    expect(can(MANAGER, ctx({ minApproval: 'manager' }))).toBe(true)
  })

  it('COS may approve a cos-tier TRDD', () => {
    expect(can(COS, ctx({ minApproval: 'chief-of-staff' }))).toBe(true)
  })

  it('COS may NOT approve a manager-tier TRDD (above its authority)', () => {
    const res = authorize(COS, 'manage-trdd', undefined, ctx({ minApproval: 'manager' }))
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/cannot approve a TRDD requiring manager approval/i)
  })

  it('ORCHESTRATOR may NOT approve a cos-tier TRDD', () => {
    expect(can(ORCH, ctx({ minApproval: 'chief-of-staff' }))).toBe(false)
  })

  it('a MEMBER has no approval authority at all', () => {
    expect(can(MEMBER, ctx({ minApproval: 'chief-of-staff' }))).toBe(false)
    expect(can(MEMBER, ctx({ minApproval: 'manager' }))).toBe(false)
  })

  it('NO agent may approve a USER-reserved TRDD — not even the MANAGER', () => {
    const res = authorize(MANAGER, 'manage-trdd', undefined, ctx({ minApproval: 'user' }))
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/requires USER approval/i)
  })

  it('promote carries EXACTLY approve’s authority (else it launders an approval)', () => {
    expect(can(MANAGER, ctx({ verb: 'promote', minApproval: 'manager' }))).toBe(true)
    expect(can(COS, ctx({ verb: 'promote', minApproval: 'manager' }))).toBe(false)
    expect(can(MANAGER, ctx({ verb: 'promote', minApproval: 'user' }))).toBe(false)
  })
})

describe('manage-trdd — self-approval', () => {
  it('an agent cannot APPROVE a TRDD it authored (even a MANAGER)', () => {
    const res = authorize(
      MANAGER,
      'manage-trdd',
      undefined,
      ctx({ verb: 'approve', minApproval: 'manager', createdByAgentId: MANAGER_ID }),
    )
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/cannot approve a TRDD it authored/i)
  })

  it('an agent cannot PROMOTE a TRDD it authored', () => {
    expect(
      can(MANAGER, ctx({ verb: 'promote', minApproval: 'manager', createdByAgentId: MANAGER_ID })),
    ).toBe(false)
  })

  it('approving SOMEONE ELSE’s proposal is still fine', () => {
    expect(can(MANAGER, ctx({ minApproval: 'manager', createdByAgentId: COS_ID }))).toBe(true)
  })

  it('REFUSING your own proposal IS allowed — a withdrawal costs the system nothing', () => {
    expect(
      can(MANAGER, ctx({ verb: 'refuse', minApproval: 'manager', createdByAgentId: MANAGER_ID })),
    ).toBe(true)
  })

  it('but refuse still respects the tier ladder', () => {
    expect(can(COS, ctx({ verb: 'refuse', minApproval: 'manager' }))).toBe(false)
    expect(can(MANAGER, ctx({ verb: 'refuse', minApproval: 'user' }))).toBe(false)
  })
})

describe('manage-trdd — edit is ownership, not tier', () => {
  it('the assignee may edit its own card', () => {
    expect(can(MEMBER, ctx({ verb: 'edit', assigneeAgentId: MEMBER_ID }))).toBe(true)
  })

  it('MANAGER may edit any card', () => {
    expect(can(MANAGER, ctx({ verb: 'edit', assigneeAgentId: MEMBER_ID }))).toBe(true)
  })

  it('an unrelated MEMBER may not edit someone else’s card', () => {
    const res = authorize(
      MEMBER,
      'manage-trdd',
      undefined,
      ctx({ verb: 'edit', assigneeAgentId: COS_ID }),
    )
    expect(res.allowed).toBe(false)
    expect(res.reason).toMatch(/assignee, its team ORCHESTRATOR, or MANAGER/i)
  })

  it('an ORCHESTRATOR outside the assignee’s team may not edit it', () => {
    // Neither agent is in a team, so the team ids do not match → refused. The
    // safe default: an orchestrator does not dispatch other teams' work.
    expect(can(ORCH, ctx({ verb: 'edit', assigneeAgentId: MEMBER_ID }))).toBe(false)
  })

  it('edit does NOT leak approval authority — a MEMBER assignee still cannot approve', () => {
    expect(can(MEMBER, ctx({ verb: 'edit', assigneeAgentId: MEMBER_ID }))).toBe(true)
    expect(
      can(MEMBER, ctx({ verb: 'approve', minApproval: 'manager', assigneeAgentId: MEMBER_ID })),
    ).toBe(false)
  })
})

describe('manage-trdd — archive', () => {
  it('MANAGER may archive', () => {
    expect(can(MANAGER, ctx({ verb: 'archive' }))).toBe(true)
  })

  it('the owner may archive its own card', () => {
    expect(can(MEMBER, ctx({ verb: 'archive', assigneeAgentId: MEMBER_ID }))).toBe(true)
    expect(can(MEMBER, ctx({ verb: 'archive', createdByAgentId: MEMBER_ID }))).toBe(true)
  })

  it('an unrelated agent may not archive', () => {
    expect(can(MEMBER, ctx({ verb: 'archive', assigneeAgentId: COS_ID }))).toBe(false)
  })
})

describe('archive state — a failed TRDD is retryable and must never be archived', () => {
  it('refuses `failed`', () => {
    const res = rejectUnarchivableState('failed')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
  })

  it('refuses any non-terminal column, and anything missing', () => {
    for (const bad of ['dev', 'testing', 'blocked', 'planned', '', null, undefined, 42]) {
      expect(rejectUnarchivableState(bad), String(bad)).not.toBeNull()
    }
  })

  it('permits exactly completed | cancelled | superseded', () => {
    expect([...ARCHIVABLE_STATES].sort()).toEqual(['cancelled', 'completed', 'superseded'])
    for (const ok of ARCHIVABLE_STATES) {
      expect(rejectUnarchivableState(ok), ok).toBeNull()
    }
  })

  it('binds the HUMAN owner too — it is a data invariant, not an authorization one', () => {
    // authorize() grants the system-owner unconditionally, so a check placed
    // there would never run for the human. This one is route-level on purpose.
    expect(can(SYSTEM_OWNER, ctx({ verb: 'archive' }))).toBe(true)
    expect(rejectUnarchivableState('failed')).not.toBeNull()
  })
})

describe('min-approval-requirement parsing', () => {
  it('reads the ladder', () => {
    expect(readMinApproval({ 'min-approval-requirement': 'manager' })).toBe('manager')
    expect(readMinApproval({ 'min-approval-requirement': 'none' })).toBe('none')
    expect(readMinApproval({ 'min-approval-requirement': 'USER' })).toBe('user')
  })

  it('decodes the DEPRECATED approval-tier: N', () => {
    expect(readMinApproval({ 'approval-tier': 0 })).toBe('none')
    expect(readMinApproval({ 'approval-tier': 1 })).toBe('chief-of-staff')
    expect(readMinApproval({ 'approval-tier': 2 })).toBe('manager')
    expect(readMinApproval({ 'approval-tier': 3 })).toBe('user')
  })

  it('an absent or unparseable tier fails SAFE to `manager`, never to `none`', () => {
    // Defaulting to `none` would mean a typo in frontmatter silently opens a card
    // to the entire fleet. The safe direction for an unknown tier is restrictive.
    expect(readMinApproval({})).toBe('manager')
    expect(readMinApproval({ 'min-approval-requirement': 'gibberish' })).toBe('manager')
    expect(can(MEMBER, ctx({ minApproval: readMinApproval({}) }))).toBe(false)
  })
})
