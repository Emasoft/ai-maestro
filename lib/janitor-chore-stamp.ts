// The chore-completion stamp the janitor reads to see that an absorbed duty is being done
// (TRDD-14HI8ZPR, contract stated in `Emasoft/ai-maestro#111`).
//
// WHY THIS IS A SEPARATE MODULE FROM `janitor-control.ts`. That module states a hard invariant in
// its header — "NEVER WRITE … this module has no writer and exports none. Reads only." — because
// an accidental write of a FLAG there ratchets the whole fleet into a mode nothing lifts. That
// invariant is correct and is not weakened here. A `.last-run.ts` stamp is not a flag: it is
// telemetry the janitor explicitly asks the chore's owner to write, and it changes no fleet mode.
// Keeping the writer in its own file lets `janitor-control.ts` keep saying "no writer" truthfully.
//
// AND IT CANNOT WRITE A FLAG BY CONSTRUCTION. The filename is composed as
// `${chore}.last-run.ts` from a CLOSED literal union, so there is no argument to this module that
// produces `kill-switch.flag` or any other control-plane name. That is a stronger guarantee than
// a comment asking callers to be careful.
//
// THE CONTRACT (janitor `global_state.read_last_run`):
//
//     ~/.claude/janitor-control/<task-name>.last-run.ts     # epoch SECONDS, plain text
//
// `<task-name>` is the exact registry string — not a slug of our own devising, since the janitor
// looks up the literal name. Getting it wrong fails in the silent-healthy direction: the janitor
// reads "absent" and reports the chore dark, which is indistinguishable from not running it at
// all. That is the failure this whole card exists to remove, so it must not be re-introduced by a
// typo in a string.
//
// WHY WE STAMP ON ATTEMPT COMPLETION, NOT ON SUCCESS. The stamp answers the HANDOVER question —
// "is anyone doing this chore on cadence?" — which is what a suppressed daemon needs to know. A
// chore that ran and partially failed was still owned and still attempted, and the failure has its
// own reporting path (the run entries and the decision log). Stamping only on total success would
// make a flaky chore look UNOWNED, sending the janitor to restart a daemon that is not the problem.

import fs from 'node:fs'
import path from 'node:path'

import { janitorControlDir } from './janitor-control'

/**
 * The chores this server currently claims from the janitor daemon
 * (`harness_backend.py::SERVER_ABSORBED_TASKS`). These strings are a CROSS-PROCESS CONTRACT with
 * another project — they are the janitor's registry names, so they must match it exactly and must
 * not be renamed for our own convenience.
 *
 * The daemon has eleven global chores; the five not listed here are still unowned while the server
 * is up (see TRDD-14HI8ZPR). Adding one to this list is not what absorbs it — running it is.
 * A stamp for a chore nobody runs is worse than no stamp: it reports healthy while nothing happens.
 *
 * `github-config-audit` joined on 2026-08-05 (USER go-ahead, 4 h cadence) and is the ONLY one of
 * the six formerly-unowned chores that could join, because it is the only one whose population is
 * DATA the server can hold rather than PROCESSES or SESSIONS on the host. The other five stay with
 * the janitor: `fleet-stop`, `memory-guard`, `cache-prune` and `rules-cleanup` all enumerate live
 * host processes we cannot see, and `session-liveness` is two populations under one name (our half
 * already runs; the host-wide half is not ours). Do not add those here — see
 * `.claude/project/memory/janitor-chore-absorbability.md`.
 */
export const ABSORBED_CHORES = [
  'marketplace-refresh',
  'user-plugins-update',
  'version-update',
  'oauth-rotator-supervisor',
  'oauth-rotator-tick',
  'github-config-audit',
] as const

export type AbsorbedChore = (typeof ABSORBED_CHORES)[number]

/** Absolute path of one chore's stamp. Exported for the test that pins the filename contract. */
export function choreStampPath(chore: AbsorbedChore): string {
  return path.join(janitorControlDir(), `${chore}.last-run.ts`)
}

/**
 * Record that `chore` has just been attempted. Best-effort and NEVER throws: a telemetry write
 * must not be able to fail the chore it is reporting on. A lost stamp degrades to exactly the
 * pre-TRDD-14HI8ZPR behaviour (the janitor reports the chore dark), which is bad but is strictly
 * no worse than what shipped before.
 */
export function stampChoreRun(chore: AbsorbedChore, nowMs: number = Date.now()): void {
  try {
    const p = choreStampPath(chore)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    // Epoch SECONDS — the janitor parses this as an integer second count. Writing milliseconds
    // would parse fine and put every stamp ~55 000 years in the future, i.e. permanently "fresh",
    // which is the one wrong answer worse than "stale": it would report every chore healthy for
    // ever, including the ones that stop running.
    fs.writeFileSync(p, String(Math.floor(nowMs / 1000)), 'utf8')
  } catch {
    // Non-fatal by design — see the doc comment.
  }
}

/**
 * Read one chore's stamp as epoch ms, or null when absent/unreadable/garbage. Used by our own
 * tests and by any status surface we build (TRDD-TCKNOA72); the janitor reads the file directly.
 */
export function readChoreStamp(chore: AbsorbedChore): number | null {
  try {
    const raw = fs.readFileSync(choreStampPath(chore), 'utf8').trim()
    if (!/^\d+$/.test(raw)) return null
    return Number(raw) * 1000
  } catch {
    return null
  }
}
