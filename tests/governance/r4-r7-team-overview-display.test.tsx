// @vitest-environment jsdom
/**
 * Two PRESENTATION rules that live four lines apart in the same component, and
 * are pinned together because one render drives both:
 *
 *   R4.8 — "The UI must ALWAYS show team memberships when selecting agents for
 *           any operation."   Guard: TeamOverviewSection.tsx:33-34
 *   R7.8 — "Resolve COS UUID to a human-readable agent name everywhere it is
 *           displayed — NEVER show raw UUIDs to users."
 *           Guard: TeamOverviewSection.tsx:37-42
 *
 * WHY A `.tsx` GUARD IS CORRECT FOR BOTH
 * --------------------------------------
 * Each rule's entire content is what the operator SEES, so the component is its
 * only possible enforcement point. "A check in a client is no check" governs
 * AUTHORIZATION — every route is curl-able, so an authz check must land in the
 * route — and reading it as a blanket ban on `.tsx` guards would wrongly gut
 * these rows. (Same ruling as r7-team-blocked-badge and r7-no-silent-failures.)
 *
 * R4.8 IS A PARTITION, AND A PARTITION NEEDS BOTH HALVES ASSERTED
 * --------------------------------------------------------------
 * The guard is two `filter`s that split the fleet into members and non-members.
 * "Show memberships when selecting agents" means the picker offers exactly the
 * agents NOT already in the team — the membership fact is what is shown, by
 * being acted on. A test that only checks the roster passes against a picker
 * that offers everyone (so the operator re-adds a member and eats a server
 * error), and a test that only checks the picker passes against an empty roster.
 * Neither half alone is the rule.
 *
 * R7.8's SECOND CLAUSE IS THE ONE A TEST WOULD SKIP
 * ------------------------------------------------
 * "Resolve the UUID" is easy to assert with a resolvable COS. "NEVER show raw
 * UUIDs" is about the case where resolution FAILS — an agent deleted out from
 * under the team — and the honest fallback is a truncated hint, not the 36-char
 * uuid. That branch is where a regression would actually land, because it is the
 * one nobody looks at.
 *
 * NEUTER RECORD (2026-07-30) — four, each red on exactly one test:
 *   A. drop the `!` from `availableAgents` (:34) -> only the picker test.
 *   B. `teamAgents = agents` (:33)               -> only the roster test.
 *   C. `cosDisplay` always returns the raw id    -> only the resolve test.
 *   D. the unresolved branch returns the full id -> only the never-raw test.
 * Two rules, four independent guards: no neuter reddens a test belonging to the
 * other rule, which is what shows these are two rows and not one counted twice.
 *
 * TWO THINGS THE NEUTER RUN FOUND, BOTH IN THIS FILE, NEITHER IN THE CODE
 * ----------------------------------------------------------------------
 * 1. Neuter A reddened NOTHING on its first run. The picker assertion was
 *    `queryByRole('button', {name: /^bob$/i})` — but each entry renders an
 *    avatar initial beside the name, so the accessible name is "B Bob" and the
 *    anchored regex could never match, present or absent. The assertion read as
 *    a guard and was vacuous; only the neuter said so. The regexes are now
 *    unanchored.
 * 2. Neuter C reddened TWO tests, one of them R4.8's. The roster test had
 *    pinned `getAllByText('Tatiana')` to exactly 2 — banner plus roster row —
 *    so breaking R7.8's resolver also broke an R4.8 test. That is a coupling
 *    between two rows meant to be independent, so the roster now asserts a
 *    FLOOR and the both-places claim (R7.8's own word, "everywhere") moved into
 *    the R7.8 block where it belongs.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TeamOverviewSection from '@/components/teams/TeamOverviewSection'
import type { Team } from '@/types/team'
import type { Agent } from '@/types/agent'

const COS_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const MEMBER_ID = 'bbbbbbbb-2222-4222-8222-222222222222'
const OUTSIDER_ID = 'cccccccc-3333-4333-8333-333333333333'

const AGENTS: Agent[] = [
  { id: COS_ID, name: 'cos-alpha', label: 'Tatiana' },
  { id: MEMBER_ID, name: 'dev-bob', label: 'Bob' },
  { id: OUTSIDER_ID, name: 'free-carol', label: 'Carol' },
] as Agent[]

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    name: 'Alpha Team',
    description: '',
    agentIds: [COS_ID, MEMBER_ID],
    chiefOfStaffId: COS_ID,
    type: 'closed',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  } as Team
}

function renderSection(team: Team, agents: Agent[] = AGENTS) {
  return render(
    <TeamOverviewSection
      team={team}
      agents={agents}
      taskCount={0}
      docCount={0}
      onUpdateTeam={async () => {}}
    />,
  )
}

afterEach(cleanup)

describe('R4.8 — agent selection always shows who is already a member', () => {
  it('the roster lists the team MEMBERS, with a count, and nobody else', () => {
    renderSection(makeTeam())

    expect(screen.getByText('Agents (2)')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
    // `getAllByText`, and a FLOOR rather than an exact count: the COS is also
    // named in its own banner, and pinning "exactly 2" here would make R7.8's
    // neuter redden an R4.8 test — coupling two rows that are meant to be
    // independent. The both-places claim belongs to R7.8 and is asserted there.
    expect(screen.getAllByText('Tatiana').length).toBeGreaterThanOrEqual(1)
    // The complementary half of THIS half: a roster rendering the whole fleet
    // would satisfy both assertions above.
    expect(screen.queryByText('Carol')).toBeNull()
  })

  it('the add-agent picker offers ONLY non-members — that IS the membership display', () => {
    renderSection(makeTeam())
    fireEvent.click(screen.getByRole('button', { name: /add agent/i }))

    // Carol is the only agent not on the team, so she is the only offer.
    expect(screen.getByRole('button', { name: /carol/i })).toBeTruthy()
    // And the members are NOT offered. Without this, the operator re-adds
    // someone already on the team and eats a server error the UI could have
    // prevented — which is exactly the failure R4.8 is written against.
    //
    // The regexes are deliberately UNANCHORED. An earlier draft used /^bob$/i
    // and neuter A did not redden it: each picker entry renders an avatar
    // initial beside the name, so the button's accessible name is "B Bob" and
    // `^bob$` could never match — present or absent. The assertion read as a
    // guard and was vacuous, and only the neuter run said so.
    expect(screen.queryByRole('button', { name: /tatiana/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /bob/i })).toBeNull()
  })

  it('an empty fleet says so rather than rendering nothing', () => {
    renderSection(makeTeam({ agentIds: [] }), [])
    expect(screen.getByText(/no agents in this team yet/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    expect(screen.getByText(/no available agents to add/i)).toBeTruthy()
  })
})

describe('R7.8 — the COS is named, never shown as a raw UUID', () => {
  it('resolves the COS id to the agent LABEL', () => {
    renderSection(makeTeam())

    expect(screen.getByText(/chief-of-staff/i).textContent).toMatch(/Tatiana/)
    // "EVERYWHERE it is displayed" is the rule's own word: the COS appears in
    // its banner AND in the roster row, and both must be the name.
    expect(screen.getAllByText('Tatiana')).toHaveLength(2)
    // The uuid must not survive anywhere on screen. Asserting only that the
    // label appears would pass against "Tatiana (aaaaaaaa-1111-…)".
    expect(document.body.textContent).not.toContain(COS_ID)
  })

  it('NEVER shows the raw uuid even when the COS cannot be resolved', () => {
    // The branch a test would skip: the COS agent was deleted out from under
    // the team, so there is no name to resolve to. The rule still holds.
    renderSection(makeTeam({ chiefOfStaffId: OUTSIDER_ID }), [AGENTS[1]])

    const banner = screen.getByText(/chief-of-staff/i)
    expect(banner.textContent).toMatch(/Unknown \(cccccccc\.\.\.\)/)
    expect(document.body.textContent).not.toContain(OUTSIDER_ID)
  })

  it('shows no COS line at all when the team has none — not "Unknown"', () => {
    // The third case: absent is not the same as unresolvable, and reporting a
    // phantom "Unknown" COS on a team that never had one is its own false alarm.
    renderSection(makeTeam({ chiefOfStaffId: null }))
    expect(screen.queryByText(/chief-of-staff/i)).toBeNull()
  })
})
