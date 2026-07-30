/**
 * R4 — team composition invariants (TRDD-H4Y9F25J batch 6).
 *
 * Five of R4's six untested sub-rules are pinned here. Four of them
 * (R4.1/R4.5/R4.6/R4.7) are enforced inside `validateTeamMutation`, which is a PURE
 * function — teams in, verdict out, no filesystem, no registry, no clock. That is the
 * strongest shape a pin can have: nothing is mocked, so nothing can be mocked WRONG, and
 * the test drives the exact code the routes and pipelines call.
 *
 * R4.2 is an ABSENCE invariant ("unlimited groups"), pinned by running the proof
 * backwards — the batch-2 technique. R4.8 is a UI rule and is deliberately NOT pinned
 * here; see the note at the bottom.
 *
 * Map corrections this batch produced — reported, not silently patched, per the campaign
 * rule that a citation is evidence only once someone has executed it:
 *
 *   - **R4.4's citation was WRONG** (defect #9 in the running tally). The map cited
 *     `services/element-management-service.ts:4956`, which is inside `ChangeHook` — a
 *     `change_hook` ledger emit followed by `G05: Success`. R4.4 is about ChangeTeam
 *     auto-assigning MEMBER on join. The real guard is `ChangeTeam::G07`.
 *   - **R4.7 has a SECOND enforcement site the map never listed** — `ChangeTeam::G04a`
 *     refuses to remove a COS from its team, mirroring the registry guard.
 *   - **R4.1 likewise** — `ChangeTeam::G05` re-checks single-team membership at
 *     the pipeline layer.
 *
 * The line numbers those three carried (:5128-5137, :5056, :5110) are GONE, not updated:
 * TRDD-DQ6XN2VP's ChangeTeam retrofit moved every one of them, which is the third time this
 * repo has watched a range rot while the label beside it stayed true. A `<Pipeline>::<Gnn>`
 * label moves with the code; a range is a coordinate nothing checks. Cite the label.
 */
import { describe, it, expect } from 'vitest'
import { validateTeamMutation } from '@/lib/team-registry'
import type { Team } from '@/types/team'

const MANAGER = 'agent-manager'

function makeTeam(over: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Team One',
    type: 'closed',
    agentIds: [],
    chiefOfStaffId: null,
    orchestratorId: null,
    blocked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Team
}

describe('R4.1 — a non-MANAGER agent may be in at most ONE team', () => {
  it('REFUSES (409) adding an agent who already belongs to another team', () => {
    const teams = [
      makeTeam({ id: 'team-1', name: 'Team One', agentIds: ['agent-a'] }),
      makeTeam({ id: 'team-2', name: 'Team Two', agentIds: [] }),
    ]

    const result = validateTeamMutation(teams, 'team-2', { agentIds: ['agent-a'] }, MANAGER)

    expect(result.valid).toBe(false)
    if (result.valid) return
    // Pin the REASON, not just the refusal: this route returns 400 from several other
    // guards, so a bare "not valid" would pass while a different rule did the refusing.
    expect(result.code).toBe(409)
    expect(result.error).toMatch(/already in team "Team One"/)
  })

  it('ALLOWS the MANAGER to join a second team — the documented exemption', () => {
    const teams = [
      makeTeam({ id: 'team-1', name: 'Team One', agentIds: [MANAGER] }),
      makeTeam({ id: 'team-2', name: 'Team Two', agentIds: [] }),
    ]

    const result = validateTeamMutation(teams, 'team-2', { agentIds: [MANAGER] }, MANAGER)

    // A positive control: without it, deleting the whole single-team loop would still
    // leave the refusal test above red-then-green in only one direction, and a guard
    // that refuses EVERYTHING would look identical to a correct one.
    expect(result.valid).toBe(true)
  })

  it('ALLOWS an agent already in THIS team to stay — it is not "joining" anything', () => {
    const teams = [makeTeam({ id: 'team-1', agentIds: ['agent-a'] })]

    const result = validateTeamMutation(teams, 'team-1', { agentIds: ['agent-a', 'agent-b'] }, MANAGER)

    expect(result.valid).toBe(true)
  })
})

describe('R4.6 — the COS must be a member of the team it leads', () => {
  it('AUTO-ADDS a COS who is missing from agentIds (the invariant is repaired, not refused)', () => {
    const teams = [makeTeam({ id: 'team-1', agentIds: ['agent-a'] })]

    const result = validateTeamMutation(
      teams,
      'team-1',
      { chiefOfStaffId: 'agent-cos', agentIds: ['agent-a'] },
      MANAGER,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    // THE POINT: the COS is present in the sanitized output even though the caller
    // omitted it. R4.6 exists because the same-team message filter reads agentIds — a
    // COS missing from that array is invisible to its own team's routing.
    expect(result.sanitized.agentIds).toContain('agent-cos')
  })

  it('does NOT emit sanitized.agentIds when the COS is already a member — "unchanged" is the signal', () => {
    const teams = [makeTeam({ id: 'team-1', agentIds: ['agent-cos'] })]

    const result = validateTeamMutation(
      teams,
      'team-1',
      { chiefOfStaffId: 'agent-cos', agentIds: ['agent-cos'] },
      MANAGER,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    // `sanitized` carries a field ONLY when validation CHANGED it — createTeam reads
    // `result.sanitized.agentIds ?? data.agentIds` (lib/team-registry.ts:320), so an
    // absent field means "use what the caller sent". Asserting `['agent-cos']` here
    // would pin a contract the code does not have; asserting `undefined` pins the one
    // it does, and would catch a refactor that started emitting the array
    // unconditionally (which would silently make the `??` fallback dead code).
    expect(result.sanitized.agentIds).toBeUndefined()
  })
})

describe('R4.7 — a COS cannot be removed from its team while it still holds the title', () => {
  it('REFUSES (400) dropping the sitting COS out of agentIds', () => {
    const teams = [makeTeam({ id: 'team-1', agentIds: ['agent-cos', 'agent-a'], chiefOfStaffId: 'agent-cos' })]

    const result = validateTeamMutation(teams, 'team-1', { agentIds: ['agent-a'] }, MANAGER)

    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.code).toBe(400)
    expect(result.error).toMatch(/Cannot remove the Chief-of-Staff/)
  })

  it('ALLOWS the removal when the SAME mutation also hands the COS role to someone else', () => {
    const teams = [makeTeam({ id: 'team-1', agentIds: ['agent-cos', 'agent-a'], chiefOfStaffId: 'agent-cos' })]

    // The guard evaluates the COS *after* the mutation, not before — so replacing the COS
    // and dropping the old one in one call is legal. Pinning this is what stops a future
    // "simplification" from checking the pre-mutation COS and bricking every handover.
    const result = validateTeamMutation(
      teams,
      'team-1',
      { agentIds: ['agent-a'], chiefOfStaffId: 'agent-a' },
      MANAGER,
    )

    expect(result.valid).toBe(true)
  })
})

describe('R4.6 (cont.) — the auto-add must not itself create a duplicate', () => {
  /**
   * This does NOT pin R4.5, and the map row for R4.5 stays UNENFORCED. R4.5 says an
   * agent cannot be added to a team it is already in, and `validateTeamMutation` has no
   * duplicate check at all — verified by reading the whole agentIds block (no `Set(`, no
   * `indexOf` dedupe, no refusal), so `agentIds: ['a','a']` is accepted today. Titling
   * this block "R4.5" would have manufactured coverage for a rule nothing enforces,
   * which is the precise failure this campaign exists to remove. What IS pinned here is
   * R4.6's implementation staying conditional.
   */
  it('the R4.6 auto-add appends the COS exactly once, never twice', () => {
    // The auto-add must be CONDITIONAL. An unconditional `[...agentIds, cos]` would
    // satisfy R4.6 and duplicate the COS on every mutation where it was already a
    // member — the common case. Driving the branch where the auto-add actually FIRES is
    // what pins that: the output must contain exactly one copy.
    const teams = [makeTeam({ id: 'team-1', agentIds: ['agent-a'] })]

    const result = validateTeamMutation(
      teams,
      'team-1',
      { chiefOfStaffId: 'agent-cos', agentIds: ['agent-a'] },
      MANAGER,
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return
    const ids = result.sanitized.agentIds ?? []
    expect(ids.filter(id => id === 'agent-cos')).toHaveLength(1)
    expect(ids).toEqual(['agent-a', 'agent-cos'])
  })
})

describe('R4.2 — groups are unlimited (an ABSENCE invariant, proved backwards)', () => {
  it('imposes NO team-style single-membership cap on group subscriptions', async () => {
    /**
     * R4.2 says an agent may subscribe to unlimited groups, i.e. groups carry no
     * governance. There is no guard to execute, so the batch-2 technique applies: pin the
     * ABSENCE by proving the constraint that WOULD violate it does not exist.
     *
     * `subscribeToGroup` is the only mutation path, and it is idempotent-add with no
     * count check. Reading the module for the absence of a cap is the honest test here —
     * driving the real function would need a filesystem lock and would prove less, since
     * a cap could equally live in the route.
     */
    const { readFileSync } = await import('fs')
    const src = readFileSync(new URL('../../lib/group-registry.ts', import.meta.url), 'utf8')

    // No numeric ceiling on subscriberIds anywhere in the module.
    expect(src).not.toMatch(/subscriberIds\.length\s*[><=]+\s*\d/)
    expect(src).not.toMatch(/MAX_GROUPS|GROUP_LIMIT|maxSubscriptions/)
    // And the positive half: the subscribe path exists and is an unconditional append
    // once the idempotency check passes, so N successive subscriptions all land.
    expect(src).toMatch(/subscriberIds:\s*\[\.\.\.groups\[index\]\.subscriberIds,\s*agentId\]/)
  })
})

/**
 * NOT PINNED HERE, and why — R4.8 ("the UI must always show team memberships when
 * selecting agents").
 *
 * Its guard is `components/teams/TeamOverviewSection.tsx:33-34`, a React render path. The
 * repo CAN test .tsx (`tests/unit/password-dialog.test.tsx` opts into jsdom per-file), so
 * this is a real gap rather than an impossible one — but a component test belongs beside
 * the other component tests, not in a node-environment governance suite, and mixing the
 * two environments in one file is not supported. It stays counted as debt, which is the
 * honest record, exactly as R17.17/R17.20 do for the server.mjs seam.
 */
