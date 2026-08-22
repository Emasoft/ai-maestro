/**
 * No `git status` invocation may omit `--no-optional-locks` (TRDD-IMCEYV9F).
 *
 * A plain `git status` REFRESHES the index and takes `.git/index.lock` to do it. Every
 * call site here is a PROBE — "is the tree dirty?", "which paths differ?" — and a probe
 * must not take a write lock on the repo it probes. When one does, a routine read
 * contends with whatever else is committing in the same checkout, and an interrupted
 * run leaves a 0-byte orphan lock that blocks every later commit until a human removes
 * it by hand.
 *
 * Measured twice, independently, before this guard existed:
 *   - 2026-08-19 19:20 and 19:57 — two 0-byte locks with no holder, each minutes after
 *     a server start. Fixed at the boot probe (`lib/server-liveness.ts`), whose comment
 *     records the incident.
 *   - 2026-08-22 — three 0-byte locks in ten minutes while running the pillar CLIs
 *     alongside commits. Same signature; the cause was the OTHER call site
 *     (`lib/pillar/freshness.ts`), which never got the flag.
 *
 * WHY THIS TEST EXISTS AT ALL: at the time it was written the flag was present at both
 * sites and pinned by NOTHING — `server-liveness.ts` had carried it for three days with
 * no guard, which is exactly how the sibling site went three days without it. A fix that
 * nothing pins is a fix the next edit removes silently.
 *
 * NEUTER RUN (2026-08-22 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/'--no-optional-locks', //
 *   → 1 red / 2 green:
 *       every one of them passes --no-optional-locks
 *
 * The two that stayed green are the right two: the source-set check does not depend on
 * the flag, and the positive control asserts only that the SITE is found — a site with
 * the flag stripped is still a site. Had the control gone red too, the needle would be
 * matching on the flag rather than on the invocation, and the guard would be unable to
 * see the very violation it exists to catch.
 *
 * KEYED ON THE HAZARD, NOT ON A HELPER NAME. The rule is "a git invocation that runs
 * `status`", not "a call to `gitDirtyPaths`" — a needle keyed on a symbol name goes
 * blind the moment someone renames it, and the two existing sites already use two
 * different shapes (an argv array and a joined string), so no single call-shape needle
 * would see both.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import path from 'path'

const REPO = path.resolve(__dirname, '..', '..')
const SELF = 'tests/governance/git-status-must-not-take-the-index-lock.test.ts'

/**
 * Tracked source files worth scanning. Uses git so it cannot wander into node_modules.
 *
 * Lists DIRECTORIES and filters by extension in code, rather than passing a
 * `lib/**\/*.ts` pathspec. That pathspec looks obviously correct and silently drops
 * every file at depth 1: `lib/**\/*.ts` requires an intermediate directory, so
 * `lib/server-liveness.ts` — one of the two sites this guard exists to cover — was
 * invisible to it. Caught here only because the positive control below named that file
 * explicitly; a scanner with no control would have reported the repo clean while unable
 * to see half its subject.
 */
function sourceFiles(): string[] {
  const out = execFileSync('git', ['--no-optional-locks', 'ls-files', '--', 'lib', 'scripts', 'services', 'app'], {
    cwd: REPO,
    encoding: 'utf-8',
  })
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
    .filter((f) => f !== SELF)
}

/**
 * Every `git … status …` invocation, as a window of surrounding source.
 *
 * A window rather than a parse: the two live shapes are `execFileSync('git', ['status',
 * …])` and `runGit('… status …')`, and a window covers both without knowing either.
 * Deliberately generous on the left so the `git` token and the flag can sit on separate
 * lines, as they do once a comment is wrapped between them.
 */
function gitStatusWindows(src: string): string[] {
  const windows: string[] = []
  const re = /\bstatus\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const start = Math.max(0, m.index - 200)
    const win = src.slice(start, m.index + 200)
    // Only a git INVOCATION counts. `status: 400`, `'status' in body`, a TaskStatus
    // enum — none of those touch the index, and flagging them is how a guard earns a
    // reputation for crying wolf and gets deleted. Measured: without the `:` exclusion
    // this matched `NextResponse.json({ … }, { status: 400 })` in a marketplaces route,
    // because a lowercase `git` and an `execSync` both happened to sit inside the same
    // 200-char window. A git SUBCOMMAND is never followed by a colon.
    const nextChar = src.slice(m.index + 'status'.length, m.index + 'status'.length + 1)
    if (nextChar === ':') continue
    if (/\bgit\b/.test(src.slice(start, m.index)) && /execFile|spawn|execSync|runGit/.test(win)) {
      windows.push(win)
    }
  }
  return windows
}

describe('git status must not take .git/index.lock (TRDD-IMCEYV9F)', () => {
  const files = sourceFiles()

  it('scans a non-empty source set — a clean result must not mean "read nothing"', () => {
    // Without this, a broken glob reports the codebase compliant by scanning zero files.
    expect(files.length).toBeGreaterThan(50)
  })

  it('finds the known call sites — proves the needle can see what is really there', () => {
    // A POSITIVE CONTROL, and not a formality: a zero from this scanner is only
    // meaningful once the scanner is known to find a site it is standing on top of.
    const hits = files.flatMap((f) => gitStatusWindows(readFileSync(path.join(REPO, f), 'utf-8')).map(() => f))
    expect(new Set(hits).size).toBeGreaterThanOrEqual(2)
    expect(new Set(hits)).toContain('lib/pillar/freshness.ts')
    expect(new Set(hits)).toContain('lib/server-liveness.ts')
  })

  it('every one of them passes --no-optional-locks', () => {
    const offenders: string[] = []
    for (const f of files) {
      for (const win of gitStatusWindows(readFileSync(path.join(REPO, f), 'utf-8'))) {
        if (!win.includes('--no-optional-locks')) offenders.push(f)
      }
    }
    expect(offenders).toEqual([])
  })
})
