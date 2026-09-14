/**
 * Fail the RUN if any test wrote into the developer's real state dirs.
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
 * WHY A COUNT AND NOT A DIGEST. The state dirs are live: a background daemon may legitimately
 * touch them mid-run, and mtimes move for reasons no test caused. New ENTRIES appearing is the
 * signal that discriminates a test writing from the system breathing.
 *
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
 *
 * The actual listing/diff logic lives in tests/helpers/real-state-roots.ts, NOT here: this
 * file is only the zero-arg entry point vitest invokes, and the logic sits in a plain
 * helper module so unit tests can drive it against temp roots.
 */
import { WATCHED_ROOTS, watchMultipleRoots } from '../helpers/real-state-roots'

// vitest calls globalSetup with a GlobalSetupContext object as argument 0 — setup() must
// stay zero-arg, or a `root` parameter with a default would silently receive that object
// instead of a path. Hence the split: watchMultipleRoots(roots) is the testable logic,
// setup() is the thin real-state wrapper vitest actually invokes.
export function setup() {
  return watchMultipleRoots(WATCHED_ROOTS)
}
