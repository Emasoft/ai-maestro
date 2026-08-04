/**
 * Is a statusline observation safe for the ROTATOR to act on? — TRDD-SIV45HOG.
 *
 * ── THE FAILURE THIS PREVENTS ────────────────────────────────────────────────────────────────────
 * The rotator switches accounts when the live one is nearly exhausted. Statusline reports arrive
 * continuously and carry NO account identity, so without a guard the rotator reads reports produced
 * while the OLD (exhausted) account was live and attributes them to the NEW one. It sees ~98% on a
 * fresh account, rotates straight back out of it, and repeats — **a loop that burns every remaining
 * account in minutes, at 60 s per iteration, unattended, while the log reads like healthy
 * rotation.** That is why GY0LJV6S is blocked on this file existing rather than merely sequenced
 * after it.
 *
 * ── WHY THIS MODULE IMPORTS NOTHING FROM THE ROTATOR ─────────────────────────────────────────────
 * `admitSnapshot` takes the rotator's view as a PLAIN OBJECT. Two reasons, and the second is the
 * one that matters: it keeps the predicate pure and trivially testable (no state file, no keychain,
 * no clock), and it lets a test construct combinations the live system cannot currently produce —
 * which is the only way to prove the two guards are INDEPENDENT rather than one guard checked
 * twice.
 */
import { loadState } from '@/lib/oauth-rotator/slots'
import type { StatuslineSnapshot } from '@/types/statusline'

/** Why a snapshot must not be acted on. Null means admit. */
export type SnapshotRejection = 'stale-account' | 'pre-switch'

/**
 * The rotator facts the predicate needs — a structural subset of `RotatorState`, so a caller may
 * pass the real state directly.
 *
 * `last_switch_at` is `unknown` on purpose: it lives in `RotatorState`'s open `[k: string]: unknown`
 * index (it is written by `rotate.ts:44`, not declared), so typing it `number` here would be a
 * claim this module cannot enforce. It is narrowed at the comparison instead.
 */
export interface RotatorAdmissionView {
  live_fp: string | null
  last_switch_at?: unknown
}

/**
 * Decide whether the rotator may act on one observation. Returns null to ADMIT, or the reason.
 *
 * ⚠ THE UNIT TRAP, AND WHY IT IS WRITTEN OUT RATHER THAN JUST FIXED. The two clocks are not the
 * same clock:
 *
 *   - `state.last_switch_at` is epoch **SECONDS** (`rotate.ts:44`: `Date.now() / 1000`, commented
 *     "matches Python time.time()"), because the janitor's Python daemon writes the same field;
 *   - `StatuslineSnapshot.capturedAt` is epoch **MILLISECONDS** (`types/statusline.ts`, explicit).
 *
 * A naive `capturedAt < last_switch_at` is wrong by 1000× **and fails in the direction that makes
 * the guard VACUOUS**: a millisecond value (~1.78e12) is always greater than a seconds value
 * (~1.78e9), so the comparison is never true, nothing is ever rejected for age, and the rotation
 * loop this file exists to prevent survives untouched *inside its own guard*. It would read as a
 * working check in every review. The conversion is therefore explicit and pinned by a test whose
 * fixture straddles the switch instant in BOTH directions — asserting only the reject case would
 * pass equally against a guard that rejects everything.
 *
 * This is the same defect class D8OYFG35 already handled for `resets_at` (ISO vs epoch, normalised
 * once at the boundary); the seam simply moved.
 */
export function admitSnapshot(
  snapshot: Pick<StatuslineSnapshot, 'liveFp' | 'capturedAt'>,
  rotator: RotatorAdmissionView,
): SnapshotRejection | null {
  // IDENTITY. A report stamped with a fingerprint that is no longer live describes an account the
  // rotator is no longer using. Note this also rejects when the stamp is null and a rotator IS
  // configured (state unreadable at ingest ⇒ no identity ⇒ no data), which is the fail-safe
  // direction: the rotator's behaviour on absent data is already "do not rotate".
  //
  // BOTH sides are normalised through the same '' → null collapse. `resolveLiveAccountFp`
  // already does it to the STAMP, for the reason its own comment gives — "otherwise
  // `'' !== null` makes the identity check reject on a difference that means nothing" — but
  // that comparison reads the RAW `rotator.live_fp`, so the fix covered only one side.
  // `fingerprint()` returns '' for a blob with no accessToken and `rotate.ts:43` /
  // `tick.ts:472` assign it verbatim, so the moment `live_fp` is '' the stamp is null,
  // `null !== ''` holds, and EVERY observation is judged 'stale-account' — permanently, and
  // silently: the push-trigger stops firing, `freshestAdmissibleUsage` always returns null,
  // and the rotator falls back to the API polling this whole path exists to eliminate.
  const liveFp = rotator.live_fp === '' ? null : rotator.live_fp
  if (snapshot.liveFp !== liveFp) return 'stale-account'

  // AGE. Independent of identity, and NOT redundant with it: a switch away and back (A→B→A), or a
  // state.json that was reset and rebuilt, both produce a report whose stamp matches the current
  // live account while having arrived before the most recent switch. Identity cannot see those;
  // this can.
  const raw = rotator.last_switch_at
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const switchAtMs = raw * 1000 // SECONDS → MILLISECONDS. See the unit trap above.
    if (snapshot.capturedAt < switchAtMs) return 'pre-switch'
  }

  return null
}

/**
 * Resolve WHO IS LIVE NOW, for stamping at ingest.
 *
 * ── WHY `state.live_fp` AND NOT A FRESH `fingerprint()` CALL ─────────────────────────────────────
 * The card's acceptance asked for `fingerprint()` from `lib/oauth-rotator/slots.ts` and not a
 * second implementation. Reading `state.live_fp` satisfies that — it is the value `fingerprint()`
 * produced, cached by the rotator that maintains it (`rotate.ts:43`, reconciled by `tick.ts`) —
 * and it is better than calling `fingerprint()` here for two measured reasons:
 *
 *   1. `fingerprint()` takes a CREDENTIAL BLOB. Calling it at ingest means reading the live
 *      credential — a secret — on a hot path the route rate-limits at 600/min. The stamp needs an
 *      identifier, not a token, and `live_fp` is exactly that identifier with no secret attached.
 *   2. The guard exists to protect the ROTATOR's decision, so "who is live" should be the
 *      rotator's own view. If the two ever disagree, the rotator acts on its own — so a stamp
 *      resolved from anywhere else would be measuring the wrong thing.
 *
 * ── FAIL-SOFT, DELIBERATELY ──────────────────────────────────────────────────────────────────────
 * Any failure yields null rather than throwing. An observation must never be LOST because the
 * rotator's state could not be read: the ingest is free data arriving every few seconds, and a null
 * stamp is already handled downstream as "no identity" (which `admitSnapshot` treats as
 * inadmissible whenever a rotator is configured — the safe direction). `loadState()` documents
 * itself as never throwing; the try/catch is here because "documents itself as" is not "cannot".
 */
export function resolveLiveAccountFp(): string | null {
  try {
    const fp = loadState().live_fp
    // '' is what `fingerprint()` returns for a blob with no accessToken. Normalising it to null
    // keeps ONE spelling of "no identity" downstream — otherwise `'' !== null` makes the identity
    // check reject on a difference that means nothing.
    return typeof fp === 'string' && fp !== '' ? fp : null
  } catch {
    return null
  }
}

/**
 * Stamp an observation with the account live at ARRIVAL. Mutates and returns the same object.
 *
 * Called by the ingest route AFTER normalisation, which is what keeps the payload structurally
 * unable to supply this value (`statusline-normalize.ts` hard-codes `liveFp: null`).
 */
export function stampLiveAccount(snapshot: StatuslineSnapshot): StatuslineSnapshot {
  snapshot.liveFp = resolveLiveAccountFp()
  return snapshot
}

/**
 * The fields the selection reads — a `Pick`, exactly like `admitSnapshot`'s parameter and for the
 * same reason: a real `StatuslineSnapshot[]` still passes structurally, while a test may build a
 * fixture without inventing the fields this code never looks at. A fixture cast to the full type
 * would compile today and go on compiling after a field it depends on changes shape.
 */
export type UsageObservation = Pick<StatuslineSnapshot, 'liveFp' | 'capturedAt' | 'rateLimits'>

/** The two windows the rotator actually decides on, plus when the sample was taken. */
export interface AdmissibleUsage {
  fiveHourPct: number
  sevenDayPct: number | null
  capturedAt: number
}

/**
 * The freshest snapshot the rotator may act on, or NULL — the bridge `tick.ts:490` will call.
 *
 * ── WHY THIS IS A SEPARATE, PURE FUNCTION ───────────────────────────────────────────────────────
 * It is everything GY0LJV6S needs EXCEPT the one edit that can hurt. `autoRotate` is the function
 * whose failure mode is "burns every remaining account in minutes, unattended, while the log reads
 * like healthy rotation", so the selection logic is built and pinned here first, where it can be
 * driven with fabricated snapshots and no rotator state at all. Wiring then becomes a small,
 * reviewable substitution rather than new logic invented inside the dangerous function.
 *
 * ── NULL IS THE FAIL-SAFE, AND IT MUST STAY THAT WAY ────────────────────────────────────────────
 * Returning null means "no usable observation" and the caller MUST fall back to the endpoint
 * (`usageRequest`) rather than assume anything. This lines up deliberately with `tick.ts:220` —
 * *"unknown usage never trips it; only a positive over-threshold signal rotates"* — so an
 * inadmissible snapshot lands in the SAME branch as an unreachable endpoint. That equivalence is
 * what makes this safe to wire; if a future edit makes null mean something else, the guard stops
 * being a guard.
 *
 * ── FRESHNESS IS THE CALLER'S CONSTANT, NOT OURS ────────────────────────────────────────────────
 * `maxAgeMs` is required rather than defaulted so this module never has to import the store (which
 * pulls in `fs`) and so the freshness policy has exactly ONE owner — `STATUSLINE_FRESH_MS` in
 * `lib/statusline-store.ts`. A default here would be a second policy that silently disagrees with
 * the roll-up's definition of "describes a live session".
 */
export function freshestAdmissibleUsage(
  snapshots: readonly UsageObservation[],
  rotator: RotatorAdmissionView,
  opts: { now: number; maxAgeMs: number },
): AdmissibleUsage | null {
  let best: AdmissibleUsage | null = null

  for (const s of snapshots) {
    // Age FIRST — it is the cheapest rejection and the one most snapshots fail. A stale file
    // describes a session that ended, and its window has since reset.
    if (opts.now - s.capturedAt > opts.maxAgeMs) continue
    // …then identity + pre-switch. Same predicate the rest of the system uses; never a second copy.
    if (admitSnapshot(s, rotator) !== null) continue

    const fh = s.rateLimits.fiveHour?.usedPercentage
    // The 5h window is what `autoRotate` decides on, so a snapshot without it is not a usable
    // observation however fresh it is. Rejecting here rather than defaulting to 0 is the whole
    // point: a missing gauge read as "0% used" would report a maxed account as empty.
    if (typeof fh !== 'number' || !Number.isFinite(fh)) continue

    // NEWEST wins. Not the highest — that is the ROLL-UP's rule (`StatuslineRollup` takes the
    // tightest window across sessions because they disagree by sampling instant). Here every
    // admissible snapshot is post-switch on the SAME account, so the freshest is simply the most
    // truthful, and taking a max would let one old pessimistic sample veto recovery forever.
    if (best === null || s.capturedAt > best.capturedAt) {
      const sd = s.rateLimits.sevenDay?.usedPercentage
      best = {
        fiveHourPct: fh,
        sevenDayPct: typeof sd === 'number' && Number.isFinite(sd) ? sd : null,
        capturedAt: s.capturedAt,
      }
    }
  }

  return best
}
