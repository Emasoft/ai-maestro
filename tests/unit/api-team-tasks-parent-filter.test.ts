/**
 * GET /api/teams/[id]/tasks — the `parentTask` filter (ai-maestro#53).
 *
 * WHAT IT IS FOR. Listing "every child of this epic" had no server-side filter, so every caller
 * re-implemented `jq 'select(.parentTask == $p)'` over the full team payload. `--parent` on
 * `amp-kanban-create-task.sh` already SET the field; only the read side could not use it.
 *
 * WHY IT IS A POST-FETCH FILTER AND NOT A `filters` KEY. `listTeamTasks`'s filter parameter is
 * typed and feeds the GitHub-Projects query path; the `q` filter (TRDD-KJQZEYXW) was deliberately
 * placed here for that reason, and `parentTask` follows it. The test below pins that placement
 * directly — if someone moves it into `filters`, `does not push parentTask into listTeamTasks`
 * reds, and it is the only closure that could notice.
 *
 * THE DISCRIMINATING CASE is `an epic with no children returns EMPTY, not everything`. A filter
 * that is silently dropped does not return an error — it returns the UNFILTERED list, which for a
 * matching parent still contains the right tasks and therefore passes a naive assertion. Only the
 * no-match case tells "filtered to zero" from "filter ignored".
 *
 * The fixture also relies on `parentTask` surviving the GitHub round-trip (written as the
 * `parent:<id>` label at lib/github-project.ts:75, parsed back at :225). If it ever stops doing
 * so the filter would match nothing in production while these tests stayed green, because they
 * inject the task list rather than fetching it — so that round-trip is asserted where it lives,
 * not here.
 *
 * NEUTER RUNS (2026-08-05 — OBSERVED via scripts/dev/neuter, restore verified by blob hash. A
 * COMPLEMENTARY PAIR, because one filter's neuter cannot speak for the other's):
 *   A. `if (parentTask) tasks = tasks.filter(…)` → `if (false)`
 *      → 3 red / 3 green: `returns only the children of the named parent`,
 *        `an epic with no children returns EMPTY, not everything`, `parentTask and q compose`.
 *   B. `if (q) {` → `if (false) {`
 *      → 2 red / 4 green: `q alone still works`, `parentTask and q compose`.
 * Green under both: the no-filter positive control and the placement assertion — correctly, since
 * neither depends on either filter firing.
 *
 * BOTH ROUNDS OF THIS PAIR FOUND A BUG IN THE FIXTURE, NOT THE CODE, AND NEITHER WAS VISIBLE FROM
 * A GREEN RUN. The first draft's compose case used `q=logout`, which alone identifies `b`, so it
 * passed with the parentTask filter disabled — a compose test proving nothing about composition.
 * Fixing that (task `c` matches `q` under the OTHER epic) made neuter A red it, and then neuter B
 * showed it STILL passed with `q` disabled, because every child of this epic matched `q`. Task `e`
 * — under this epic, not matching `q` — is what finally makes it fail in both directions. A
 * composition assertion needs a fixture populating all four quadrants, or it is half vacuous in a
 * way only the complementary neuter can expose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockListTeamTasks } = vi.hoisted(() => ({ mockListTeamTasks: vi.fn() }))

vi.mock('@/services/teams-service', () => ({
  listTeamTasks: mockListTeamTasks,
  createTeamTask: vi.fn(),
}))
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: vi.fn(() => ({ agentId: '11111111-1111-4111-8111-111111111111' })),
  buildAuthContext: vi.fn(() => ({ isSystemOwner: true })),
}))

import { GET as tasksGET } from '@/app/api/teams/[id]/tasks/route'

const TEAM_ID = '22222222-2222-4222-8222-222222222222'
const EPIC = '44444444-4444-4444-8444-444444444444'
const OTHER_EPIC = '55555555-5555-4555-8555-555555555555'

const TASKS = [
  { id: 'a', subject: 'login endpoint', parentTask: EPIC, labels: [] },
  { id: 'b', subject: 'logout endpoint', parentTask: EPIC, labels: [] },
  // Deliberately ALSO matches `q=endpoint` while sitting under a DIFFERENT epic. Without a task
  // in that quadrant the compose test is vacuous: any `q` narrow enough to pick one child on its
  // own passes whether or not the parent filter ran. Measured — the first draft used `q=logout`,
  // which alone identifies `b`, and the neuter left that closure GREEN.
  { id: 'c', subject: 'billing endpoint', parentTask: OTHER_EPIC, labels: [] },
  { id: 'd', subject: 'orphan chore', labels: [] },
  // Under THIS epic but NOT matching `q=endpoint`. The mirror of `c`: without it, dropping the
  // `q` filter leaves the compose answer unchanged (`[a,b]` either way), so the closure caught a
  // dropped parentTask and NOT a dropped q. Measured — the complementary neuter left it green.
  // Between them, `c` and `e` make compose fail in BOTH directions.
  { id: 'e', subject: 'update docs', parentTask: EPIC, labels: [] },
]

function get(query: string) {
  return tasksGET(
    new Request(`http://localhost/api/teams/${TEAM_ID}/tasks${query}`) as never,
    { params: Promise.resolve({ id: TEAM_ID }) } as never,
  )
}

async function ids(res: Response): Promise<string[]> {
  const body = (await res.json()) as { tasks: Array<{ id: string }> }
  return body.tasks.map((t) => t.id)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListTeamTasks.mockResolvedValue({ data: { tasks: TASKS }, status: 200 })
})

describe('GET /api/teams/[id]/tasks — parentTask filter', () => {
  it('returns only the children of the named parent', async () => {
    expect(await ids(await get(`?parentTask=${EPIC}`))).toEqual(['a', 'b', 'e'])
  })

  it('an epic with no children returns EMPTY, not everything', async () => {
    // The load-bearing case. A dropped filter returns the unfiltered list, which for a MATCHING
    // parent still looks right — only this one separates "filtered to zero" from "ignored".
    expect(await ids(await get('?parentTask=66666666-6666-4666-8666-666666666666'))).toEqual([])
  })

  it('parentTask and q compose — both narrow, neither wins', async () => {
    // Two early returns would have made whichever ran first silently discard the other.
    // `endpoint` matches a, b (this epic) AND c (the other one), so dropping either filter
    // changes the answer: without parentTask → [a,b,c]; without q → [a,b].
    expect(await ids(await get(`?parentTask=${EPIC}&q=endpoint`))).toEqual(['a', 'b'])
  })

  it('does not push parentTask into listTeamTasks — it is applied post-fetch', async () => {
    // Placement proof. `listTeamTasks`'s filter arg is typed and feeds the GitHub-Projects
    // query; this is the only closure that reds if the filter is moved into it.
    await get(`?parentTask=${EPIC}`)
    const filters = mockListTeamTasks.mock.calls[0][2]
    expect(filters).toBeUndefined()
  })
})

describe('positive controls', () => {
  it('no filter returns every task', async () => {
    // Without this the file would pass against a route that returned nothing at all.
    expect(await ids(await get(''))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('q alone still works — the pre-existing filter is untouched', async () => {
    expect(await ids(await get('?q=billing'))).toEqual(['c'])
  })
})
