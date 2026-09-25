/**
 * POST /api/trdd/[id]/archive — the ROUTE is exercised end-to-end (TRDD-MQE5D28T step 4,
 * the "no route-level archive tests" gap from the Part B review,
 * reports/pillar-cli-fixes/20260925_001748+0200-archive-verb.md item 4).
 *
 * WHY THIS ALTITUDE. `trdd-archive-checklist-gate.test.ts` deliberately tests the guard
 * predicate alone (its header explains why), and `trdd-authz-archive-authority.test.ts`
 * tests the decision through `withAuthorizedTrdd` directly. Both are real coverage of the
 * PIECES; neither proves the WIRING — that the route calls the gates in its own order
 * (sudo → auth → state invariant → checklist → authorized write) with the store's actual
 * `archiveTrdd` behind them. A route that skipped `rejectUnarchivableState`, or passed the
 * raw `state` instead of the normalized one, would pass every piece test and still mint the
 * forbidden outcome. This file drives the exported POST handler over a REAL tmp corpus, so
 * the route's own call chain is the thing under test.
 *
 * WHAT IS MOCKED, AND THE ESCAPE EACH MOCK COULD HIDE:
 *   - `@/lib/sudo-guard.requireSudoToken` — stubbed to "pass" (null). The sudo classification
 *     itself is pinned separately (tests/unit/sudo-guard-strict-agent-coverage.test.ts asserts
 *     this exact route is registered strict). Stubbing lets these tests reach the DATA gates.
 *   - NOTHING ELSE. `agent-auth`, `authorization`, `trdd-authz`, `trdd-store` all run REAL
 *     against a tmp corpus. The OWNER caller is `{}` (no agentId) — the human system owner —
 *     so the real registry on this machine is never read for identity (the owner grant happens
 *     before the matrix, no registry lookup), and `resolveDesignDir` for a corpus-less owner
 *     falls to `defaultDesignDir()` = `<cwd>/design`. The test therefore chdirs into its tmp
 *     fixture (vitest's `process.chdir` is the sanctioned lever; the cwd IS how the default
 *     corpus resolves, and every test restores it in afterEach).
 *
 * THE TWO CASES, AND WHY A THIRD WOULD BE THEFT: (1) the human owner archives a tasked card
 * — the ALLOW path, proving the route really reaches `archiveTrdd` (the positive control that
 * keeps the 409 below honest); (2) the same owner asks `state: 'completed'` on an UNCHECKED
 * checklist — the checklist DATA invariant fires through the ROUTE's own call, 409. A failed
 * card owner-denial is deliberately NOT retested here: that decision's route wiring is the
 * same call chain this file proves, and the decision itself is pinned in
 * trdd-authz-archive-authority.test.ts.
 *
 * NEUTER RUNS (2026-09-25, restore verified byte-identical against git after each):
 *   - Inline state gate neutered ALONE (`if (state !== undefined && …)` → `if (false && …)`):
 *     the `state: 'failed'` test REDDENS (400 arrives from rejectUnarchivableState instead,
 *     whose `error: 'trdd_not_archivable'` does not match the test's message regex). The test
 *     therefore pins the route's INLINE gate and its message specifically.
 *   - `rejectUnarchivableState` neutered ALONE (→ `rejectUnarchivableState(undefined)`):
 *     the `state: 'failed'` test still PASSES — the inline gate fires first with a message
 *     the regex matches. This gate is defense-in-depth behind the inline check for THIS
 *     route's callers; its decision semantics are pinned in trdd-authz-archive-authority.
 *   - BOTH state gates neutered (pair): the `state: 'failed'` test REDDENS. At least one of
 *     the two must stand for a `failed` state to be refused through the route.
 *   - Checklist gate neutered: the open-box test REDDENS (the 409 goes away).
 *   - The sudo short-circuit test is itself the wiring proof for the sudo gate (it mocks the
 *     guard to a 403 response and asserts the short-circuit), so no separate neuter applies.
 *
 * HOME JAIL: beforeAll redirects `process.env.HOME` to a throwaway dir (restored in afterAll).
 * The cookie path reaches `validateSessionWithUser` → `isUserAuthorityModelEnabled()` →
 * `loadGovernance()`, which on a machine with no `~/.aimaestro/governance.json` performs
 * first-run initialization and WRITES it. The jail turns that write into the fixture dir; the
 * `real-state-dir-untouched` global watcher would otherwise be the only backstop.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { guardRealUserSettings } from '../helpers/real-home-untouched'
import { createSession, invalidateSession } from '@/lib/session-auth'

const { mockGuard } = vi.hoisted(() => ({
  mockGuard: { requireSudoToken: vi.fn() },
}))

// importOriginal, not a wholesale mock — a wholesale mock throws at module
// load the day the route destructures a second export from this module.
vi.mock('@/lib/sudo-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sudo-guard')>()),
  requireSudoToken: mockGuard.requireSudoToken,
}))

let validCookie = ''

// Route module is imported AFTER the mocks (vi.mock hoists anyway, but keep the order legible).
const post = async (body: Record<string, unknown>, id: string) => {
  const { POST } = await import('@/app/api/trdd/[id]/archive/route')
  const req = {
    headers: { get: (n: string) => (n === 'Cookie' ? validCookie : null) },
    json: async () => body,
    url: `http://localhost:23000/api/trdd/${id}/archive`,
    method: 'POST',
  } as unknown as import('next/server').NextRequest
  return POST(req, { params: Promise.resolve({ id }) })
}

/**
 * A real session token minted by the login route's own issuer — the web-session system-owner
 * path (Case 1 of authenticateAgent), which is also what the real dashboard sends. A null
 * Cookie header is NOT the owner: the BYPASS-2 closure makes header-less requests a plain
 * 401, so driving the route that way would test nothing past its first line.
 */

/** The human owner: no agentId — granted before the matrix, no registry lookup. */
const OWNER_BODY = {}

const ID = 'ROUTEAA1'

function cardFile(id: string, column: string, acceptance = ''): string {
  return [
    '---',
    `trdd-id: ${id}`,
    'status: tasked',
    'title: route archive fixture',
    `column: ${column}`,
    'created: 2026-01-01T00:00:00+0100',
    'updated: 2026-01-01T00:00:00+0100',
    '---',
    '',
    `# TRDD-${id} — route archive fixture`,
    '',
    'body',
    acceptance,
    '## Approval log',
    '',
  ].join('\n')
}

const DONE_CHECKLIST = '\n## Acceptance\n\n- [x] done\n'

describe('POST /api/trdd/[id]/archive — the route wiring (TRDD-MQE5D28T step 4)', () => {
  let root: string
  let savedCwd: string
  let savedHome: string | undefined
  let assertHomeUntouched: () => void

  beforeAll(async () => {
    assertHomeUntouched = guardRealUserSettings()
    // HOME JAIL (see header): loadGovernance() creates ~/.aimaestro/governance.json on a
    // machine without one; point HOME at a throwaway so that first-run write lands here.
    // governance.ts resolves getStateDir() at MODULE LOAD, so the jail must be set before
    // the route's import chain first loads it — it is: this runs before `post`'s first
    // dynamic import, and no earlier import in this file touches governance.
    savedHome = process.env.HOME
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-archive-route-home-'))
    validCookie = `aim_session=${await createSession()}`
  })
  afterAll(() => {
    const jailedHome = process.env.HOME
    process.env.HOME = savedHome
    if (jailedHome) fs.rmSync(jailedHome, { recursive: true, force: true })
    assertHomeUntouched()
    const token = validCookie.slice('aim_session='.length)
    if (token) invalidateSession(token)
  })

  beforeEach(() => {
    mockGuard.requireSudoToken.mockReturnValue(null)
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-archive-route-'))
    for (const z of ['proposals', 'tasks', 'archived']) {
      fs.mkdirSync(path.join(root, 'design', z), { recursive: true })
    }
    savedCwd = process.cwd()
    process.chdir(root)
    // CONTAINMENT: if the cwd switch did not take effect, the route would resolve the
    // REAL repo's design/ — fail here, before any test reads or moves anything.
    // realpath on BOTH sides: macOS /var is a symlink to /private/var, and getcwd
    // resolves it (the same canonicalization lib/pillar/environment.ts documents).
    expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(root))
  })

  afterEach(() => {
    process.chdir(savedCwd)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('POSITIVE CONTROL: the human owner archives a tasked card — the file moves for real', async () => {
    fs.writeFileSync(
      path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`),
      cardFile(ID, 'dev'),
    )
    const res = await post(OWNER_BODY, ID)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, id: ID, from: 'tasks', to: 'archived', column: 'dev' })
    // The move happened on disk, through the REAL store — not a mocked shape.
    expect(fs.existsSync(path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`))).toBe(false)
    expect(fs.existsSync(path.join(root, 'design', 'archived', `TRDD-20260101_000000+0100-${ID}-x.md`))).toBe(true)
  })

  it("state: 'completed' on an UNCHECKED checklist is refused 409 by the route's own checklist gate", async () => {
    fs.writeFileSync(
      path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`),
      cardFile(ID, 'dev', '\n## Acceptance\n\n- [ ] not done yet\n'),
    )
    const res = await post({ state: 'completed' }, ID)
    expect(res.status).toBe(409)
    const body = await res.json()
    // The route's error code for the open-box refusal (rejectIncompleteChecklist →
    // trdd_terminal_with_open_box), not a generic 500 shape.
    expect(body.error).toBe('trdd_terminal_with_open_box')
    // Nothing moved — a refusal is a refusal, not a refusal after the fact.
    expect(fs.existsSync(path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`))).toBe(true)
    expect(fs.existsSync(path.join(root, 'design', 'archived', `TRDD-20260101_000000+0100-${ID}-x.md`))).toBe(false)
  })

  it("the route passes the route-validated state through: a DONE checklist archives with column 'completed'", async () => {
    fs.writeFileSync(
      path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`),
      cardFile(ID, 'dev', DONE_CHECKLIST),
    )
    const res = await post({ state: 'completed' }, ID)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, column: 'completed' })
    const archived = path.join(root, 'design', 'archived', `TRDD-20260101_000000+0100-${ID}-x.md`)
    expect(fs.readFileSync(archived, 'utf-8')).toMatch(/^column: completed$/m)
  })

  it("state: 'failed' is refused 400 by the route's own state invariant — for the owner too", async () => {
    fs.writeFileSync(
      path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`),
      cardFile(ID, 'dev'),
    )
    const res = await post({ state: 'failed' }, ID)
    expect(res.status).toBe(400)
    const body = await res.json()
    // The route's own pre-check fires first (`{state}, when given, must be one of …`),
    // which is the same DATA invariant rejectUnarchivableState enforces for every caller.
    expect(body.error).toMatch(/must be one of completed, cancelled, superseded/)
    expect(fs.existsSync(path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`))).toBe(true)
  })

  it('an invalid sudo gate response short-circuits before any write', async () => {
    fs.writeFileSync(
      path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`),
      cardFile(ID, 'dev'),
    )
    const { NextResponse } = await import('next/server')
    mockGuard.requireSudoToken.mockReturnValue(
      NextResponse.json({ error: 'sudo_required' }, { status: 403 }),
    )
    const res = await post(OWNER_BODY, ID)
    expect(res.status).toBe(403)
    expect(fs.existsSync(path.join(root, 'design', 'tasks', `TRDD-20260101_000000+0100-${ID}-x.md`))).toBe(true)
    expect(fs.existsSync(path.join(root, 'design', 'archived'))).toBe(true)
    expect(fs.readdirSync(path.join(root, 'design', 'archived'))).toEqual([])
  })
})
