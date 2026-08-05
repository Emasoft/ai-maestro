// GLOBAL test containment for the janitor control dir (TRDD-14HI8ZPR).
//
// WHY THIS IS GLOBAL RATHER THAN PER-FILE. The absorbed chores now write
// `<chore>.last-run.ts` into `~/.claude/janitor-control/` so the janitor can see that a chore it
// handed us is being done. That write lives inside the chore's own code path, which means ANY
// test that drives a chore — directly or three call layers down — writes the DEVELOPER'S real
// control dir unless something stops it.
//
// Measured the moment the stamps landed: `runOneSupervisorBeat` is driven by four test files, none
// of which had any containment, and a single test run left a real
// `oauth-rotator-supervisor.last-run.ts` on this machine. Fixing those four files would have left
// the fifth to be written later by someone who did not know the rule — so the guard belongs at the
// primitive, not at the call sites.
//
// A stray stamp is not cosmetic: it tells the janitor a chore ran when only a test ran, which is
// the false-healthy direction. The whole point of the stamp contract is that the janitor can trust
// it, and a contract that tests can forge is not one.
//
// Registered via `setupFiles` in vitest.config.ts, so it applies to every test file automatically.
// A test that needs its OWN control dir (to assert a stamp appears, or to simulate a fleet flag)
// still overrides the same env var locally and restores it — this only changes the DEFAULT, from
// "the real dir" to "a throwaway".

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-vitest-janitor-control-'))
process.env.JANITOR_CONTROL_DIR = dir

// Best-effort cleanup. The OS reaps its temp dir regardless, so a failure here is not worth
// failing a suite over — the containment has already done its job by the time this runs.
process.on('exit', () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})
