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
      // The statusline-capture wrapper (TRDD-D8OYFG35/MVZTEKX4) writes through json-io's
      // updateJson on EVERY refresh (3s x N live sessions): the snapshot carries `capturedAt`,
      // so every write is a change — a fresh `.aim-bak-<stamp>-<pid>-<n>` backup, a fresh
      // `.tmp.<pid>.<n>` staging file, and a `.lock` acquired+released per write. The prune
      // keeps 10 backups per record, but the FILENAMES are always new, so any run-length
      // window sees new entries and the detector reads the live churn as a test leak.
      // Exempt the WHOLE transient write surface ONLY under statusline-state/ — json-io
      // writes the same shapes tree-wide (settings, registry, teams) and those stay watched:
      // a test leak delivered via a json-io backup elsewhere must still trip this detector.
      // NOTE 1: the check is on the REL path (prefix for direct children carries no trailing
      // slash — a `prefix.startsWith('statusline-state/')` test never matched them).
      // NOTE 2: the skip is NOT directory-gated and the walk still descends. json-io's lock is
      // a DIRECTORY at `<file>.lock` (mkdir-based, json-io.ts:165) — the transient write surface
      // under statusline-state/ therefore includes lockDIRS, and gating the exemption on
      // `!e.isDirectory()` pushed them into the counted set while STILL descending into them
      // (they carry no children). Measured 2026-09-28: a lockdir alive at the teardown instant
      // tripped the detector as "1 new entry" and blocked a commit. Skipping by NAME regardless
      // of type keeps a `.json` record in any future per-session SUBdir watched (subdirs are not
      // transient-named) while lockdirs leave the set. Known residual: a NEW Claude session
      // starting mid-run creates a top-level `<uuid>.json` record and still trips the
      // detector — accepted (the honest fix is the wrapper's time-gated backups, not a
      // wider carve-out).
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      const skipped = rel.startsWith('statusline-state/') && !e.name.endsWith('.json')
      if (!skipped) out.push(rel)
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
