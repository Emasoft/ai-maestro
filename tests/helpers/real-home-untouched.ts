/**
 * A verb-agnostic tripwire: prove a test did not write the DEVELOPER'S OWN `~/.claude/settings.json`.
 *
 * WHY THIS EXISTS (measured 2026-08-01, TRDD-RYFP030K). The marketplaces-route tests mock
 * `@/lib/json-io` by NAME — spreading the real module and replacing `loadJsonSafe`/`saveJsonSafe`.
 * When the route migrated its writes from `saveJsonSafe` to `updateJson`, the mock kept mocking a
 * function nobody called, and the REAL `updateJson` ran against the REAL `~/.claude/settings.json`,
 * adding a marketplace named after the test fixture (`someone/their-plugins`). The suite reported
 * ordinary assertion failures. Nothing said "this test just edited your global Claude Code config".
 *
 * The damage was recoverable only because the thing under test took a backup first — which is a
 * lucky property of THIS subject, not a general one. A mock keyed on a name silently stops mocking
 * when the name changes, and for a WRITE that is not a broken test, it is an escape.
 *
 * This helper does not depend on which verb the code calls, so it cannot go blind the same way.
 * It is deliberately a SNAPSHOT COMPARE rather than an mtime check: a write that restores identical
 * bytes is not damage, and an mtime that moved for an unrelated reason is not either.
 *
 * ⚠ IT DETECTS, IT DOES NOT PREVENT. By the time it fires the write has happened. That is still the
 * whole value: the failure mode this replaces was SILENT, and a loud failure with the file named in
 * it is the difference between "fix the mock" and "discover it months later".
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'

/** The user's real global Claude Code config. No test may modify it. */
export const REAL_USER_SETTINGS = join(homedir(), '.claude', 'settings.json')

/** Bytes, or null when the file genuinely does not exist. Never `''` for a missing file — that
 *  would make "absent" and "empty" the same reading, which is the defect this whole card is about. */
function snapshot(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw err
  }
}

/**
 * Take a snapshot now; the returned function asserts nothing changed.
 *
 * Use as `const check = guardRealUserSettings()` in `beforeAll` and `check()` in `afterAll`.
 */
export function guardRealUserSettings(path = REAL_USER_SETTINGS): () => void {
  const before = snapshot(path)
  return () => {
    const after = snapshot(path)
    if (after === before) return
    // Say WHICH direction, because "created a file that should not exist" and "modified the user's
    // config" are different incidents with different clean-ups.
    const what =
      before === null ? 'CREATED it (it did not exist before this test file ran)'
      : after === null ? 'DELETED it'
      : `MODIFIED it (${before.length} → ${after.length} bytes)`
    expect.fail(
      `A test wrote the DEVELOPER'S OWN settings file and ${what}:\n  ${path}\n\n` +
      `This almost always means a \`vi.mock('@/lib/json-io', …)\` factory mocks a write verb the ` +
      `code under test no longer calls, so the REAL writer ran. Mocks keyed on a NAME stop mocking ` +
      `silently when the name changes. Check every write verb the route actually uses.\n\n` +
      `If the module under test wrote through \`updateJson\`, a timestamped backup sits next to the ` +
      `file (\`settings.json.aim-bak-*\`) and recovery is a diff away.`,
    )
  }
}
