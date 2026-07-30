import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

/**
 * TRDD-7JK3NCV4 — the pillar CLIs answer with THREE exit codes, not two.
 *
 *   0  clean      · scanned a real corpus, found nothing wrong
 *   1  findings   · scanned a real corpus, found something
 *   2  could-not-run
 *
 * The third one is the whole point. `trddgrep validate` calls itself the WRITE
 * GATE in its own help; run from the wrong directory it used to print zero rows
 * and exit 0, so "I found nothing wrong" and "I looked at nothing" were the same
 * answer. The library-level guards are pinned in `trdd-store.test.ts`; these
 * spawn the actual CLI, because the exit code is a contract of the BINARY and
 * nothing that imports the library can observe it.
 */

const REPO = process.cwd()

/**
 * CONTAINMENT (TRDD-YN8EQWYP box 4). `statePath()` is `join(homedir(), '.aimaestro')`, and
 * `board` below is an INDEX-BACKED subcommand — so without a redirected HOME the spawned CLI
 * writes a real SQLite index for each throwaway tmp corpus into the DEVELOPER'S OWN
 * `~/.aimaestro/pillar-index/`. Measured before this was added: +1 file per suite run, 43
 * accumulated. `vi.mock` cannot contain it — the writer is a SUBPROCESS, which never sees the
 * parent's module mocks — so the only lever is the spawn env. `os.homedir()` honours $HOME on
 * POSIX, which is what makes this work.
 */
let fakeHome: string

function runCli(script: string, args: string[]): { status: number; stderr: string; stdout: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join('scripts', script), ...args], {
    cwd: REPO,
    encoding: 'utf-8',
    // Inherit the environment so tsx resolves, but never let a stray TRDD_DEBUG
    // from the developer's shell change what these assertions see — and never let the
    // spawned CLI resolve state into the real home (see CONTAINMENT above).
    env: { ...process.env, TRDD_DEBUG: '', HOME: fakeHome },
  })
  return { status: r.status ?? -1, stderr: r.stderr ?? '', stdout: r.stdout ?? '' }
}

let emptyDir: string

/**
 * A corpus that is WARNINGS-ONLY by construction: one well-formed card missing `created-by:`,
 * which is META-MISSING (warn) and nothing else. It is the substrate for the two `exit 0`
 * positive controls below.
 *
 * Those controls used to run against the LIVE `design/` corpus, which coupled a claim about the
 * TOOL ("0 means clean-enough; warnings alone do not fail") to a transient property of our DATA.
 * The moment a new rule legitimately found an ERROR in our own cards (BODY-STATE-CLAIM, 2 cards
 * blocked by IND §12), both controls went red — reporting a corpus problem as a CLI regression.
 * A fixture states the tool's contract and cannot rot when the corpus does. The live corpus is
 * still gated, in the place that owns that question: `trdd-doctor.test.ts`'s "THE GATE".
 */
let warnOnlyDir: string

function seedWarnOnlyCorpus(root: string) {
  for (const zone of ['proposals', 'tasks', 'archived', 'refused']) {
    fs.mkdirSync(path.join(root, zone), { recursive: true })
  }
  const fm = [
    '---',
    'trdd-id: WARNONLY',
    'title: A card whose only defect is a missing created-by',
    'column: dev',
    'created: 2026-01-01T00:00:00+0100',
    'updated: 2026-01-01T00:00:00+0100',
    'assignee: someone',
    'min-approval-requirement: none',
    'npt: []',
    'eht: []',
    'blocked-by: []',
    '---',
    '',
    '# TRDD-WARNONLY — A card whose only defect is a missing created-by',
    '',
    'body',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(root, 'tasks', 'TRDD-20260101_000000+0100-WARNONLY-x.md'), fm, 'utf8')
}

beforeEach(() => {
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-cli-'))
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-cli-home-'))
  warnOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-cli-warn-'))
  seedWarnOnlyCorpus(warnOnlyDir)
})
afterEach(() => {
  fs.rmSync(emptyDir, { recursive: true, force: true })
  fs.rmSync(fakeHome, { recursive: true, force: true })
  fs.rmSync(warnOnlyDir, { recursive: true, force: true })
})

describe('trddgrep exit codes', () => {
  it('exits 0 on a warnings-only corpus — the positive control, without which every 2 below is vacuous', () => {
    const r = runCli('trddgrep.mjs', ['validate', '--design-dir', warnOnlyDir])
    expect(r.status).toBe(0)
    // It really did read something, and read the ONE card we seeded — a bare `status === 0`
    // is exactly the shape this file exists to distrust.
    expect(r.stdout.split('\n').filter((l) => l.startsWith('WARN')).length).toBeGreaterThan(0)
    expect(r.stdout).toContain('WARNONLY')
  })

  it('exits 1 under --strict, because warnings ARE findings to a gate that asked for them', () => {
    expect(runCli('trddgrep.mjs', ['validate', '--strict', '--design-dir', warnOnlyDir]).status).toBe(1)
  })

  it('exits 2 when the corpus root does not exist — NOT 0, which is what it used to do', () => {
    const r = runCli('trddgrep.mjs', ['validate', '--design-dir', path.join(emptyDir, 'nope')])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/no TRDD corpus at/)
  })

  it('exits 2 when the corpus exists but holds no TRDDs — an unread corpus is not a clean one', () => {
    const r = runCli('trddgrep.mjs', ['validate', '--design-dir', emptyDir])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/refusing to certify a corpus it never read/)
  })

  it('accepts --design-dir anywhere on the line without eating the subcommand', () => {
    // The flag is stripped before `cmd`/`arg` are read. If it were not, `validate`
    // would land in the wrong argv slot and the tool would silently run `board`.
    const r = runCli('trddgrep.mjs', ['--design-dir', emptyDir, 'validate'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/refusing to certify/)
  })
})

describe('trddgrep loads the corpus LAZILY (TRDD-L55IYKL4 / EHT 8KDIB2LT step 1)', () => {
  /**
   * A corpus whose `tasks` zone is a FILE, so `readdirSync` raises ENOTDIR.
   *
   * ENOTDIR rather than chmod on purpose: a permissions fixture passes VACUOUSLY
   * when the suite runs as root, and CI often does. This fault is structural, so
   * it is raised for every user alike — and it is a fault the fail-loud reader
   * MUST propagate (only ENOENT is the legal "this zone does not exist yet").
   */
  function unreadableCorpus(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-lazy-'))
    fs.writeFileSync(path.join(root, 'tasks'), 'not a directory')
    return root
  }

  let corpus: string
  beforeEach(() => {
    corpus = unreadableCorpus()
  })
  afterEach(() => {
    fs.rmSync(corpus, { recursive: true, force: true })
  })

  // The POSITIVE CONTROL, and it is the load-bearing half of this pair: it proves
  // the fixture really is unreadable and really does reach the walk. Without it,
  // `help` exiting 0 below would be satisfied by a fixture nothing ever read.
  it('a graph subcommand DOES read the corpus, and fails loud when it cannot', () => {
    const r = runCli('trddgrep.mjs', ['board', '--design-dir', corpus])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/cannot read TRDD zone/)
  })

  it('`help` does NOT read the corpus — it walked all four zones to print a usage string', () => {
    const r = runCli('trddgrep.mjs', ['help', '--design-dir', corpus])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/the transitive blocker chain/)
  })

  it('`validate` reaches its own reader, not the CLI-level walk', () => {
    // It still exits 2 — but on the DOCTOR's non-vacuity guard, not on the walk
    // this change removed. Distinguishing the two is the point: an assertion on
    // the status alone would pass either way and pin nothing.
    const r = runCli('trddgrep.mjs', ['validate', '--design-dir', corpus])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/cannot read TRDD zone/)
  })

  // NOT PINNED HERE, and deliberately: that the walk RETAINS no body. Its
  // granularity is a heap measurement over a corpus far larger than a unit test
  // should build, so an assertion at this scale would be decorative. It is
  // measured instead — at 10^5 x 10 KB, `board` peak RSS 2.41 GB -> 1.52 GB and
  // search 2.41 GB -> 0.47 GB — and the numbers plus their reproduction live in
  // TRDD-8KDIB2LT.
})

describe('0-IMPACT — the spawned CLI never writes the real state dir (TRDD-YN8EQWYP)', () => {
  // This suite SPAWNS the production CLI, and `board` builds a real SQLite index at
  // `statePath('pillar-index')`. The containment therefore cannot be asserted by reading
  // the spawn options — the only honest check is to COUNT the developer's real directory
  // either side of a run that provably does index. Measured before the HOME redirect
  // existed: +1 file per suite run, 43 accumulated in ~/.aimaestro/pillar-index/.
  const realIndexDir = path.join(os.homedir(), '.aimaestro', 'pillar-index')
  const countReal = (): number => {
    try {
      return fs.readdirSync(realIndexDir).length
    } catch {
      // Absent is the cleanest possible answer, and legal on a fresh machine.
      return 0
    }
  }

  let corpus: string
  beforeEach(() => {
    corpus = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-0impact-'))
    const zone = path.join(corpus, 'design', 'tasks')
    fs.mkdirSync(zone, { recursive: true })
    fs.writeFileSync(
      path.join(zone, 'TRDD-20260730_000000+0200-ZZ0IMPCT-containment-probe.md'),
      [
        '---',
        'trdd-id: ZZ0IMPCT',
        'title: containment probe',
        'column: dev',
        'created: 2026-07-30T00:00:00+0200',
        'updated: 2026-07-30T00:00:00+0200',
        'blocked-by: []',
        '---',
        '',
        '# containment probe',
        '',
      ].join('\n'),
    )
  })
  afterEach(() => {
    fs.rmSync(corpus, { recursive: true, force: true })
  })

  it('leaves the real ~/.aimaestro/pillar-index/ byte-count unchanged, while PROVING it indexed', () => {
    const before = countReal()
    const r = runCli('trddgrep.mjs', ['board', '--design-dir', path.join(corpus, 'design')])
    const after = countReal()

    // The POSITIVE CONTROL, and it is load-bearing: without it this test passes when the
    // command never indexed anything at all — which is the same shape as a gate that
    // passes because it read nothing.
    expect(r.status, `board failed, so nothing was indexed and the count below is meaningless: ${r.stderr}`).toBe(0)
    const fakeIndexDir = path.join(fakeHome, '.aimaestro', 'pillar-index')
    expect(
      fs.existsSync(fakeIndexDir) && fs.readdirSync(fakeIndexDir).length > 0,
      'the CLI wrote no index into the fake home — so this test cannot distinguish containment from inaction',
    ).toBe(true)

    expect(after, 'the spawned CLI wrote into the real state dir').toBe(before)
  })
})

describe('trdd-doctor exit codes', () => {
  it('exits 0 on a warnings-only corpus (positive control — warnings alone do not fail the doctor)', () => {
    const r = runCli('trdd-doctor.mjs', ['--design-dir', warnOnlyDir])
    expect(r.status).toBe(0)
    // Non-vacuity: it scanned the seeded card, rather than exiting 0 having read nothing.
    expect(r.stdout).toContain('WARNONLY')
  })

  it('exits 2 when the corpus root does not exist', () => {
    const r = runCli('trdd-doctor.mjs', ['--design-dir', path.join(emptyDir, 'nope')])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/no TRDD corpus at/)
  })

  it('exits 2 when the corpus is empty rather than reporting it clean', () => {
    const r = runCli('trdd-doctor.mjs', ['--design-dir', emptyDir])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/refusing to call a corpus clean that it never read/)
  })
})
