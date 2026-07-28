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
 * The third one is the whole point. `greptrdd validate` calls itself the WRITE
 * GATE in its own help; run from the wrong directory it used to print zero rows
 * and exit 0, so "I found nothing wrong" and "I looked at nothing" were the same
 * answer. The library-level guards are pinned in `trdd-store.test.ts`; these
 * spawn the actual CLI, because the exit code is a contract of the BINARY and
 * nothing that imports the library can observe it.
 */

const REPO = process.cwd()

function runCli(script: string, args: string[]): { status: number; stderr: string; stdout: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join('scripts', script), ...args], {
    cwd: REPO,
    encoding: 'utf-8',
    // Inherit the environment so tsx resolves, but never let a stray TRDD_DEBUG
    // from the developer's shell change what these assertions see.
    env: { ...process.env, TRDD_DEBUG: '' },
  })
  return { status: r.status ?? -1, stderr: r.stderr ?? '', stdout: r.stdout ?? '' }
}

let emptyDir: string

beforeEach(() => {
  emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-cli-'))
})
afterEach(() => {
  fs.rmSync(emptyDir, { recursive: true, force: true })
})

describe('greptrdd exit codes', () => {
  it('exits 0 on the live corpus — the positive control, without which every 2 below is vacuous', () => {
    const r = runCli('greptrdd.mjs', ['validate'])
    expect(r.status).toBe(0)
    // It really did read something: the corpus emits warnings today.
    expect(r.stdout.split('\n').filter((l) => l.startsWith('WARN')).length).toBeGreaterThan(0)
  })

  it('exits 1 under --strict, because warnings ARE findings to a gate that asked for them', () => {
    expect(runCli('greptrdd.mjs', ['validate', '--strict']).status).toBe(1)
  })

  it('exits 2 when the corpus root does not exist — NOT 0, which is what it used to do', () => {
    const r = runCli('greptrdd.mjs', ['validate', '--design-dir', path.join(emptyDir, 'nope')])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/no TRDD corpus at/)
  })

  it('exits 2 when the corpus exists but holds no TRDDs — an unread corpus is not a clean one', () => {
    const r = runCli('greptrdd.mjs', ['validate', '--design-dir', emptyDir])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/refusing to certify a corpus it never read/)
  })

  it('accepts --design-dir anywhere on the line without eating the subcommand', () => {
    // The flag is stripped before `cmd`/`arg` are read. If it were not, `validate`
    // would land in the wrong argv slot and the tool would silently run `board`.
    const r = runCli('greptrdd.mjs', ['--design-dir', emptyDir, 'validate'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/refusing to certify/)
  })
})

describe('greptrdd loads the corpus LAZILY (TRDD-L55IYKL4 / EHT 8KDIB2LT step 1)', () => {
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
    const r = runCli('greptrdd.mjs', ['board', '--design-dir', corpus])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/cannot read TRDD zone/)
  })

  it('`help` does NOT read the corpus — it walked all four zones to print a usage string', () => {
    const r = runCli('greptrdd.mjs', ['help', '--design-dir', corpus])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/the transitive blocker chain/)
  })

  it('`validate` reaches its own reader, not the CLI-level walk', () => {
    // It still exits 2 — but on the DOCTOR's non-vacuity guard, not on the walk
    // this change removed. Distinguishing the two is the point: an assertion on
    // the status alone would pass either way and pin nothing.
    const r = runCli('greptrdd.mjs', ['validate', '--design-dir', corpus])
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

describe('trdd-doctor exit codes', () => {
  it('exits 0 on the live corpus (positive control — warnings alone do not fail the doctor)', () => {
    expect(runCli('trdd-doctor.mjs', []).status).toBe(0)
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
