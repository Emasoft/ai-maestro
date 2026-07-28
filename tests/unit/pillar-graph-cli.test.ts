import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

/**
 * TRDD-L55IYKL4 — greptrdd's GRAPH subcommands, pinned at the BINARY.
 *
 * These spawn the real CLI rather than importing a library, for the same reason
 * `pillar-cli-exit-codes.test.ts` does: the thing under test is what a human or an
 * agent gets when they type the command, and nothing that imports the library can
 * observe that.
 *
 * The corpus here is a FIXTURE, never the live one. A test that asserted against
 * `design/` would pass or fail on whichever cards happened to be open that day.
 */

const REPO = process.cwd()

/**
 * greptrdd colours its output, and the escapes land BETWEEN the fields an assertion
 * wants to relate — `P0` and its column are `\x1b[2mP0\x1b[0m dev`, so a plain
 * `/P0\s+dev/` fails for a reason that has nothing to do with the behaviour. Strip
 * once, here, rather than teaching every assertion to step around the escapes.
 */
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join('scripts', 'greptrdd.mjs'), ...args], {
    cwd: REPO,
    encoding: 'utf-8',
    env: { ...process.env, TRDD_DEBUG: '' },
  })
  return { status: r.status ?? -1, stdout: stripAnsi(r.stdout ?? ''), stderr: stripAnsi(r.stderr ?? '') }
}

let corpus: string

/** A minimal well-formed card. `extra` is spliced in as raw frontmatter lines. */
function card(id: string, opts: { column: string; title: string; priority?: number; extra?: string }): void {
  const fm = [
    `trdd-id: ${id}`,
    `title: ${opts.title}`,
    `column: ${opts.column}`,
    ...(opts.priority === undefined ? [] : [`priority: ${opts.priority}`]),
    ...(opts.extra ? [opts.extra] : []),
  ].join('\n')
  fs.writeFileSync(
    path.join(corpus, 'tasks', `TRDD-20260101_000000+0000-${id}-fixture.md`),
    `---\n${fm}\n---\n\n# ${opts.title}\n`,
  )
}

beforeEach(() => {
  corpus = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-graph-'))
  fs.mkdirSync(path.join(corpus, 'tasks'), { recursive: true })
})
afterEach(() => {
  fs.rmSync(corpus, { recursive: true, force: true })
})

describe('a dependency written as a bare SCALAR is a real edge (TRDD-L55IYKL4)', () => {
  /**
   * greptrdd used to carry a private `list()` that accepted ONLY arrays. So
   * `npt: TRDD-X` — one prerequisite, written the obvious way — was a reference to
   * `lib/trdd-graph.ts` (`refList` handles the scalar), a reference to the pillar
   * index (built with `refList`), and NOT a reference to the board. The card read
   * READY while the graph and the index both said it was blocked.
   *
   * The live corpus has ZERO scalar-shaped dependency fields today, which is why
   * nobody noticed and why this needs a fixture: the divergence is latent, not
   * visible, and the walk-vs-index differential would have tripped over it the
   * first time anyone wrote one.
   */
  beforeEach(() => {
    card('AAAAAAAA', { column: 'dev', title: 'prerequisite written as a bare scalar', priority: 1, extra: 'npt: TRDD-BBBBBBBB' })
    card('BBBBBBBB', { column: 'todo', title: 'the prerequisite, still open', priority: 0 })
  })

  it('POSITIVE CONTROL — a card with no prerequisites reads READY, so "not READY" below means something', () => {
    const r = runCli(['why', 'BBBBBBBB', '--design-dir', corpus])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/READY/)
    // It really read the fixture rather than an empty directory.
    expect(r.stdout).toMatch(/the prerequisite, still open/)
  })

  it('`why` reports the scalar prerequisite as the blocker — it used to report READY', () => {
    const r = runCli(['why', 'AAAAAAAA', '--design-dir', corpus])
    expect(r.status).toBe(0)
    expect(r.stdout).not.toMatch(/READY/)
    expect(r.stdout).toMatch(/ROOT CAUSE/)
    expect(r.stdout).toMatch(/BBBBBBBB/)
  })

  it('`unblocks` sees the same edge from the other end', () => {
    const r = runCli(['unblocks', 'BBBBBBBB', '--design-dir', corpus])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/directly unblocks 1/)
    expect(r.stdout).toMatch(/AAAAAAAA/)
  })

  it('`roots` puts the scalar prerequisite on the critical path', () => {
    const r = runCli(['roots', '--design-dir', corpus])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/ROOT BLOCKERS/)
    expect(r.stdout).toMatch(/BBBBBBBB/)
    expect(r.stdout).toMatch(/holds up 1/)
  })
})

describe('a reference to a card that does not exist is DROPPED, not a blocker', () => {
  /**
   * A dangling ref is a LINT finding (the doctor's `DANGLING-REF`), never a reason
   * to call work unstartable — otherwise one typo freezes a card forever and the
   * board reports a blocker nobody can ever close. The index-backed reader
   * reproduces this by JOINing edges onto records, which drops the same rows.
   */
  it('`why` on a card whose only prerequisite is a typo reads READY', () => {
    card('CCCCCCCC', { column: 'dev', title: 'blocked by a card that was never written', extra: 'blocked-by: [TRDD-ZZZZZZZZ]' })
    const r = runCli(['why', 'CCCCCCCC', '--design-dir', corpus])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/READY/)
  })
})

describe('priority is normalized to a STRING on the card, and prints unchanged', () => {
  /**
   * The card shape carries `priority` as a string-or-null so the index's TEXT column
   * round-trips to exactly what the walk produces. `P${0}` and `P${'0'}` print the
   * same, which is what makes the normalization invisible — and what this pins.
   */
  it('a numeric priority still prints as P0, and a missing one as P?', () => {
    card('DDDDDDDD', { column: 'dev', title: 'has a priority', priority: 0 })
    card('EEEEEEEE', { column: 'dev', title: 'has none' })
    const r = runCli(['board', '--design-dir', corpus])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/P0\s+dev/)
    expect(r.stdout).toMatch(/P\?\s+dev/)
  })
})
