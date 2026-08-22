/**
 * TRDD-0N792LL5 — the updater's fail-closed guard.
 *
 * DRIVEN IN A REAL FIXTURE REPO, in a subprocess. The guard's whole job is to answer questions
 * about git state (which remote, how far ahead, is that ref real), so a mock of git would be a
 * mock of the only thing under test. Every case below builds an actual repo under `mkdtemp` with
 * an actual remote, and the guard runs against it exactly as `update-aimaestro.sh` runs it.
 *
 * CONTAINMENT: every path is inside the temp dir, and `git` is invoked with `cwd` pinned there.
 * Nothing here can reach the developer's own checkout — which matters more than usual, because
 * this suite deliberately creates repos with unpushed commits.
 *
 * NEUTER RUNS (2026-08-22 — OBSERVED via scripts/dev/neuter, restores blob-verified). Three,
 * because the guard refuses for three independent reasons and one mutation certifies only the
 * branch it hits. Each reddens EXACTLY ONE, and each a different one — which is the property
 * worth having: no test here is propped up by a neighbour's guard.
 *
 *   s|if \[ "$ahead" != "0" \]; then|if false; then|                          → 1 red / 8 green
 *       REFUSES when local commits are missing from the remote, and NAMES the count
 *       THE CORE HAZARD — an unpushed commit stops being a refusal
 *
 *   s@\[ -n "$upstream" \] \|\| return 0@[ -n "$upstream" ] || return 1@      → 1 red / 8 green
 *       FAILS CLOSED — an unknowable upstream answers YES, because NO would authorize a merge
 *
 *   s|        printf .fork\n.|        printf origin\n|                        → 1 red / 8 green
 *       prefers fork over origin — falling straight to `origin` is the old bug
 *
 * ⚠ THE BLOCK ABOVE FIRST SHIPPED AS A PREDICTION AND TWO THIRDS OF IT WAS WRONG. It claimed
 * "2 red / 7 green" for the first two, reasoning that exit code and reason text would redden
 * separately — they are asserted inside ONE test each, so the real answer is 1. A neuter block
 * written before the run is a claim of coverage, not coverage, and it reads identically to a
 * measured one. Run it, then paste the tool's own output; never retype the numbers.
 *
 * Also measured, and the reason two of these use `@` as the delimiter: a perl `s|…|…|` whose
 * replacement contains `\|\|` matched every line-end and prepended the replacement to twelve
 * lines. `--expect-lines 1` caught it and aborted with the diff — without that assertion it
 * would have produced a plausible red count against a corrupted file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const GUARD = path.resolve(process.cwd(), 'scripts/shell-helpers/update-remote-guard.sh')
const UPSTREAM = 'https://github.com/23blocks-OS/ai-maestro'

let root: string

/** Run one guard function inside `repo`, returning exit status, stdout and stderr. */
function guard(
  repo: string,
  snippet: string,
  env: Record<string, string> = {},
): { code: number; out: string; err: string } {
  const script = `set +e
AI_MAESTRO_REPO="\${AI_MAESTRO_REPO-${UPSTREAM}}"
source "${GUARD}"
${snippet}
`
  try {
    const out = execFileSync('bash', ['-c', script], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out, err: '' }
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, out: err.stdout ?? '', err: err.stderr ?? '' }
  }
}

const git = (repo: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * A bare "remote" repo plus a clone of it, wired as `<remoteName>`. The clone is left exactly
 * in sync — each test then perturbs its own copy, so no test depends on another's leftovers.
 */
function makeRepo(name: string, remoteName: string, remoteUrl?: string): string {
  const bare = path.join(root, `${name}.git`)
  const work = path.join(root, name)
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'ignore' })
  execFileSync('git', ['init', '-b', 'main', work], { stdio: 'ignore' })
  git(work, 'config', 'user.email', 'test@example.invalid')
  git(work, 'config', 'user.name', 'fixture')
  writeFileSync(path.join(work, 'seed.txt'), 'seed\n')
  git(work, 'add', 'seed.txt')
  git(work, 'commit', '-m', 'seed')
  git(work, 'remote', 'add', remoteName, remoteUrl ?? bare)
  if (!remoteUrl) git(work, 'push', '-u', remoteName, 'main')
  return work
}

function commitLocally(repo: string, msg: string): void {
  writeFileSync(path.join(repo, `${msg}.txt`), `${msg}\n`)
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', msg)
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'upd-guard-'))
})

afterAll(() => {
  // Containment proof as much as cleanup: everything this suite made lives under one temp root.
  rmSync(root, { recursive: true, force: true })
})

describe('assert_update_safe', () => {
  it('REFUSES when local commits are missing from the remote, and NAMES the count', () => {
    // The whole reason the card exists: `git pull` here would bury work that is on no remote.
    const repo = makeRepo('ahead', 'fork')
    commitLocally(repo, 'unpushed-one')
    commitLocally(repo, 'unpushed-two')
    const r = guard(repo, 'assert_update_safe fork main')
    expect(r.code).not.toBe(0)
    expect(r.err).toMatch(/REFUSED: 2 commit\(s\)/)
    expect(r.err).toMatch(/only on this disk/)
  })

  it('PASSES when the branch is fully pushed — the clean case is reachable', () => {
    // The positive control. Without it every refusal assertion above is satisfied by a guard
    // that refuses unconditionally, which would be a different bug wearing the same shape.
    const repo = makeRepo('insync', 'fork')
    const r = guard(repo, 'assert_update_safe fork main && echo PROCEED')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/PROCEED/)
  })

  it('REFUSES to pull from the upstream repo we do not publish to', () => {
    // `origin` pointing at upstream is the exact live configuration on the machine that found
    // this bug — and the old script pulled it without the operator naming any remote.
    const repo = makeRepo('upstream', 'origin', UPSTREAM)
    const r = guard(repo, 'assert_update_safe origin main')
    expect(r.code).not.toBe(0)
    expect(r.err).toMatch(/is the upstream/)
    expect(r.err).toMatch(/AIM_UPDATE_REMOTE/)
  })

  it('REFUSES on a detached HEAD rather than guessing a branch', () => {
    const repo = makeRepo('detached', 'fork')
    const r = guard(repo, 'assert_update_safe fork HEAD')
    expect(r.code).not.toBe(0)
    expect(r.err).toMatch(/cannot determine the current branch/)
  })

  it('REFUSES when the remote branch does not exist — never treats absent as up-to-date', () => {
    const repo = makeRepo('nobranch', 'fork')
    const r = guard(repo, 'assert_update_safe fork nonexistent-branch')
    expect(r.code).not.toBe(0)
    expect(r.err).toMatch(/does not exist/)
  })
})

describe('remote_is_upstream', () => {
  it('matches the upstream regardless of a .git suffix', () => {
    const repo = makeRepo('suffix', 'origin', `${UPSTREAM}.git`)
    const r = guard(repo, 'remote_is_upstream origin && echo UPSTREAM')
    expect(r.out).toMatch(/UPSTREAM/)
  })

  it('FAILS CLOSED — an unknowable upstream answers YES, because NO would authorize a merge', () => {
    // Neuter: make the empty-constant branch `return 1`. This reds while everything else stays
    // green — and the failure it prevents is the quiet one, since a guard that cannot identify
    // the upstream and therefore waves it through looks identical to a guard that checked.
    const repo = makeRepo('noconst', 'fork')
    const r = guard(repo, 'remote_is_upstream fork && echo TREATED_AS_UPSTREAM', {
      AI_MAESTRO_REPO: '',
    })
    expect(r.out).toMatch(/TREATED_AS_UPSTREAM/)
  })
})

describe('resolve_update_remote', () => {
  it('prefers fork over origin', () => {
    const repo = makeRepo('prefers', 'fork')
    git(repo, 'remote', 'add', 'origin', UPSTREAM)
    expect(guard(repo, 'resolve_update_remote').out.trim()).toBe('fork')
  })

  it('an explicit AIM_UPDATE_REMOTE wins over the preference', () => {
    const repo = makeRepo('explicit', 'fork')
    const r = guard(repo, 'resolve_update_remote', { AIM_UPDATE_REMOTE: 'somewhere-else' })
    expect(r.out.trim()).toBe('somewhere-else')
  })
})
