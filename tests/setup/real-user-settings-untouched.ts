/**
 * GLOBAL tripwire: no test file may modify the developer's own `~/.claude/settings.json`.
 *
 * WHY THIS IS GLOBAL AND NOT OPT-IN. The helper it wraps has existed since TRDD-RYFP030K and
 * worked exactly as designed — but it had to be CALLED, and on 2026-08-06 it protected 6 of 385
 * test files. The one suite that needed it was, by construction, the one nobody thought to add
 * it to: `auto-update-absorbed-duty` gained a step whose default argument is the real settings
 * path, drove it, rewrote all 257 of the user's marketplace entries, and reported 35/35 GREEN.
 * Nothing in that run said the global config had been edited.
 *
 * That is the general shape, and it is why opt-in cannot work here: a guard against "a write
 * nobody expected" is useless in precisely the suites where nobody expected a write. The only
 * adoption rate that protects the next unforeseen case is 100%, so this runs from
 * `vitest.config`'s `setupFiles` and every suite gets it for free.
 *
 * SCOPE: it snapshots once per test FILE (vitest gives each file its own environment) and
 * asserts at that file's end. It DETECTS, it does not PREVENT — by the time it fires the write
 * has happened. That is still the whole value: the failure it replaces was silent, and a loud
 * failure naming the file is the difference between fixing it now and finding it months later.
 *
 * If this ever fires on a suite you believe is innocent, the fix is NOT to exempt the suite. It
 * is to find which write verb reached the real path — usually a default argument (as above) or a
 * `vi.mock` keyed on a verb name the code no longer calls.
 */
import { beforeAll, afterAll } from 'vitest'
import { guardRealUserSettings } from '../helpers/real-home-untouched'

let check: (() => void) | null = null

beforeAll(() => {
  check = guardRealUserSettings()
})

afterAll(() => {
  // Read into a local first: `check` is module state and the assertion throws, so clearing it
  // afterwards would be skipped. A stale closure here would compare against the PREVIOUS file's
  // snapshot and blame the wrong suite.
  const assertUntouched = check
  check = null
  assertUntouched?.()
})
