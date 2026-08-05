/**
 * PATCH /api/teams/[id]/kanban/items/[itemId] — the GitHub-Project mirror speaks the
 * ratified 17-column vocabulary (ai-maestro#80 item 3, reported by CORE).
 *
 * WHAT WAS WRONG. The route resolved the GitHub Project "Status" option from a hand-rolled
 * five-entry map — `backlog / todo / in_progress / review / done` — with an `|| status`
 * fallthrough. That vocabulary predates the 17 ratified columns and the route was wrong in
 * BOTH directions at once:
 *
 *   - it ACCEPTED four ids that are not statuses at all (`backlog`, `in_progress`, `review`,
 *     `done`), moving the mirrored item to a Status option the board may not even have; and
 *   - for 16 of the 17 REAL ids it fell through the map and sent GitHub the raw id
 *     (`"human_review"`) instead of the option's label (`"Human Review"`).
 *
 * Only `todo` mapped correctly, and only by coincidence — which is exactly why the defect was
 * invisible to a smoke test: the one column anybody drags a card into first is the one column
 * that worked. The kanban overlay is explicit that consumers, GitHub Project mirrors included,
 * align TO the 17-column vocabulary and never the reverse.
 *
 * WHY THE ASSERTIONS ARE SHAPED THIS WAY. Asserting `res.status === 200` would have passed
 * against the OLD code for every one of these cases — the old route happily "succeeded" while
 * handing `gh` a label that does not exist. So every positive case asserts the LABEL actually
 * passed to `moveProjectItem`, which is the only place the bug was ever observable, and every
 * rejection asserts `moveProjectItem` was NEVER CALLED — a 400 returned after the move would
 * leave the board already mutated.
 *
 * `human_review` is the discriminating positive case: under the old map it fell through to the
 * raw id, so it is the one that separates "the mapping is canonical" from "the mapping happens
 * to agree on todo".
 *
 * NEUTER RUN (recorded 2026-08-05, OBSERVED not predicted): restoring the legacy `statusMap`
 * plus its `|| status` fallthrough reddens 6 of the 8 closures below — every canonical-label
 * case except `todo` (which the legacy map also got right, so it cannot discriminate) and
 * except the custom-board case (whose ids the legacy map never had). Both survivors are named
 * here rather than deleted: `todo` is the coincidence that hid the bug, and its presence is
 * what documents why the other five are the real pins.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockTeamRegistry, mockAcl, mockGithubCli, mockGovernance } = vi.hoisted(() => ({
  mockAuth: {
    authenticateFromRequest: vi.fn(),
    buildAuthContext: vi.fn(() => ({})),
  },
  mockTeamRegistry: { getTeam: vi.fn() },
  mockAcl: { checkTeamAccess: vi.fn() },
  mockGithubCli: {
    moveProjectItem: vi.fn(),
    archiveProjectItem: vi.fn(),
    configureProjectTemplate: vi.fn(() => ({ statusFieldId: 'F_1', projectId: 'P_1' })),
  },
  mockGovernance: {
    isManager: vi.fn(() => true),
    isOrchestrator: vi.fn(() => true),
    isChiefOfStaff: vi.fn(() => true),
  },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)
vi.mock('@/lib/team-acl', () => mockAcl)
vi.mock('@/lib/github-cli', () => mockGithubCli)
vi.mock('@/lib/governance', () => mockGovernance)

import { PATCH } from '@/app/api/teams/[id]/kanban/items/[itemId]/route'

const TEAM_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const ITEM_ID = 'PVTI_lADOABCDEF'

/** A team on the DEFAULT board — `kanbanConfig` unset, so the 17 defaults apply. */
const DEFAULT_TEAM = { id: TEAM_ID, githubProject: { owner: 'Emasoft', number: 7 } }

function patch(status: string) {
  return PATCH(
    new Request(`http://localhost:23000/api/teams/${TEAM_ID}/kanban/items/${ITEM_ID}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }) as never,
    { params: Promise.resolve({ id: TEAM_ID, itemId: ITEM_ID }) },
  )
}

/** The Status label this write actually handed to `gh`. */
function labelSentToGitHub(): string | undefined {
  const call = mockGithubCli.moveProjectItem.mock.calls[0]
  return call?.[3] as string | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.authenticateFromRequest.mockReturnValue({ agentId: 'agent-1' })
  mockAuth.buildAuthContext.mockReturnValue({})
  mockAcl.checkTeamAccess.mockReturnValue({ allowed: true })
  mockTeamRegistry.getTeam.mockReturnValue(DEFAULT_TEAM)
  mockGithubCli.configureProjectTemplate.mockReturnValue({ statusFieldId: 'F_1', projectId: 'P_1' })
  mockGovernance.isManager.mockReturnValue(true)
  mockGovernance.isOrchestrator.mockReturnValue(true)
  mockGovernance.isChiefOfStaff.mockReturnValue(true)
})

describe('the mirror resolves the canonical label, not the raw column id', () => {
  // The discriminating case: the legacy map had no `human_review` entry, so the old route sent
  // GitHub the literal id. If this passes with the raw id, the mapping is not canonical.
  it('human_review is sent as "Human Review", never as the raw id', async () => {
    const res = await patch('human_review')
    expect(res.status).toBe(200)
    expect(labelSentToGitHub()).toBe('Human Review')
    expect(labelSentToGitHub()).not.toBe('human_review')
  })

  it('ai_review is sent as "AI Review"', async () => {
    await patch('ai_review')
    expect(labelSentToGitHub()).toBe('AI Review')
  })

  it('live_auditing is sent as "Live Auditing"', async () => {
    await patch('live_auditing')
    expect(labelSentToGitHub()).toBe('Live Auditing')
  })

  it('backburner — the real first column — is accepted and labelled', async () => {
    // The legacy map offered `backlog` instead, which is not a status in the ratified set at all.
    const res = await patch('backburner')
    expect(res.status).toBe(200)
    expect(labelSentToGitHub()).toBe('Backburner')
  })

  it('dev is sent as "Dev" — NOT the legacy "In Progress"', async () => {
    await patch('dev')
    expect(labelSentToGitHub()).toBe('Dev')
  })

  // Kept deliberately, and it is NOT a pin: `todo` is the single id the legacy map also got
  // right. It survives the neuter, and that is the point — this is the coincidence that hid the
  // defect from every smoke test, so it is documented rather than removed.
  it('todo is sent as "To Do" (the one id the legacy map also got right)', async () => {
    await patch('todo')
    expect(labelSentToGitHub()).toBe('To Do')
  })
})

describe('a column id outside the vocabulary is REFUSED before the board is touched', () => {
  it.each(['review', 'in_progress', 'done', 'backlog'])(
    'the legacy id %s is rejected 400 and no move is issued',
    async (legacy) => {
      const res = await patch(legacy)
      expect(res.status).toBe(400)
      // The load-bearing half: a 400 returned AFTER the move would leave the board mutated.
      expect(mockGithubCli.moveProjectItem).not.toHaveBeenCalled()
      const body = await res.json()
      expect(body.error).toMatch(/Unknown kanban column/i)
      // The refusal names the valid set — an error that does not is unactionable to a CLI caller.
      expect(body.error).toContain('human_review')
    },
  )
})

describe("a custom board's own ids win over the defaults", () => {
  it('a team kanbanConfig id resolves to that team label, and a default id it dropped is refused', async () => {
    mockTeamRegistry.getTeam.mockReturnValue({
      ...DEFAULT_TEAM,
      kanbanConfig: [
        { id: 'todo', label: 'To Do' },
        { id: 'shipping', label: 'Shipping It' },
      ],
    })

    const ok = await patch('shipping')
    expect(ok.status).toBe(200)
    expect(labelSentToGitHub()).toBe('Shipping It')

    // `dev` is a DEFAULT id, but this board does not define it — so for THIS team it is unknown.
    // A resolver that fell back to the defaults would wrongly accept it.
    vi.clearAllMocks()
    mockAuth.authenticateFromRequest.mockReturnValue({ agentId: 'agent-1' })
    mockAcl.checkTeamAccess.mockReturnValue({ allowed: true })
    mockTeamRegistry.getTeam.mockReturnValue({
      ...DEFAULT_TEAM,
      kanbanConfig: [
        { id: 'todo', label: 'To Do' },
        { id: 'shipping', label: 'Shipping It' },
      ],
    })
    mockGovernance.isManager.mockReturnValue(true)

    const refused = await patch('dev')
    expect(refused.status).toBe(400)
    expect(mockGithubCli.moveProjectItem).not.toHaveBeenCalled()
  })
})
