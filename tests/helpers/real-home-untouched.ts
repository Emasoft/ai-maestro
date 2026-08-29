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
 *
 * ⚠ IT DETECTS, IT DOES NOT ATTRIBUTE (TRDD-O4E2LW3U, measured 2026-08-29). This guard sees only
 * that the bytes differ. It cannot see WHICH process wrote them, and the path it watches is the
 * SHARED global config — so a concurrent session rewriting it mid-suite is, from inside this
 * process, indistinguishable from a test escape. The message used to open "This almost always
 * means a `vi.mock(…)` factory…", asserting a cause it never observed; a full-suite run then went
 * red at 18 files / 1 test while the writer was demonstrably external — the same file changed three
 * more times with NO suite running, which is the whole of what that finding needs.
 *
 * (Colour, stated no more strongly than it was measured: at two points two hours apart the
 * `statusLine` key held a two-element array of `/tmp/slprobe` scripts instead of its single-object
 * value. The sampler in between recorded sizes and hashes ONLY, so the shape at the intermediate
 * write is unidentified and the duration between the two endpoints is an inference, not a
 * measurement. No pre-existing code in this repo produces that path.)
 *
 * The fix was to the MESSAGE ONLY, deliberately. The trigger stays a byte-compare and no suite is
 * exempted: relaxing either would blind the guard to the silent write it exists to catch, and the
 * external write is not this repo's defect. A detector that names one cause stops the reader
 * looking for the other — the same defect corrected twice on TRDD-MFTDMSJY (`readTimedOut` →
 * `readFailed`, and a banner that printed "(a keychain unlock/ACL prompt)" for a prompt nobody saw).
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
      `The DEVELOPER'S OWN settings file changed while this test file ran, and it ${what}:\n  ${path}\n\n` +
      `WHAT THIS GUARD OBSERVED is exactly that — the bytes differ between this file's beforeAll ` +
      `and its afterAll. It has NO evidence about which process wrote them, so it names both ` +
      `reachable causes rather than one:\n\n` +
      `  (a) A TEST ESCAPE. Usually a \`vi.mock('@/lib/json-io', …)\` factory mocking a write verb ` +
      `the code under test no longer calls, so the REAL writer ran — a mock keyed on a NAME stops ` +
      `mocking silently when the name changes. Also: a step whose path argument DEFAULTS to the ` +
      `real settings file. Check every write verb the code actually reaches.\n\n` +
      `  (b) ANOTHER PROCESS on this machine. This path is the SHARED global Claude Code config; ` +
      `any other session, agent, or installer running concurrently can rewrite it mid-suite. Then ` +
      `every test file whose afterAll follows that single write fails, which looks like many ` +
      `broken suites and is one external write (measured 2026-08-29: 18 files red, 1 test red).\n\n` +
      `THE DISCRIMINATOR, so you do not have to rediscover it: re-sample this file's mtime, size ` +
      `and content hash every few seconds for a few minutes with NO suite running. A file that ` +
      `keeps changing while nothing is running exonerates the suite; one that goes still points ` +
      `back at (a).\n\n` +
      `RECOVERY: a timestamped backup (\`settings.json.aim-bak-*\`) sits next to the file only if ` +
      `the write went through \`updateJson\`. Its ABSENCE is itself evidence the write did NOT ` +
      `come through that path.`,
    )
  }
}
