/**
 * Pure logic behind the real-state-dir leak detector, kept in tests/helpers/ so a unit
 * test imports the watching logic directly instead of reaching into the vitest
 * globalSetup entry point. At import it only computes the watched paths from homedir();
 * everything else is constants and functions that return closures.
 *
 * WHY GLOBAL / WHY A COUNT AND NOT A DIGEST: see tests/setup/real-state-dir-untouched.ts,
 * the vitest wrapper that actually invokes watchMultipleRoots(WATCHED_ROOTS).
 */
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'

const REAL_STATE = path.join(homedir(), '.aimaestro')
const CROSS_PROJECTS_COORD = path.join(homedir(), '.claude', 'cross-projects-coordination')

// The ~/.aimaestro watch below applies NO scoping beyond skipping .DS_Store — a background
// daemon (the janitor heartbeat) may write into it mid-run, and the existing design
// accepts the occasional false positive rather than narrowing to a subdir or name pattern
// (see the "false positive eventually" note on watchForLeaks). The new root gets the same
// treatment: no bespoke scoping, just the one universal exclusion every root shares.
export const WATCHED_ROOTS: readonly string[] = [REAL_STATE, CROSS_PROJECTS_COORD]

export function listing(root: string): string[] {
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
      // Finder writes .DS_Store into any directory it has opened, at any time, with no
      // test involved — treating it as a leak would fail unrelated suites at random.
      if (e.name === '.DS_Store') continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      out.push(rel)
      if (e.isDirectory()) walk(path.join(dir, e.name), rel)
    }
  }
  walk(root, '')
  return out.sort()
}

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

// Watches several roots as one unit — a single leak in ANY of them fails the check.
export function watchMultipleRoots(roots: readonly string[]) {
  const checks = roots.map((root) => watchForLeaks(root))
  return () => {
    for (const check of checks) check()
  }
}
