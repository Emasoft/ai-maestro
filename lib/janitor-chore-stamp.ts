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
 *
 * `marketplace-refresh` LEFT this set on 2026-09-17 (duty retired), together with
 * `RefreshAllMarketplaces` and its helpers — its argless `claude plugin marketplace update`
 * walked all ~260 registered marketplaces every tick and generated the file churn that grew
 * fseventsd to 27 GB. Same two-halves-of-one-change rule as `user-plugins-update` above.
 */
export const ABSORBED_CHORES = [
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

/** Absolute path of the executor-declared staleness-bounds file (rev-8 §9.2). */
export function claimBoundsPath(): string {
  return path.join(janitorControlDir(), 'claim-bounds.json')
}

/**
 * Declare THIS executor's staleness bound for the chores it runs, in
 * `claim-bounds.json` (`{"<chore>": <bound_s>}`) — the rev-8 §9.2 contract
 * (ai-maestro#126; mirror: docs/claimed-chores-contract.md). The janitor's
 * claimed-chore watchdog reads it widen-only + fail-open, so without this file
 * it derives bounds from ITS OWN roster cadence — which fired a deterministic
 * false "marketplace-refresh stale" alarm in the last hour of every healthy 4h
 * cycle (TRDD-4WERSFAG). Merge-preserving: keys this writer does not own (a
 * different executor's chores) survive a rewrite. Best-effort and NEVER throws
 * — a lost declaration degrades to the janitor's defaults, same as absent.
 */
export function declareChoreBounds(bounds: Record<string, number>): void {
  try {
    const p = claimBoundsPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    let existing: Record<string, number> = {}
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(p, 'utf8'))
      // Keep only sane rows — a corrupt file must not be re-emitted verbatim.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) existing[k] = v
        }
      }
    } catch {
      // absent or unreadable — start fresh (fail-open on the reader side too)
    }
    const merged = { ...existing, ...bounds }
    // Atomic write (tmp + rename) so the janitor can never read a half-written file.
    const tmp = `${p}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, p)
  } catch {
    // Best-effort: a telemetry declaration must never fail the scheduler that calls it.
  }
}

/**
 * The real "is this chore claimed right now" predicate, wired in by `registerChoreClaimPredicate`
 * — see that function's doc comment for why this is a runtime REGISTRATION rather than a static
 * import of `lib/server-liveness.ts::isChoreClaimed`.
 */
let choreClaimPredicate: ((chore: AbsorbedChore) => boolean) | null = null

/**
 * Wire the real chore-claim predicate — `lib/server-liveness.ts` calls this with its own
 * `isChoreClaimed` at module load, as a runtime registration rather than a static import.
 *
 * WHY NOT A STATIC IMPORT. `server-liveness.ts` already imports THIS module
 * (`activeAbsorbedChores`, `CONDITIONAL_CHORES`), so a static import back (`import {
 * isChoreClaimed } from './server-liveness'`) would be a real 2-file cycle. A lazy `require()`
 * inside `stampChoreRun` was tried first and measured to FAIL: this project's TS sources have no
 * compiled `.js` sibling under the test runner, so `require('./server-liveness')` throws
 * `MODULE_NOT_FOUND` every time it runs under vitest — silently, because it landed inside
 * `stampChoreRun`'s own best-effort `catch`, which would have made the entire central guard a
 * permanent, invisible no-op in every test that exercises it (and made every existing caller's
 * stamp silently stop writing, since the guard's OWN failure aborts the whole function). A plain
 * exported setter has no such resolution step: whichever module happens to load
 * `server-liveness.ts` — production boot (`server.mjs`) or a test that explicitly imports it —
 * calls the setter once, and `stampChoreRun` reads the registered closure directly.
 *
 * UNREGISTERED FAILS OPEN (treated as claimed, i.e. the OLD unconditional-stamp behaviour) —
 * deliberately, not fail-closed: dozens of existing callers and their tests exercise the real
 * `stampChoreRun` without ever loading `server-liveness.ts` (they gate at their OWN call site
 * instead, e.g. `armed ? () => stampChoreRun(...) : undefined` in `fleet-stop.ts`), and those are
 * not wrong — they just don't need this shared predicate. Failing closed by default would silence
 * every one of them the moment `server-liveness.ts` merely wasn't the first thing loaded, which is
 * worse than the bug this guard exists to fix.
 *
 * KNOWN LIMITATION, STATED PLAINLY (not glossed over): this makes the guard's effectiveness for
 * the OAuth chores depend on `server-liveness.ts` having been loaded before the first real beat —
 * a load-order property this file cannot verify from inside itself. `server-liveness.ts`'s own
 * registration call documents where that is verified for the CURRENT `server.mjs` boot sequence
 * and what to re-check if that sequence ever changes. A caller that needs a hard guarantee rather
 * than this best-effort default should pass `deps.isClaimed` explicitly instead of relying on
 * registration.
 */
export function registerChoreClaimPredicate(fn: (chore: AbsorbedChore) => boolean): void {
  choreClaimPredicate = fn
}

/**
 * Record that `chore` has just been attempted. Best-effort and NEVER throws: a telemetry write
 * must not be able to fail the chore it is reporting on. A lost stamp degrades to exactly the
 * pre-TRDD-14HI8ZPR behaviour (the janitor reports the chore dark), which is bad but is strictly
 * no worse than what shipped before.
 *
 * GATED ON THE CLAIM PREDICATE FIRST — THE ONE PLACE THIS GUARD LIVES. Every caller of this
 * function used to write the stamp unconditionally on attempt, which is right for a caller that
 * only ever calls it from inside its own already-armed gate (most of them do) — but wrong for one
 * that does not: the OAuth rotator's server-side tick/supervisor beats used to stamp on EVERY
 * beat regardless of their own flag, so with that flag OFF (the deliberate kill switch, spec
 * `design/specs/oauth-rotation-and-chore-handover-spec.md` ORH-32/R3) the stamp kept telling the
 * janitor "still owned", and the janitor's suppressed daemon never resumed a chore nobody was
 * running (ORH-4/M3: "the server claims a chore only when able"). Putting the check here, keyed
 * on the SAME predicate `lib/server-liveness.ts::currentCapabilities` uses to publish
 * `absorbed_chores`, closes it for every caller at once rather than requiring each call site to
 * remember its own copy of the gate — and it is provably a no-op for every caller that was already
 * only calling this from inside an equivalent gate, since the registered predicate agrees with
 * them by construction. This SUPERSEDES the "stamp on every attempt" half of TRDD-14HI8ZPR /
 * ai-maestro#111's original design — that card's INTENT (let the janitor tell an absorbed chore
 * from an unowned one) is exactly why a disclaimed chore must not be stamped as owned. This is the
 * spec's R3 kill-switch half only; ORH-4/M3's OTHER half (moving the stamp to fire after a run
 * actually COMPLETES, not merely attempts) is a separate, still-open step (implementation card C8).
 *
 * `deps.isClaimed` is a test seam that overrides even a registered predicate — production always
 * uses the registered `isChoreClaimed`, which reads real scheduler/flag state; a test that wants a
 * specific chore claimed or not without touching that real state injects a stub here instead.
 */
export function stampChoreRun(
  chore: AbsorbedChore,
  nowMs: number = Date.now(),
  deps: { isClaimed?: (chore: AbsorbedChore) => boolean } = {},
): void {
  try {
    const isClaimed = deps.isClaimed ?? choreClaimPredicate
    if (isClaimed && !isClaimed(chore)) return
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
