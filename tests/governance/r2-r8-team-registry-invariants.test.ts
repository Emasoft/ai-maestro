import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * lib/team-registry.ts — R2.2 + R8.1. One guard FILE, two rules.
 *
 *   R2.2 "duplicate name check enforced server-side (API rejects with 409) AND client-side
 *         (UI shows inline error before POST)"          -> validateTeamMutation (:105-110)
 *   R8.1 "ALL write operations on teams use file locking (withLock)"  -> the 5 mutators
 *
 * TWO CLAUSES, ONE CITED SITE (R2.2). The enforcement map cites only the server half. The
 * client half is a separate site in the team-create UI, and this file deliberately pins only
 * what it can prove here — the 409. Recorded rather than silently treated as covered: a rule
 * with two clauses whose row cites one is exactly the shape that reads as fully enforced.
 *
 * R8.1 IS ALL-QUANTIFIED, so a test of one mutator pins an instance, not the rule. It needs
 * both halves, and neither alone is worth much:
 *   - MECHANISM (test 3): drive a REAL mutator and prove withLock('teams') is actually taken
 *     at runtime. A source scan can only prove the text is present.
 *   - COVERAGE (test 4): prove no write site ESCAPES the lock — which is what catches the
 *     sixth mutator someone adds next year, the drift the rule exists to prevent.
 *
 * THE ONE DOCUMENTED EXCEPTION is named explicitly rather than papered over. `loadTeams()`
 * calls `saveTeams()` for an idempotent convergent type migration, without the lock, guarded
 * by a once-per-process flag — see the `CC-003` comment at the call site: two concurrent
 * migrations produce byte-identical output, so the race is benign. Encoding it as a named
 * exception is what keeps test 4 honest; a test that ignored it would either fail forever or
 * (worse) be loosened until it stopped checking anything.
 */

const SRC = readFileSync(join(process.cwd(), 'lib/team-registry.ts'), 'utf-8')
const LINES = SRC.split('\n')

/**
 * The exported functions, as [name, startLine, endLineExclusive] over the module source.
 *
 * The end is the function's OWN closing brace — the first `}` at column 0 after the start,
 * which is exact for this prettier-formatted single-file module. Two rejected alternatives,
 * both of which produced WRONG answers when tried on this very file:
 *   - brace COUNTING: a `{` inside createTeam's multi-line parameter type desynchronised the
 *     depth, reporting the repo's most obviously-locked mutator as unlocked;
 *   - end-at-NEXT-EXPORT: it swallows the module-level block between two functions, so the
 *     comment at :209 that merely MENTIONS `saveTeams()` was attributed to the pure validator
 *     above it and reported as an unlocked write.
 */
function exportedFunctionRanges(): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = []
  LINES.forEach((line, i) => {
    const m = /^export (?:async )?function ([A-Za-z0-9_]+)/.exec(line)
    if (!m) return
    let end = LINES.length
    for (let j = i + 1; j < LINES.length; j++) {
      if (/^\}/.test(LINES[j])) { end = j + 1; break }
    }
    out.push({ name: m[1], start: i, end })
  })
  return out
}

/**
 * A function's body with COMMENTS STRIPPED. Load-bearing: this module documents its own
 * locking in prose, so matching raw text finds `withLock(` and `saveTeams(` inside comments
 * and reports them as code. A scanner that reads its subject's documentation as its subject
 * is the same self-match trap as grepping a process table from a shell whose argv holds the
 * pattern.
 */
const bodyOf = (r: { start: number; end: number }) =>
  LINES.slice(r.start, r.end)
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('R2.2 — a duplicate team name is refused server-side with 409', () => {
  it('rejects a case-insensitive duplicate, and says 409 rather than a generic 400', async () => {
    const { validateTeamMutation } = await import('@/lib/team-registry')
    const existing = [{ id: 'team-1', name: 'Platform Crew' }] as never

    const result = validateTeamMutation(
      existing,
      null, // creating, not updating — so nothing is excluded as "self"
      { name: 'platform crew', agentIds: [] },
      'agent-mgr',
      undefined,
    )

    // Narrow the discriminated union by FAILING on the wrong branch, so a future change that
    // made this accept would fail here rather than at an unhelpful property access.
    if (result.valid) throw new Error('expected the duplicate name to be REFUSED, but it was accepted')

    // The CODE is the rule's content: R2.2 names 409 specifically, and every other refusal
    // in this validator is a 400. Asserting only `valid === false` would pass on any of them.
    expect(result.code).toBe(409)
    expect(result.error).toMatch(/already exists/i)
  })

  it('VACUITY CONTROL — a non-duplicate name is accepted, so the 409 is the duplicate check and not a constant', async () => {
    const { validateTeamMutation } = await import('@/lib/team-registry')
    const existing = [{ id: 'team-1', name: 'Platform Crew' }] as never

    const result = validateTeamMutation(
      existing,
      null,
      { name: 'Runtime Crew', agentIds: [] },
      'agent-mgr',
      undefined,
    )

    expect(result.valid, result.valid ? undefined : result.error).toBe(true)
  })
})

describe('R8.1 — every team write is serialised by the file lock', () => {
  it('MECHANISM — a real mutator takes withLock("teams") at runtime, not merely in the source', async () => {
    vi.resetModules()
    const seen: string[] = []
    // Pass-through recorder: the mutator's body still runs, so this observes the REAL call
    // rather than replacing the behaviour with a stub that would prove nothing.
    vi.doMock('@/lib/file-lock', () => ({
      withLock: vi.fn(async (name: string, fn: () => unknown) => {
        seen.push(name)
        return fn()
      }),
      acquireLock: vi.fn(),
    }))

    const { blockAllTeams } = await import('@/lib/team-registry')
    // blockAllTeams is the cheapest real mutator to drive: no arguments, and with no teams
    // on disk it is a no-op that STILL must take the lock before deciding there is nothing
    // to do — deciding that is itself a read-modify-write.
    await blockAllTeams()

    expect(seen, 'the mutator must acquire the teams lock').toContain('teams')
    vi.doUnmock('@/lib/file-lock')
  })

  it('COVERAGE — no write site escapes the lock, except the ONE documented migration', async () => {
    const ranges = exportedFunctionRanges()

    // Positive control: a broken scan (wrong regex, wrong path, empty read) would find no
    // functions and vacuously report "all locked". Pin the shape it must have found.
    expect(ranges.length, 'the source scan found no exported functions — the scan is broken').toBeGreaterThan(5)
    expect(ranges.map(r => r.name)).toEqual(
      expect.arrayContaining(['createTeam', 'updateTeam', 'deleteTeam', 'blockAllTeams', 'unblockAllTeams']),
    )

    // `loadTeams` performs the CC-003 idempotent migration write without the lock, on purpose.
    // Named here so the exception is a DECISION in the test, not a hole in it.
    const DOCUMENTED_UNLOCKED_WRITERS = new Set(['loadTeams'])

    const writers = ranges.filter(r => /\bsaveTeams\(/.test(bodyOf(r)) && r.name !== 'saveTeams')
    expect(writers.length, 'no write sites found — the scan is broken').toBeGreaterThan(0)

    const unlocked = writers
      .filter(r => !DOCUMENTED_UNLOCKED_WRITERS.has(r.name))
      .filter(r => !/\bwithLock\(/.test(bodyOf(r)))
      .map(r => `${r.name} (line ${r.start + 1})`)

    expect(
      unlocked,
      'these functions write teams without withLock — R8.1 requires the lock, or an explicit ' +
        'documented exception like loadTeams\' CC-003 idempotent migration',
    ).toEqual([])

    // And the exception must still BE the exception: if loadTeams ever stops writing, this
    // allowance is dead weight and should be removed rather than left as a standing hole.
    const loadTeams = ranges.find(r => r.name === 'loadTeams')!
    expect(
      /\bsaveTeams\(/.test(bodyOf(loadTeams)),
      'loadTeams no longer writes — drop it from DOCUMENTED_UNLOCKED_WRITERS',
    ).toBe(true)
  })
})
