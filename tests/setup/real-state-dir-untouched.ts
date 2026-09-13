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

const REAL_STATE = path.join(homedir(), '.aimaestro')

function listing(): string[] {
  if (!fs.existsSync(REAL_STATE)) return []
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
  walk(REAL_STATE, '')
  return out.sort()
}

/**
 * TWO THINGS A READER MUST KNOW, both measured rather than anticipated:
 *
 * 1. A throw from a globalSetup teardown is a RUN-level error, not a test failure. Vitest
 *    exits non-zero, but the reporter line still says "N passed". Read the EXIT CODE, not
 *    the tally — a habit this session failed at three times.
 * 2. Expect a false positive eventually. The janitor heartbeat fires on a ~5-minute cadence
 *    and writes into this tree, so a long run can catch a legitimate daemon write. When it
 *    fires, check mtime provenance before blaming a test: the entry names tell you which
 *    corpus produced them, and a test's corpus is always under a temp root.
 */
export function setup() {
  const before = new Set(listing())
  return () => {
    const added = listing().filter((p) => !before.has(p))
    if (added.length === 0) return
    const shown = added.slice(0, 20).join('\n  ')
    throw new Error(
      `TEST SUITE LEAKED into the developer's real state dir ${REAL_STATE}.\n` +
        `${added.length} new entr${added.length === 1 ? 'y' : 'ies'}:\n  ${shown}` +
        (added.length > 20 ? `\n  ...and ${added.length - 20} more` : '') +
        `\n\nA test wrote outside its temp fixtures. The usual cause is driving a real CLI\n` +
        `against a temp corpus: the binary resolves the state dir from $HOME, so the corpus\n` +
        `is contained and the INDEX is not. Pass AIMAESTRO_STATE_DIR in the spawn env.`,
    )
  }
}
