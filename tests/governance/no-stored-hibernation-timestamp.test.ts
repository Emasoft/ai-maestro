/**
 * No STORED hibernation timestamp — the `since` field is DERIVED, forever (TRDD-X2JGDOSM,
 * ai-maestro#113).
 *
 * The ruling: "how long has this agent been hibernated" is answered by deriving from the daemon's
 * transition archive on every read. A persisted `hibernatedAt` would be a SECOND WRITER of a fact
 * the archive already owns, and the two would drift — the exact defect class the `role` field
 * exhibited before its removal (TRDD-4Z62YRDG).
 *
 * HOW THE GUARD WORKS. It scans all production sources for the field name and asserts the hit set
 * is EXACTLY the known allowlist of derived-on-read sites. A new file gaining the name trips this
 * test and forces its author to show the value is READ from an event archive/ledger, never
 * persisted, before extending the allowlist. The allowlist doubles as the positive control: if the
 * scanner goes blind (regex typo, walk missing a dir), the expected hits disappear and the test
 * reds — a "clean" verdict can never come from reading nothing.
 *
 * WHY AN ALLOWLIST AND NOT ZERO-HITS. The card's own premise ("hibernatedAt: zero hits repo-wide")
 * was STALE when implemented — app/api/system/ledger-health/route.ts already carried a
 * `hibernatedAt` RESPONSE field derived from signed-ledger event timestamps (`e.ts`), i.e. the
 * same one-writer read-side pattern the ruling mandates. The RULE was never violated; the count
 * was wrong. Encode the rule, not a stale count.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCAN_DIRS = ['lib', 'services', 'app', 'types']
const NEEDLE = /hibernatedAt|hibernated_at/
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs'])

/** Derived-on-read sites, each verified by hand before listing. NEVER add a site that WRITES. */
const ALLOWLIST = [
  // Response field mapped from signed-ledger event timestamps (`hibernatedAt: e.ts`) — a reader.
  'app/api/system/ledger-health/route.ts',
  // The derivation module's own comments name the forbidden field to document the prohibition.
  'lib/agent-hibernation.ts',
].sort()

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      walk(full, out)
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
}

describe('no stored hibernation timestamp (TRDD-X2JGDOSM)', () => {
  const files: string[] = []
  for (const dir of SCAN_DIRS) walk(path.join(REPO_ROOT, dir), files)

  it('the scan set is the real production tree, not an empty walk', () => {
    // 633 files measured at authoring time; a collapse below the floor means the walk broke, and a
    // guard that reads nothing reports clean about nothing.
    expect(files.length).toBeGreaterThan(500)
  })

  it('the needle matches the field name it exists to catch', () => {
    // Positive control for the regex itself, independent of the filesystem.
    expect(NEEDLE.test('const x = { hibernatedAt: Date.now() }')).toBe(true)
    expect(NEEDLE.test('row.hibernated_at = ts')).toBe(true)
  })

  it('every hit is a verified derived-on-read site — no new writer of the fact may appear', () => {
    const hits = files
      .filter((f) => NEEDLE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO_ROOT, f))
      .sort()
    // Exact-equality both ways: a NEW site trips it (prove derived-not-stored, then allowlist),
    // and a VANISHED allowlisted site trips it too (the allowlist must never rot into fiction —
    // and its presence is the built-in proof the scanner still sees).
    expect(hits).toEqual(ALLOWLIST)
  })
})
