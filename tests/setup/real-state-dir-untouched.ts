/**
 * Fail the RUN if any test wrote into the developer's real ai-maestro state dir.
 *
 * This detects rather than redirects, and that choice is the whole point. A global
 * REDIRECT was tried first and broke 13 tests that legitimately resolve the real state
 * dir themselves — a containment that moves a path other tests assert on trades one
 * silent wrong for another. A detector changes no path, so it cannot break a passing
 * test; it can only reveal a leak that was already happening.
 *
 * WHY GLOBAL. The leak this was built for ran for a whole suite's lifetime while that
 * suite's OWN containment test watched the same directory and passed, because it compared
 * top-level names and the writes landed inside an entry that already existed. Measured
 * 2026-09-13: 89 files in two hours from one suite, 259 accumulated, and 155 of those from
 * slugs belonging to NO test in this repo — i.e. the mechanism is not confined to code we
 * control here. Per-file guards catch the file that remembers to carry one.
 *
 * WHY A COUNT AND NOT A DIGEST. The state dir is live: a background daemon may legitimately
 * touch it mid-run, and mtimes move for reasons no test caused. New ENTRIES appearing is the
 * signal that discriminates a test writing from the system breathing.
 */
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'

// homedir() is deliberately NOT read at module load. A module-level const freezes whatever
// the FIRST importing process saw, and this module is imported twice over: by vitest's main
// process for globalSetup, and by a worker for the unit test that verifies it. Two setupFiles
// in this repo already redirect per-worker environment state, so an import-time snapshot could
// bind the guard to one home while the test asserting the binding runs against another.

function listing(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      out.push(rel)
      if (e.isDirectory()) walk(path.join(dir, e.name), rel)
    }
  }
  walk(root, '')
  return out.sort()
}

/**
 * TWO THINGS A READER MUST KNOW, both measured rather than anticipated:
 *
 * 1. A throw from a globalSetup teardown is a RUN-level error, not a test failure. Vitest
 *    exits non-zero, but the reporter line still says "N passed". Read the EXIT CODE, not
 *    the tally — a habit this session failed at three times. MEASURED 2026-09-13 on vitest
 *    4.0.18: forcing the teardown to throw produced exit code 1, printed as a "Startup
 *    Error" block, while the reporter line still read "13 passed".
 * 2. Expect a false positive eventually. The janitor heartbeat fires on a ~5-minute cadence
 *    and writes into this tree, so a long run can catch a legitimate daemon write. When it
 *    fires, check the triage sentence the thrown message itself carries (below) before
 *    blaming a test.
 */
export function watchForLeaks(root: string) {
  const before = new Set(listing(root))
  return () => {
    const added = listing(root).filter((p) => !before.has(p))
    if (added.length === 0) return
    const shown = added.slice(0, 20).join('\n  ')
    throw new Error(
      `TEST SUITE LEAKED into the developer's real state dir ${root}.\n` +
        `${added.length} new entr${added.length === 1 ? 'y' : 'ies'}:\n  ${shown}` +
        (added.length > 20 ? `\n  ...and ${added.length - 20} more` : '') +
        `\n\nA test wrote outside its temp fixtures. The usual cause is driving a real CLI\n` +
        `against a temp corpus: the binary resolves the state dir from $HOME, so the corpus\n` +
        `is contained and the INDEX is not. Jail HOME in the child's spawn env instead\n` +
        `(env: { ...process.env, HOME: <temp-jail-dir> }) — there is no AIMAESTRO_STATE_DIR\n` +
        `override; one was added and deliberately reverted.\n\n` +
        `If the listed names above do NOT look like a test corpus, check their mtimes before\n` +
        `blaming a test — a background daemon writes into this tree too, and deleting this\n` +
        `guard over one such write would leave a real leak undetected.`,
    )
  }
}

// vitest calls globalSetup with a GlobalSetupContext object as argument 0 — setup() must
// stay zero-arg, or a `root` parameter with a default would silently receive that object
// instead of a path. Hence the split: watchForLeaks(root) is the testable logic, setup()
// is the thin real-state wrapper vitest actually invokes.
export function setup() {
  return watchForLeaks(path.join(homedir(), '.aimaestro'))
}
