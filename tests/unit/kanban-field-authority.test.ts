import { describe, it, expect } from 'vitest'
import {
  authorizeKanbanFieldWrite,
  touchesGateField,
  GOVERNED_TARGET_COLUMNS,
  REVIEW_COLUMNS,
  DESIGN_REVIEW_COLUMNS,
  GATE_CRITICAL_COLUMN_IDS,
  type KanbanFieldAuthzInput,
} from '@/lib/kanban-field-authority'
import { DEFAULT_STATUSES } from '@/types/task'

// ai-maestro#47 verb 3 — the kanban field-write judgment gate (pure, no mocks).
// Verifies: GATE 1 (governed transitions + release-evidence need MANAGER-by-AID or
// the human owner) and GATE 2 (self-review ban), against the REAL exported function.

const MEMBER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const MANAGER = '33333333-3333-4333-8333-333333333333'

// Base input: a non-manager agent, no gate fields, no current review state.
function base(overrides: Partial<KanbanFieldAuthzInput> = {}): KanbanFieldAuthzInput {
  return {
    requesterAgentId: MEMBER,
    requesterIsManagerOrOwner: false,
    currentStatus: 'dev',
    assigneeAgentId: MEMBER,
    requested: {},
    ...overrides,
  }
}

describe('touchesGateField — the route uses this to skip the extra read', () => {
  it('returns false for an ordinary edit (subject/priority only)', () => {
    expect(touchesGateField({ subject: 'x', priority: 1 })).toBe(false)
  })
  it('returns true when status is written', () => {
    expect(touchesGateField({ status: 'dev' })).toBe(true)
  })
  it('returns true when reviewResult is written', () => {
    expect(touchesGateField({ reviewResult: 'pass' })).toBe(true)
  })
  it('returns true when a release-evidence field (publishedVersion/liveSince) is written', () => {
    expect(touchesGateField({ publishedVersion: '1.2.3' })).toBe(true)
    expect(touchesGateField({ liveSince: '2026-07-16T00:00:00Z' })).toBe(true)
  })
})

describe('system-owner bypass — the human is the ultimate authority', () => {
  it('allows a governed status move + reviewResult when there is no agent id', () => {
    const r = authorizeKanbanFieldWrite(
      base({ requesterAgentId: undefined, requested: { status: 'published', reviewResult: 'pass' } }),
    )
    expect(r).toBeNull()
  })
})

describe('GATE 1 — governed transitions + release-evidence need MANAGER-by-AID or owner', () => {
  it('refuses a non-manager moving a card to a governed column (published)', () => {
    const r = authorizeKanbanFieldWrite(base({ requested: { status: 'published' } }))
    expect(r?.status).toBe(403)
    expect(r?.field).toBe('status')
  })
  it('refuses a non-manager setting liveSince (release confirmation)', () => {
    const r = authorizeKanbanFieldWrite(base({ requested: { liveSince: '2026-07-16T00:00:00Z' } }))
    expect(r?.status).toBe(403)
    expect(r?.field).toBe('liveSince')
  })
  it('refuses a non-manager moving a card to failed (terminal decision)', () => {
    const r = authorizeKanbanFieldWrite(base({ requested: { status: 'failed' } }))
    expect(r?.status).toBe(403)
  })
  it('allows a MANAGER to move a card to a governed column', () => {
    const r = authorizeKanbanFieldWrite(
      base({ requesterIsManagerOrOwner: true, assigneeAgentId: OTHER, requested: { status: 'published' } }),
    )
    expect(r).toBeNull()
  })
  it('allows any team member to make a mechanical move (dev)', () => {
    const r = authorizeKanbanFieldWrite(base({ requested: { status: 'dev' } }))
    expect(r).toBeNull()
  })
})

// 3.0.0 (PRRD G4.1 / G7.1). These drive the REAL gate, not the set — a set-membership
// assertion is satisfied by an unread set, and DESIGN_REVIEW_COLUMNS shipped exactly that way
// (exported, asserted, read by nothing) until these landed.
describe('GATE 1 — the design-stage approval gates (3.0.0)', () => {
  it('refuses a non-manager approving its own card into design (approval → design)', () => {
    const r = authorizeKanbanFieldWrite(base({ currentStatus: 'approval', requested: { status: 'design' } }))
    expect(r?.status).toBe(403)
    expect(r?.field).toBe('status')
  })
  it('allows a MANAGER to approve a card into design', () => {
    const r = authorizeKanbanFieldWrite(base({
      requesterAgentId: MANAGER, requesterIsManagerOrOwner: true, assigneeAgentId: OTHER,
      currentStatus: 'approval', requested: { status: 'design' },
    }))
    expect(r).toBeNull()
  })
  it('refuses a non-manager escalating design_ai_review → design_human_review', () => {
    const r = authorizeKanbanFieldWrite(base({
      currentStatus: 'design_ai_review', requested: { status: 'design_human_review' },
    }))
    expect(r?.status).toBe(403)
  })
  it('still lets any member SUBMIT for approval and for design review (the asking is mechanical)', () => {
    expect(authorizeKanbanFieldWrite(base({ currentStatus: 'backburner', requested: { status: 'approval' } }))).toBeNull()
    expect(authorizeKanbanFieldWrite(base({ currentStatus: 'design', requested: { status: 'design_ai_review' } }))).toBeNull()
  })
  it('still lets any member walk the verify/plan gates (todo → verify_assumptions → plan → dispatch)', () => {
    expect(authorizeKanbanFieldWrite(base({ currentStatus: 'todo', requested: { status: 'verify_assumptions' } }))).toBeNull()
    expect(authorizeKanbanFieldWrite(base({ currentStatus: 'verify_assumptions', requested: { status: 'plan' } }))).toBeNull()
    expect(authorizeKanbanFieldWrite(base({ currentStatus: 'plan', requested: { status: 'dispatch' } }))).toBeNull()
  })
})

describe('GATE 1 — governed BACKWARD transitions into dev (ai-maestro#74 BYPASS 2)', () => {
  it('refuses a non-manager un-escalating human_review → dev', () => {
    const r = authorizeKanbanFieldWrite(base({ currentStatus: 'human_review', requested: { status: 'dev' } }))
    expect(r?.status).toBe(403)
    expect(r?.field).toBe('status')
  })
  it('refuses a non-manager pulling live_auditing → dev', () => {
    const r = authorizeKanbanFieldWrite(base({ currentStatus: 'live_auditing', requested: { status: 'dev' } }))
    expect(r?.status).toBe(403)
    expect(r?.field).toBe('status')
  })
  it('allows a MANAGER to move human_review → dev', () => {
    const r = authorizeKanbanFieldWrite(
      base({ requesterIsManagerOrOwner: true, assigneeAgentId: OTHER, currentStatus: 'human_review', requested: { status: 'dev' } }),
    )
    expect(r).toBeNull()
  })
  it('allows a MANAGER to move live_auditing → dev', () => {
    const r = authorizeKanbanFieldWrite(
      base({ requesterIsManagerOrOwner: true, assigneeAgentId: OTHER, currentStatus: 'live_auditing', requested: { status: 'dev' } }),
    )
    expect(r).toBeNull()
  })
  it('allows the human owner to move human_review → dev (no agent id)', () => {
    const r = authorizeKanbanFieldWrite(base({ requesterAgentId: undefined, currentStatus: 'human_review', requested: { status: 'dev' } }))
    expect(r).toBeNull()
  })
  // NO REGRESSION: only human_review / live_auditing are governed sources into dev. A rejected
  // review (ai_review → dev) and ordinary back-to-work (testing → dev) stay EXEMPT (§A).
  it('still allows a non-manager rejecting a review: ai_review → dev', () => {
    const r = authorizeKanbanFieldWrite(base({ currentStatus: 'ai_review', requested: { status: 'dev' } }))
    expect(r).toBeNull()
  })
  it('still allows a non-manager moving testing → dev (ordinary back-to-work)', () => {
    const r = authorizeKanbanFieldWrite(base({ currentStatus: 'testing', requested: { status: 'dev' } }))
    expect(r).toBeNull()
  })
})

describe('GATE 2 — self-review ban', () => {
  it('allows a non-manager agent to review SOMEONE ELSE’s card (legit reviewer)', () => {
    const r = authorizeKanbanFieldWrite(
      base({ requesterAgentId: OTHER, assigneeAgentId: MEMBER, requested: { reviewResult: 'pass' } }),
    )
    expect(r).toBeNull()
  })
  it('refuses an assignee setting reviewResult on its OWN card', () => {
    const r = authorizeKanbanFieldWrite(
      base({ requesterAgentId: MEMBER, assigneeAgentId: MEMBER, requested: { reviewResult: 'pass' } }),
    )
    expect(r?.status).toBe(403)
    expect(r?.field).toBe('reviewResult')
  })
  it('refuses even a MANAGER from reviewing its OWN assigned card (self-judgment binds all titles)', () => {
    const r = authorizeKanbanFieldWrite(
      base({
        requesterAgentId: MANAGER,
        requesterIsManagerOrOwner: true,
        assigneeAgentId: MANAGER,
        requested: { reviewResult: 'pass' },
      }),
    )
    expect(r?.status).toBe(403)
    expect(r?.field).toBe('reviewResult')
  })
  it('refuses a MANAGER accepting the review of its OWN card (ai_review → complete)', () => {
    // GATE 1 passes (manager may reach a governed column); GATE 2 catches the self-accept.
    const r = authorizeKanbanFieldWrite(
      base({
        requesterAgentId: MANAGER,
        requesterIsManagerOrOwner: true,
        assigneeAgentId: MANAGER,
        currentStatus: 'ai_review',
        requested: { status: 'complete' },
      }),
    )
    expect(r?.status).toBe(403)
    expect(r?.field).toBe('status')
  })
  it('allows a MANAGER (not the assignee) to accept a review (ai_review → complete)', () => {
    const r = authorizeKanbanFieldWrite(
      base({
        requesterAgentId: MANAGER,
        requesterIsManagerOrOwner: true,
        assigneeAgentId: MEMBER,
        currentStatus: 'ai_review',
        requested: { status: 'complete' },
      }),
    )
    expect(r).toBeNull()
  })
})

describe('sanity — the ratified column sets', () => {
  it('governed set covers the NON-EXEMPT Y/Z targets, not the mechanical ones', () => {
    // `design` and `design_human_review` joined the governed set in 3.0.0: entering `design` IS
    // the COS/MANAGER approval verdict (PRRD G4.1) and `design_human_review` is an escalation to
    // the human (PRRD G7.1), structurally identical to `human_review`. Leaving either mechanical
    // would make the approval column the USER ratified a label any member could move a card past.
    for (const c of ['human_review', 'complete', 'publish', 'deploy', 'published', 'live', 'failed', 'superseded', 'design', 'design_human_review']) {
      expect(GOVERNED_TARGET_COLUMNS.has(c)).toBe(true)
    }
    // `approval` stays mechanical (the card's own owner SUBMITS it for approval — the governed act
    // is the answer, not the asking) and so does `design_ai_review` (the designer submits into it).
    for (const c of ['todo', 'dispatch', 'dev', 'testing', 'ai_review', 'blocked', 'live_auditing', 'backburner', 'approval', 'design_ai_review', 'verify_assumptions', 'plan']) {
      expect(GOVERNED_TARGET_COLUMNS.has(c)).toBe(false)
    }
  })
  it('design-review columns are design_ai_review and design_human_review, separate from REVIEW_COLUMNS', () => {
    expect([...DESIGN_REVIEW_COLUMNS].sort()).toEqual(['design_ai_review', 'design_human_review'])
    for (const c of DESIGN_REVIEW_COLUMNS) expect(REVIEW_COLUMNS.has(c)).toBe(false)
  })
  it('review columns are ai_review and human_review', () => {
    expect([...REVIEW_COLUMNS].sort()).toEqual(['ai_review', 'human_review'])
  })
})

// ai-maestro#74 — the enum hard-lock residual (resolved as Option C). GATE_CRITICAL_COLUMN_IDS is
// what `setKanbanConfig` forces every custom board to preserve. If an id the gates key off could be
// renamed away, the predicate guarding that transition would simply never match for that team.
describe('GATE_CRITICAL_COLUMN_IDS — what a custom board may never rename away (#74 Option C)', () => {
  it('covers every id either gate keys off — governed targets, review columns, and both backward-to-dev sources plus dev itself', () => {
    for (const c of GOVERNED_TARGET_COLUMNS) expect(GATE_CRITICAL_COLUMN_IDS.has(c)).toBe(true)
    for (const c of REVIEW_COLUMNS) expect(GATE_CRITICAL_COLUMN_IDS.has(c)).toBe(true)
    // The BYPASS-2 backward moves: the SOURCE columns and the `dev` target are all load-bearing.
    for (const c of ['human_review', 'live_auditing', 'dev']) {
      expect(GATE_CRITICAL_COLUMN_IDS.has(c)).toBe(true)
    }
  })

  it('leaves the purely mechanical columns free — teams may still rename or omit those', () => {
    for (const c of ['backburner', 'todo', 'dispatch', 'testing', 'blocked', 'approval', 'verify_assumptions', 'plan']) {
      expect(GATE_CRITICAL_COLUMN_IDS.has(c)).toBe(false)
    }
  })

  it('both design-review ids are gate-critical — a board that renamed them would leave the design-review predicates unmatchable', () => {
    for (const c of DESIGN_REVIEW_COLUMNS) expect(GATE_CRITICAL_COLUMN_IDS.has(c)).toBe(true)
  })

  it('every gate-critical id is a real column in the ratified 22-col vocabulary (catches a typo that would silently never match)', () => {
    for (const c of GATE_CRITICAL_COLUMN_IDS) expect(DEFAULT_STATUSES).toContain(c)
  })
})
