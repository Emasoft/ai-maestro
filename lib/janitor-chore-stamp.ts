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
 * The AUTHORITY on the daemon's chore roster is the janitor's own `GLOBAL_CHORES`
 * (scripts/lib/harness_backend.py in the installed plugin) — never a count copied here: a
 * hand count in this comment sat at "eleven" while the real roster grew to 13 (janitor 3.x
 * added `fleet-plugins-update` and `cold-cache-clear`), and a stale census beside code is
 * how a drifted number gets believed (measured 2026-08-15, gap survey A6; ai-maestro-janitor#274).
 * Adding a chore to this list is not what absorbs it — running it is. A stamp for a chore
 * nobody runs is worse than no stamp: it reports healthy while nothing happens.
 *
 * `github-config-audit` joined on 2026-08-05 (USER go-ahead, 4 h cadence) because its
 * population is DATA the server can hold rather than PROCESSES or SESSIONS on the host.
 *
 * `cache-prune` joined on 2026-08-19 (TRDD-B8B6D56P, parent KCRMSNL7's full-absorption
 * design). The 2026-08-05 review's "no" was an objection to absorbing it WITHOUT its
 * cardinal-safety cutoff (the oldest-live-session guard); `lib/cache-prune.ts` ports that
 * cutoff verbatim — the server snapshots ps exactly as the daemon does (userland), so
 * "processes we cannot see" never applied to this chore.
 *
 * `fleet-plugins-update` joined on 2026-08-20 (TRDD-JBFM8XR0): `lib/fleet-plugins-update.ts`
 * ports the janitor's cwd-per-project sweep verbatim; non-destructive (idempotent CLI updates,
 * the marketplace-refresh class), so it ships ON and the claim lands in the SAME commit as its
 * scheduler. `memory-guard` (4QOWVSLU) is CONDITIONAL — see CONDITIONAL_CHORES below.
 *
 * The rest stay with the janitor FOR NOW, each with an authored absorption NPT under
 * KCRMSNL7 (2026-08-19): `rules-cleanup` (5II83KK4), `fleet-stop` (9FW92242, blocked on the 99LV0U4I
 * population extension); `session-liveness` is two populations under one name (our half
 * already runs; 99LV0U4I closes the gap); `cold-cache-clear` is deferred LAST (rides the
 * janitor's auto-rolling shell-out launcher, their commitment 2026-08-19). Add a name here
 * ONLY in the commit that makes its lane live —
 * see `.claude/project/memory/janitor-chore-absorbability.md`.
 *
 * `user-plugins-update` LEFT this set on 2026-08-19 (TRDD-PE54D95Q AC6), together with the
 * per-plugin loop that performed it — the two halves of one change. Claiming a chore whose
 * work was deleted would make the janitor read "owned and healthy" over work nobody does
 * (the TRDD-FXPV7L4D class), so never re-add the name here without restoring the work, or
 * vice versa. The janitor executes it again the moment it stops seeing the claim in the
 * liveness beat's `absorbed_chores`.
 */
export const ABSORBED_CHORES = [
  'marketplace-refresh',
  'version-update',
  'oauth-rotator-supervisor',
  'oauth-rotator-tick',
  'github-config-audit',
  'cache-prune',
  'fleet-plugins-update',
] as const

/**
 * Chores whose lane is DESTRUCTIVE and therefore ships default-OFF behind its own flag
 * (KCRMSNL7 design axis). Such a chore is claimed ONLY while its lane is actually armed and
 * running — `markChoreLive` at scheduler start, `unmarkChoreLive` at stop — so the janitor daemon
 * yields it in the same instant this server starts performing it, and never over a flag that is
 * set but a lane that failed to start. `memory-guard` (TRDD-4QOWVSLU): armed by `AIM_MEMORY_GUARD=1`.
 */
export const CONDITIONAL_CHORES = ['memory-guard', 'rules-cleanup', 'fleet-stop', 'cold-cache-clear'] as const

export type AbsorbedChore = (typeof ABSORBED_CHORES)[number] | (typeof CONDITIONAL_CHORES)[number]

const liveConditional = new Set<(typeof CONDITIONAL_CHORES)[number]>()

export function markChoreLive(chore: (typeof CONDITIONAL_CHORES)[number]): void {
  liveConditional.add(chore)
}

export function unmarkChoreLive(chore: (typeof CONDITIONAL_CHORES)[number]): void {
  liveConditional.delete(chore)
}

/**
 * The chores this server claims RIGHT NOW — the unconditional set plus every conditional lane
 * that is live. This, not `ABSORBED_CHORES`, is what the liveness beat publishes as
 * `absorbed_chores`; a fresh mutable array every call.
 */
export function activeAbsorbedChores(): AbsorbedChore[] {
  return [...ABSORBED_CHORES, ...CONDITIONAL_CHORES.filter((c) => liveConditional.has(c))]
}

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
