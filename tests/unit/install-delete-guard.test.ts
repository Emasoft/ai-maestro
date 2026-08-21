/**
 * TRDD-9K33PHOZ — `install.sh`'s refusal to delete a checkout that holds work no remote has.
 *
 * WHY THIS EXISTS. install.sh gated its auto-delete on two checks: the target is under $HOME, and
 * its package.json says "ai-maestro". Both PASS for a live development checkout, because they were
 * written to avoid deleting an UNRELATED directory and cannot tell a stale install from the tree
 * someone is working in. Nothing in that path asked git anything, so `install.sh -y` run from
 * outside a checkout would recursively delete $HOME/ai-maestro and reclone — taking with it any
 * commit that exists on no remote. On the day this was found that was 388 commits.
 *
 * The guard is therefore the whole safety property, and a guard with no test is a comment. Each
 * case below is paired with the neuter that reds it, measured 2026-08-21:
 *
 *   • delete the `status --porcelain` branch       → REDS 2 (uncommitted, untracked)
 *   • delete the `rev-list --not --remotes` branch → REDS 1 (unpushed)
 *   • delete the `.env.local` branch               → REDS 1 (credentials)
 *   • `exit 1` at the top (refuse everything)      → REDS 6 (both PERMIT cases and all 4 refusals,
 *     the latter because a bare exit prints none of the messages they assert)
 *
 * The two PERMIT cases are not filler: a guard that refuses everything would satisfy a naive
 * "did it refuse?" assertion while breaking every legitimate reinstall — the failure mode that
 * gets a safety check deleted by the next person who hits it.
 *
 * ⚠ A FIFTH NEUTER, `return 1` at the top, REDS ONLY THE 4 REFUSALS AND LEAVES BOTH PERMITS GREEN
 * — recorded because it is the one someone will reach for first, and it measures the wrong thing.
 * The guard refuses with `exit`, not `return`, so under `return 1` the harness falls through to
 * `echo PERMITTED` and every case reports success. That is an artifact of the harness, not a
 * property of the guard, and reading it as "the PERMIT cases are unpinned" would be exactly
 * backwards. Use `exit 1` to test that axis.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const INSTALL_SH = path.resolve(__dirname, '../../install.sh')

/**
 * The function under test, sliced out of install.sh rather than duplicated here — a copy would
 * pass forever after the original changed, which is precisely the drift this suite exists to
 * catch. Sliced at its own closing brace at column 0.
 */
function extractGuard(): string {
  const src = fs.readFileSync(INSTALL_SH, 'utf8')
  const start = src.indexOf('assert_safe_to_delete() {')
  if (start === -1) return ''
  const end = src.indexOf('\n}\n', start)
  if (end === -1) return ''
  return src.slice(start, end + 3)
}

function runGuard(dir: string): { code: number; out: string } {
  const harness = [
    'set -u',
    'print_error() { echo "REFUSED: $*"; }',
    extractGuard(),
    `assert_safe_to_delete ${JSON.stringify(dir)}`,
    'echo PERMITTED',
  ].join('\n')
  const r = spawnSync('bash', ['-c', harness], { encoding: 'utf8', timeout: 60_000 })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })

let tmp = ''
/** A bare repo standing in for "a remote", so `--not --remotes` has something to be true about. */
let remote = ''

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-delguard-'))
  remote = path.join(tmp, 'remote.git')
  git(tmp, 'init', '--bare', '-q', remote)
})

afterEach(() => {
  // Contained by construction: every fixture lives under one mkdtemp root, never the real repo.
  if (tmp && tmp.startsWith(os.tmpdir())) fs.rmSync(tmp, { recursive: true, force: true })
})

/** A clone with one commit, pushed — i.e. exactly the "stale install" the installer may replace. */
function cleanClone(): string {
  const work = path.join(tmp, 'work')
  fs.mkdirSync(work)
  git(work, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(work, 'package.json'), '{"name":"ai-maestro"}\n')
  git(work, 'add', 'package.json')
  git(work, 'commit', '-qm', 'initial')
  git(work, 'remote', 'add', 'origin', remote)
  git(work, 'push', '-q', 'origin', 'main')
  return work
}

describe('install.sh assert_safe_to_delete', () => {
  it('the guard was actually extracted — without this every case below is vacuous', () => {
    const g = extractGuard()
    expect(g).toContain('assert_safe_to_delete() {')
    expect(g).toContain('--not --remotes')
    expect(g).toContain('.env.local')
  })

  it('PERMITS a non-git directory — git has nothing to lose there', () => {
    const plain = path.join(tmp, 'plain')
    fs.mkdirSync(plain)
    const r = runGuard(plain)
    expect(r.out).toContain('PERMITTED')
    expect(r.code).toBe(0)
  })

  it('PERMITS a clean, fully-pushed clone — the ordinary reinstall must still work', () => {
    const r = runGuard(cleanClone())
    expect(r.out).toContain('PERMITTED')
    expect(r.code).toBe(0)
  })

  it('REFUSES when the tree has uncommitted changes', () => {
    const work = cleanClone()
    fs.writeFileSync(path.join(work, 'package.json'), '{"name":"ai-maestro","dirty":true}\n')
    const r = runGuard(work)
    expect(r.out).toMatch(/uncommitted or untracked/i)
    expect(r.out).not.toContain('PERMITTED')
    expect(r.code).toBe(1)
  })

  it('REFUSES when the tree has untracked files', () => {
    const work = cleanClone()
    fs.writeFileSync(path.join(work, 'scratch.txt'), 'not committed\n')
    const r = runGuard(work)
    expect(r.out).toMatch(/uncommitted or untracked/i)
    expect(r.code).toBe(1)
  })

  it('REFUSES when commits exist on no remote — the case `git status` is silent about', () => {
    const work = cleanClone()
    fs.writeFileSync(path.join(work, 'later.txt'), 'work nobody else has\n')
    git(work, 'add', 'later.txt')
    git(work, 'commit', '-qm', 'unpushed work')
    const r = runGuard(work)
    // The count is part of the contract: "1 commit(s) exist on no remote" is what tells the
    // operator how much they are about to lose, and a guard that refused without it would be
    // indistinguishable from a guard that refuses everything.
    expect(r.out).toMatch(/1 commit\(s\) exist on no remote/i)
    expect(r.out).not.toContain('PERMITTED')
    expect(r.code).toBe(1)
  })

  it('REFUSES when .env.local is present — gitignored, so both checks above are blind to it', () => {
    const work = cleanClone()
    // Deliberately ignored, which is the whole point: this file holds the governance password and
    // the dev-mode token, and neither `status --porcelain` nor `rev-list` can see it.
    fs.writeFileSync(path.join(work, '.gitignore'), '.env.local\n')
    git(work, 'add', '.gitignore')
    git(work, 'commit', '-qm', 'ignore env')
    git(work, 'push', '-q', 'origin', 'main')
    fs.writeFileSync(path.join(work, '.env.local'), 'AIM_GOVERNANCE_PASSWORD=placeholder\n')
    const r = runGuard(work)
    expect(r.out).toMatch(/credentials/i)
    expect(r.out).not.toContain('PERMITTED')
    expect(r.code).toBe(1)
  })
})
