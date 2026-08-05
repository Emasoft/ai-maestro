// The consumer for the janitor's WORK-REQUEST flags — the trigger half of the fleet-control plane
// (`Emasoft/ai-maestro#102`; the contract is stated in the janitor's `global_state.py`).
//
// WHY THIS IS A THIRD MODULE, next to `janitor-control.ts` (reader) and `janitor-chore-stamp.ts`
// (stamp writer). `janitor-control.ts` opens with "NEVER WRITE … this module has no writer and
// exports none", because an accidental write of a MODE flag ratchets the whole fleet into a state
// nothing lifts. That invariant is correct and is not weakened here: this module cannot express a
// mode flag at all.
//
// AND IT CANNOT DELETE ONE BY CONSTRUCTION. The argument type is a CLOSED union of work-request
// names, so there is no value of `flag` for which `consumeWorkRequest` unlinks `kill-switch.flag`,
// `global-pause.flag` or `maintenance-mode.flag`. That is a stronger guarantee than a comment
// asking callers to be careful — which matters more here than for the stamp writer, because this
// module's whole job is deletion.
//
// THE DISTINCTION THE JANITOR DRAWS, and why deleting one of these is safe while deleting a mode
// flag is catastrophic:
//
//   MODE flag        — "the fleet is in state X". Presence IS the state. Only the janitor may
//                      clear it, because clearing it CHANGES the fleet's mode.
//   WORK-REQUEST flag — "someone would like chore Y to run soon". Presence is a message addressed
//                      to whoever owns that chore. Clearing it consumes the message; it changes no
//                      mode, and the sender re-raises it if the need recurs.
//
// `janitor-control.ts` already encodes half of that split — its `ACTUATION_BLOCKING_FLAGS` excludes
// the reload/version-update flags precisely because "they are work requests, NOT stops".
//
// CLEAR **BEFORE** RUN, NEVER AFTER. The janitor specifies this ordering explicitly and it is not a
// detail: a request that arrives WHILE the chore is running must survive it. Clearing first means
// such a request re-raises the flag and is honoured by the next pass; clearing afterwards would
// delete a message that arrived after the work it was asking for had already been done, and the
// requester would wait a full cadence with no way to tell that its request was silently dropped.

import fs from 'node:fs'
import path from 'node:path'

import { janitorControlDir } from './janitor-control'

/**
 * The work-request flags this server consumes. A name may join this list ONLY when this server
 * actually owns the chore it triggers — consuming a request for a chore we do not run destroys the
 * requester's only signal and leaves it believing the work was picked up.
 */
export const WORK_REQUEST_FLAGS = ['version-update-requested.flag'] as const

export type WorkRequestFlag = (typeof WORK_REQUEST_FLAGS)[number]

/** Absolute path of one work-request flag. Exported for the test that pins the filename contract. */
export function workRequestPath(flag: WorkRequestFlag): string {
  return path.join(janitorControlDir(), flag)
}

/**
 * Consume `flag`: delete it and report whether it was there. Call this IMMEDIATELY BEFORE running
 * the chore it triggers, never after (see the header).
 *
 * NEVER THROWS, and the failure direction is deliberate: any error — a missing dir, a permission
 * problem, a race with the janitor rewriting it — reports `false`, i.e. "no request was pending".
 * That degrades to the pre-fix behaviour (the chore runs on its ordinary cadence and the flag stays
 * put) rather than to a crash inside the chore that a stale trigger would then cause on every pass.
 *
 * The return value is genuinely useful and should be logged by callers: a `true` says the requester
 * had been waiting, which is the only evidence that the trigger path works end to end.
 */
export function consumeWorkRequest(flag: WorkRequestFlag): boolean {
  const p = workRequestPath(flag)
  try {
    // `rmSync` with force:true does not distinguish "was there" from "was not", so stat first.
    // A race here is benign in both directions: a flag raised between the stat and the unlink is
    // deleted having been reported absent (the chore runs anyway — it is about to), and one
    // deleted by the janitor in between reports present and unlinks nothing.
    const existed = fs.existsSync(p)
    fs.rmSync(p, { force: true })
    return existed
  } catch {
    return false
  }
}
