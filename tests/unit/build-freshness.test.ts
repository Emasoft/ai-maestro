/**
 * lib/build-freshness.mjs — the guardrail for "a committed fix is not a deployed fix".
 *
 * The bug it exists to catch, in full: a fix to lib/signed-ledger.ts was committed
 * and the server restarted. `pm2 restart` replays the existing build, so the old
 * compiled code kept running and re-corrupted the ledger it had just repaired —
 * for 20 minutes, while git showed the fix present and nothing said "stale".
 *
 * The load-bearing property under test is that "cannot tell" is NEVER reported as
 * "fresh". A checker that answers `fresh` when it could not read anything is worse
 * than no checker: it converts an absence of evidence into a false all-clear, which
 * is the exact shape of the original defect.
 */
import { describe, it, expect, vi } from 'vitest'
import { checkBuildFreshness, warnIfBuildStale } from '@/lib/build-freshness.mjs'

const HOUR = 3600_000

/** A stat that answers from a path->mtime table and throws ENOENT otherwise. */
const statFrom = (table: Record<string, number>) => (p: string) => {
  for (const [suffix, mtimeMs] of Object.entries(table)) {
    if (p.endsWith(suffix)) return { mtimeMs }
  }
  const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException
  err.code = 'ENOENT'
  throw err
}

const opts = (table: Record<string, number>) => ({ projectRoot: '/proj', stat: statFrom(table) })

describe('checkBuildFreshness', () => {
  // The real incident, to the minute: built 13:59, committed 18:47.
  it('flags a build older than the last commit — the 2026-07-29 case', () => {
    const built = Date.parse('2026-07-29T13:59:00Z')
    const committed = Date.parse('2026-07-29T18:47:47Z')
    const res = checkBuildFreshness(opts({ '.next/BUILD_ID': built, '.git/HEAD': committed }))
    expect(res.stale).toBe(true)
    expect(res.reason).toBe('build-predates-head')
  })

  it('does not flag a build made after the last commit', () => {
    const res = checkBuildFreshness(opts({ '.next/BUILD_ID': 5 * HOUR, '.git/HEAD': 1 * HOUR }))
    expect(res.stale).toBe(false)
    expect(res.reason).toBe('fresh')
  })

  // Equal timestamps must not warn: committing and building in the same second is
  // normal, and a `>=` here would make the warning fire on every clean deploy —
  // which is how a real warning gets trained into background noise and ignored.
  it('treats an equal timestamp as fresh, not stale', () => {
    const res = checkBuildFreshness(opts({ '.next/BUILD_ID': HOUR, '.git/HEAD': HOUR }))
    expect(res.stale).toBe(false)
  })

  describe('cannot-tell is never reported as fresh', () => {
    it('no build (dev or headless mode) reports no-build, not stale', () => {
      const res = checkBuildFreshness(opts({ '.git/HEAD': 9 * HOUR }))
      expect(res.reason).toBe('no-build')
      expect(res.stale).toBe(false)
      expect(res.buildMs).toBeNull() // no measurement was taken
    })

    it('no git checkout reports no-git, not stale', () => {
      const res = checkBuildFreshness(opts({ '.next/BUILD_ID': 9 * HOUR }))
      expect(res.reason).toBe('no-git')
      expect(res.stale).toBe(false)
      expect(res.headMs).toBeNull()
    })

    // The distinction that matters: an unmeasured state must be labelled as such,
    // never as a positive verdict. `fresh` is a claim; `no-build` is an admission.
    it('never returns reason "fresh" when nothing could be read', () => {
      const res = checkBuildFreshness(opts({}))
      expect(res.reason).not.toBe('fresh')
      expect(res.buildMs).toBeNull()
      expect(res.headMs).toBeNull()
    })
  })

  it('never throws — a diagnostic must not be able to break a boot', () => {
    const exploding = () => { throw new Error('EIO: catastrophic') }
    expect(() => checkBuildFreshness({ projectRoot: '/proj', stat: exploding })).not.toThrow()
    expect(checkBuildFreshness({ projectRoot: '/proj', stat: exploding }).stale).toBe(false)
  })
})

// The synthetic tests above all passed while the module was WRONG: it read
// `.git/HEAD`, which a commit does not rewrite (it holds a symbolic ref and only
// moves on a branch switch — on this repo it was a MONTH stale while commits
// landed every few minutes). The fixtures could not catch that, because they fed
// the module a table built from the same wrong assumption the module held.
//
// So this block asserts against the REAL repository instead: which git file
// actually moves is a fact about git, and only git can settle it.
describe('against the real repository', () => {
  const realStat = (p: string) => require('fs').statSync(p)
  const root = process.cwd()

  it('reads a git mtime that tracks COMMITS, not just branch switches', () => {
    // Independently establish the truth: the reflog is appended on every commit,
    // so it must be at least as new as the plain HEAD pointer in a repo that has
    // been committed to more recently than it was branch-switched.
    let reflogMs: number
    let headMs: number
    try {
      reflogMs = realStat(`${root}/.git/logs/HEAD`).mtimeMs
      headMs = realStat(`${root}/.git/HEAD`).mtimeMs
    } catch {
      return // not a normal checkout (worktree / no reflog) — nothing to assert
    }
    if (reflogMs <= headMs) return // branch was switched more recently; no signal

    // The module must pick up the NEWER of the two. If it only read .git/HEAD it
    // would report a build made after the last branch switch as fresh, even when
    // commits have landed since.
    const res = checkBuildFreshness({ projectRoot: root, stat: realStat })
    if (res.reason === 'no-build' || res.reason === 'no-git') return
    expect(res.headMs).toBe(reflogMs)
    expect(res.headMs).toBeGreaterThan(headMs)
  })

  it('agrees with an independently computed verdict', () => {
    let buildMs: number
    try {
      buildMs = realStat(`${root}/.next/BUILD_ID`).mtimeMs
    } catch {
      return // no build present (dev/headless) — the module returns no-build
    }
    let expectedHead = 0
    for (const rel of ['.git/logs/HEAD', '.git/HEAD']) {
      try { expectedHead = Math.max(expectedHead, realStat(`${root}/${rel}`).mtimeMs) } catch { /* ignore */ }
    }
    if (expectedHead === 0) return

    const res = checkBuildFreshness({ projectRoot: root, stat: realStat })
    expect(res.stale).toBe(expectedHead > buildMs)
  })
})

describe('warnIfBuildStale', () => {
  it('logs an actionable message naming the rebuild command and the age', () => {
    const log = vi.fn()
    const built = Date.parse('2026-07-29T13:59:00Z')
    const committed = Date.parse('2026-07-29T18:47:00Z')
    warnIfBuildStale(opts({ '.next/BUILD_ID': built, '.git/HEAD': committed }), log)

    expect(log).toHaveBeenCalledTimes(1)
    const msg = log.mock.calls[0][0] as string
    expect(msg).toContain('yarn build')       // what to DO
    expect(msg).toContain('4h 48m')           // how far behind
    expect(msg).toContain('STALE')
    // Must say which half is affected — "restart it" is the wrong instinct here,
    // and the message exists to correct exactly that instinct.
    expect(msg).toContain('lib/*.mjs are unaffected')
  })

  it('stays SILENT when the build is fresh — a warning that always fires is ignored', () => {
    const log = vi.fn()
    warnIfBuildStale(opts({ '.next/BUILD_ID': 5 * HOUR, '.git/HEAD': 1 * HOUR }), log)
    expect(log).not.toHaveBeenCalled()
  })

  it('stays silent when it cannot tell', () => {
    const log = vi.fn()
    warnIfBuildStale(opts({}), log)
    expect(log).not.toHaveBeenCalled()
  })
})
