// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TeamCard from '@/components/sidebar/TeamCard'
import type { Team } from '@/types/team'
import type { Agent } from '@/types/agent'

/**
 * `components/sidebar/TeamCard.tsx:71` — R7.7, "Show blocked badge on teams when no MANAGER
 * exists".
 *
 * WHY THIS IS A `.tsx` TEST AND NOT A CATEGORY ERROR
 * --------------------------------------------------
 * R7.7 is a PRESENTATION rule: its whole content is what the operator SEES. The component is
 * therefore its only possible enforcement point, and rendering it is the only way to prove the
 * rule holds. The "a check in a client is no check" principle governs AUTHORIZATION — every route
 * is curl-able, so an authorization check must land in the route — and reading it as a blanket
 * ban on `.tsx` guards would wrongly gut this row and eight others. (2026-07-30 STATE ruling on
 * TRDD-H4Y9F25J.)
 *
 * THE RULE HAS TWO CLAUSES AND THEY LIVE IN TWO PLACES
 * ---------------------------------------------------
 *   "show a blocked badge"      -> this component (pinned here)
 *   "when no MANAGER exists"    -> `lib/team-registry.ts:427` (`blockAllTeams`), which is R1.5's
 *                                  guard and is already pinned by
 *                                  `tests/governance/r1-r2-team-registry.test.ts`.
 *
 * So the badge keys off `team.blocked`, and the *cause* of that flag is a different guard's job.
 * Both sites are now cited on R7.7's row: a rule cited at one of its two sites leaves the other
 * invisible to every instrument, because the citation it lacks names real working code and
 * nothing reddens. This test drives the display half end-to-end and reads the flag's meaning
 * from the badge the operator actually sees.
 *
 * WHY THE ABSENT CASE IS NOT OPTIONAL
 * -----------------------------------
 * The guard is one `&&`. A test that only asserts the badge appears when `blocked: true` also
 * passes against a badge that is rendered UNCONDITIONALLY — which would mark every healthy team
 * as frozen, the loudest possible false alarm in the sidebar. The two cases together are what
 * make the `&&` load-bearing.
 *
 * NEUTER RECORD (2026-07-30):
 *   A. drop the `team.blocked &&` condition (render the badge always)
 *      -> ONLY "does NOT show it on a healthy team" fails.
 *   B. delete the whole badge block
 *      -> ONLY "shows a BLOCKED badge …" fails.
 * Each mutation reddens exactly one test, which is what proves neither is redundant.
 */

const AGENTS: Agent[] = []

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Alpha Team',
    description: '',
    agentIds: [],
    type: 'closed',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  } as Team
}

function renderCard(team: Team) {
  return render(
    <TeamCard team={team} agents={AGENTS} onEdit={() => {}} onDelete={() => {}} />,
  )
}

afterEach(cleanup)

describe('R7.7 — a team frozen by the missing-MANAGER cascade is visibly BLOCKED', () => {
  it('shows a BLOCKED badge when team.blocked is set', () => {
    renderCard(makeTeam({ blocked: true }))

    // Queried by ACCESSIBLE NAME, not by class or by the literal "BLOCKED" text: the rule is
    // that the operator can perceive the state, and a badge only a sighted user can read is a
    // weaker guarantee than the rule claims. The aria-label is also the stable half — the
    // styling changes, the meaning does not.
    const badge = screen.getByLabelText(/team is blocked/i)
    expect(badge).toBeTruthy()
    expect(badge.textContent).toMatch(/BLOCKED/)

    // The tooltip must say how to UNDO it. A badge that reports paralysis without naming the
    // remedy sends the operator hunting; this is the half a purely visual check would miss.
    expect(badge.getAttribute('title')).toMatch(/no MANAGER on host/i)
    expect(badge.getAttribute('title')).toMatch(/assign a MANAGER/i)
  })

  it('does NOT show it on a healthy team', () => {
    // The complementary half. Without it, the assertion above is also satisfied by a badge
    // rendered unconditionally — which would mark every healthy team as frozen.
    renderCard(makeTeam({ blocked: false }))
    expect(screen.queryByLabelText(/team is blocked/i)).toBeNull()

    // And an ABSENT flag, not just a false one: `blocked` is optional on the type, and a guard
    // written as `team.blocked !== false` would pass the case above and fail here.
    cleanup()
    renderCard(makeTeam())
    expect(screen.queryByLabelText(/team is blocked/i)).toBeNull()
  })

  it('POSITIVE CONTROL — the card really rendered', () => {
    // Both assertions above are "the badge is absent"-shaped, and a component that threw, or a
    // render that produced nothing at all, would satisfy them for entirely the wrong reason.
    renderCard(makeTeam({ name: 'Rendered Team' }))
    expect(screen.getByText('Rendered Team')).toBeTruthy()
  })
})
