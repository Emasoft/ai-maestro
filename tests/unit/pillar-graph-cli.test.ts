import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
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

let corpus: string
/**
 * A THROWAWAY $HOME for every spawn in this file — 0-IMPACT, and it was learned the
 * hard way: the first version redirected HOME only for the differential runs, so the
 * other describes indexed their fixtures into the DEVELOPER'S REAL `~/.aimaestro/`
 * and left 20 orphan `.sqlite` files behind. `getStateDir()` resolves through
 * `os.homedir()`, which honours $HOME on POSIX, so one env var keeps the whole file
 * off the real home without the production code needing a test-only escape hatch.
 */
let home: string

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join('scripts', 'greptrdd.mjs'), ...args], {
    cwd: REPO,
    encoding: 'utf-8',
    env: { ...process.env, TRDD_DEBUG: '', HOME: home },
  })
  return { status: r.status ?? -1, stdout: stripAnsi(r.stdout ?? ''), stderr: stripAnsi(r.stderr ?? '') }
}

/** A minimal well-formed card. `extra` is spliced in as raw frontmatter lines. */
function card(
  id: string,
  opts: { column: string; title: string; priority?: number; extra?: string; zone?: string },
): void {
  const zone = opts.zone ?? 'tasks'
  const fm = [
    `trdd-id: ${id}`,
    `title: ${opts.title}`,
    `column: ${opts.column}`,
    ...(opts.priority === undefined ? [] : [`priority: ${opts.priority}`]),
    ...(opts.extra ? [opts.extra] : []),
  ].join('\n')
  fs.mkdirSync(path.join(corpus, zone), { recursive: true })
  fs.writeFileSync(
    path.join(corpus, zone, `TRDD-20260101_000000+0000-${id}-fixture.md`),
    `---\n${fm}\n---\n\n# ${opts.title}\n`,
  )
}

beforeEach(() => {
  corpus = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-graph-'))
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-home-'))
  fs.mkdirSync(path.join(corpus, 'tasks'), { recursive: true })
})
afterEach(() => {
  fs.rmSync(corpus, { recursive: true, force: true })
  fs.rmSync(home, { recursive: true, force: true })
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

describe('the INDEX answers the graph exactly as the WALK does (TRDD-L55IYKL4)', () => {
  /**
   * THE ACCEPTANCE CRITERION for index-backing `why` / `unblocks` / `roots` / `board`.
   *
   * The scope is deliberate and is a contract, not a gap: the default regex SEARCH
   * is NOT index-backed and never will be. fts5 is token matching with bm25 — it
   * cannot evaluate a regex, and its unicode61 tokenizer splits `TRDD-BQC8NQSW` into
   * whole tokens, so even a literal prefilter would miss substrings. "Serve the
   * search from the index, byte-identically" contradicts itself.
   *
   * THE FIXTURE IS BUILT TO DISCRIMINATE ZONE ORDER, which is the subtle way this
   * could be wrong while looking right. The walk visits `TRDD_ZONES` in DECLARATION
   * order — proposals, tasks, archived, refused — which is NOT alphabetical, so an
   * index query that ordered by path alone would emit archived before proposals and
   * quietly reshuffle every downstream tie-break. `ARCHCCCC` sits in `archived/` with
   * a NON-terminal column (`cancelled` is not in TERMINAL_DONE), so it survives the
   * done-filter and shares a blocker with a card in `proposals/` — the one shape
   * where the two orderings disagree.
   */
  /**
   * Run the same subcommand twice — walk, then index — and REFUSE to return two
   * walks.
   *
   * The guard lives HERE, not in a sibling test, because a neuter run proved the
   * alternative worthless: breaking the index query made greptrdd fall back (loudly,
   * as designed), both runs became walks, and five of six `expect(indexed).toBe(walk)`
   * assertions went GREEN comparing a walk to itself. A separate positive-control
   * test noticed; anyone running `-t "byte-identical"` would not have. A shared
   * control does not protect the assertions that do not execute it, so every
   * differential has to carry its own.
   */
  function runBoth(args: string[]): { walk: string; indexed: string; stderr: string } {
    // HOME is redirected so the index lands in a temp state dir. `getStateDir()`
    // resolves through `os.homedir()`, which honours $HOME on POSIX — so this keeps
    // the developer's real ~/.aimaestro untouched by a test, without the production
    // code needing a test-only escape hatch.
    const env = { ...process.env, TRDD_DEBUG: '', HOME: home }
    const run = (extra: string[]) =>
      spawnSync(
        process.execPath,
        ['--import', 'tsx', path.join('scripts', 'greptrdd.mjs'), ...args, '--design-dir', corpus, ...extra],
        { cwd: REPO, encoding: 'utf-8', env },
      )
    const w = run(['--no-index'])
    const i = run([])
    const stderr = stripAnsi(i.stderr ?? '')
    expect(stderr, 'the indexed run fell back to the walk — this comparison would be vacuous').not.toMatch(
      /falling back to the corpus walk/,
    )
    return {
      walk: stripAnsi(w.stdout ?? ''),
      indexed: stripAnsi(i.stdout ?? ''),
      stderr,
    }
  }

  beforeEach(() => {
    card('ROOTAAAA', { column: 'todo', title: 'the shared prerequisite', priority: 0 })
    card('TASKDDDD', { column: 'dev', title: 'an open task', priority: 1, extra: 'npt: TRDD-ROOTAAAA' })
    card('TASKEEEE', { column: 'dev', title: 'an open task with no blockers', priority: 2 })
    card('PROPBBBB', {
      zone: 'proposals',
      column: 'proposal',
      title: 'a pending proposal',
      priority: 1,
      extra: 'blocked-by: [TRDD-ROOTAAAA]',
    })
    card('ARCHCCCC', {
      zone: 'archived',
      column: 'cancelled',
      title: 'cancelled, therefore NOT terminal-done',
      priority: 3,
      extra: 'blocked-by: [TRDD-ROOTAAAA]',
    })
  })

  it('POSITIVE CONTROL — the indexed run really used the index, so the diffs below are not two walks', () => {
    const r = runBoth(['board'])
    // If the native module failed to load, greptrdd falls back LOUDLY. Both runs
    // would then be walks and every byte-identical assertion below would hold
    // while proving nothing whatsoever about the index.
    expect(r.stderr).not.toMatch(/falling back to the corpus walk/)
    const dbs = fs
      .readdirSync(path.join(home, '.aimaestro', 'pillar-index'))
      .filter((f) => f.endsWith('.sqlite'))
    expect(dbs.length).toBe(1)
    // …and it wrote the corpus into it, rather than creating an empty file.
    expect(fs.statSync(path.join(home, '.aimaestro', 'pillar-index', dbs[0])).size).toBeGreaterThan(0)
  })

  it('`board` is byte-identical', () => {
    const r = runBoth(['board'])
    expect(r.indexed).toBe(r.walk)
    expect(r.walk).toMatch(/3 open cards/)
  })

  it('`roots` is byte-identical', () => {
    const r = runBoth(['roots'])
    expect(r.indexed).toBe(r.walk)
    expect(r.walk).toMatch(/ROOTAAAA/)
  })

  it('`why` is byte-identical, through a SCALAR npt edge', () => {
    const r = runBoth(['why', 'TASKDDDD'])
    expect(r.indexed).toBe(r.walk)
    expect(r.walk).toMatch(/ROOT CAUSE/)
  })

  it('`unblocks` is byte-identical AND keeps zone-declaration order, not path order', () => {
    const r = runBoth(['unblocks', 'ROOTAAAA'])
    expect(r.indexed).toBe(r.walk)
    // The discriminating assertion: `proposals` is declared BEFORE `archived`, while
    // path order would sort `archived/` first. Both must agree, and both must be
    // wrong the same way or right the same way — here, right.
    expect(r.walk.indexOf('PROPBBBB')).toBeGreaterThan(-1)
    expect(r.walk.indexOf('ARCHCCCC')).toBeGreaterThan(r.walk.indexOf('PROPBBBB'))
  })

  it('`show` is byte-identical — its STATE block is still read from the FILE', () => {
    const r = runBoth(['show', 'ROOTAAAA'])
    expect(r.indexed).toBe(r.walk)
  })

  /**
   * The gap every OTHER differential test here leaves open.
   *
   * They all build the index COLD, so insertion order and walk order coincide by
   * construction and the comparison can never see a reindex. But `blockerRefs` order
   * comes from `ORDER BY rowid`, and re-indexing a changed file evicts its edges and
   * re-inserts them at FRESH rowids at the end of the table. `index-open.ts:78-82`
   * argues that only the order BETWEEN files drifts and no query reads that — which
   * was REASONED, never executed. This executes it.
   */
  it('an incremental REINDEX changes neither the answer nor its ORDER, despite fresh rowids', () => {
    // A card with TWO prerequisites — the shared fixture has none, and a single edge
    // cannot reveal an ordering bug no matter how the rows are sorted. `why` is the
    // subcommand that PRINTS that chain, so it is what the comparison must read;
    // `board` never shows blocker order and would pass while the order rotted.
    card('MULTIBLK', {
      column: 'dev',
      title: 'two prerequisites, in a declared order',
      priority: 1,
      extra: 'npt: [TRDD-ROOTAAAA, TRDD-TASKEEEE]',
    })

    const before = runCli(['why', 'MULTIBLK', '--design-dir', corpus])
    expect(before.status).toBe(0)
    expect(before.stderr).not.toMatch(/falling back to the corpus walk/)
    // Both prerequisites really are in the output, in declaration order — otherwise
    // the byte-comparison below would be comparing two copies of a chain of one.
    expect(before.stdout).toMatch(/ROOTAAAA/)
    expect(before.stdout.indexOf('TASKEEEE')).toBeGreaterThan(before.stdout.indexOf('ROOTAAAA'))

    const indexDir = path.join(home, '.aimaestro', 'pillar-index')
    const dbFile = path.join(indexDir, fs.readdirSync(indexDir).find((f) => f.endsWith('.sqlite'))!)
    const identityOf = (p: string): string => {
      const db = new Database(dbFile, { readonly: true })
      try {
        return (db.prepare(`SELECT identity FROM files WHERE path = ?`).get(p) as { identity: string }).identity
      } finally {
        db.close()
      }
    }

    // Re-index the MULTI-blocker card itself — the one whose two edges are what a
    // rowid reshuffle would reorder.
    const target = path.join(corpus, 'tasks', 'TRDD-20260101_000000+0000-MULTIBLK-fixture.md')
    const identityBefore = identityOf(target)

    // Change the BODY only: the file's identity moves (so it is genuinely re-read and
    // its edges re-inserted at new rowids) while every field `why` prints is untouched.
    fs.appendFileSync(target, '\na body line the graph never prints\n')

    const after = runCli(['why', 'MULTIBLK', '--design-dir', corpus])
    expect(after.status).toBe(0)
    expect(after.stderr).not.toMatch(/falling back to the corpus walk/)

    // NON-VACUITY. Without this, a change that failed to trigger a reindex would make
    // the assertion below pass for the most trivial reason available — nothing moved,
    // so of course the output matched. This is the same trap that made the FIRST
    // version of the differential above compare a walk to a walk.
    expect(identityOf(target), 'the file was NOT re-indexed, so this test proves nothing').not.toBe(identityBefore)

    expect(after.stdout).toBe(before.stdout)
  })

  it('the CLI still WORKS when the index cannot be loaded at all', () => {
    // The `--no-index` path IS the fallback path, exercised end-to-end: if the lazy
    // import were not guarded, a wrong Node or a missing native build would make
    // greptrdd die rather than degrade — a query tool killed by its own cache.
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', path.join('scripts', 'greptrdd.mjs'), 'board', '--design-dir', corpus, '--no-index'],
      { cwd: REPO, encoding: 'utf-8', env: { ...process.env, TRDD_DEBUG: '', HOME: home } },
    )
    expect(r.status).toBe(0)
    expect(stripAnsi(r.stdout ?? '')).toMatch(/3 open cards/)
  })
})
