import * as fs from 'fs'
import * as path from 'path'
import { statePath } from '../ecosystem-constants'
// `WindowSnapshot` is imported rather than re-declared here: an identical second definition is a
// second source of truth waiting to drift, and the import direction already runs this way
// (tick-status → tick; tick does not import this module).
import type { NextAction, TickReason, StuckReason, WindowSnapshot } from './tick'

// The persisted stamp that bridges the OAuth-rotator beat to the continuity `status` verb
// (TRDD-1GGQ4HWY → TRDD-DXJZM3BW). The beat (server-tick.ts::runOneTick) ACTUATES behind the R16
// flag gate and concludes a cascade `next_action`; the `status` verb only READS. This module is
// the ONE owner of that bridge — the path, the on-disk shape, the writer, and the reader all live
// here, so the two sides can never disagree about the file (One Source of Truth).
//
// WHY A FILE (PERSIST-THEN-READ), not a shared call: it is exactly what keeps R16 intact. A status
// GET must NEVER run the tick (running it could write a live credential), so the read side may only
// consult a value the beat already persisted. A stamp on disk is the whole coupling; the read side
// cannot actuate anything.

/** The cascade states the tick can conclude — the SAME vocabulary as tick.ts's TickResult. */
const VALID: ReadonlySet<string> = new Set<NextAction>(['ok', 'rotating', 'reauth-needed', 'stuck'])

/** The reasons a `reauth-needed` can be attributed to — mirrors tick.ts's TickReason. */
const VALID_REASON: ReadonlySet<string> = new Set<TickReason>(['refresh-dead', 'slot-unreadable'])

/** The reasons a `stuck` can be attributed to — mirrors tick.ts's StuckReason. Same discipline as
 *  VALID_REASON: this set and that type must be widened together, because an unrecognised value is
 *  DROPPED on write and REJECTS the whole stamp on read. */
const VALID_STUCK: ReadonlySet<string> = new Set<StuckReason>([
  'all-maxed', 'cannot-rotate-offline', 'drain-guard-hold',
])

/** On-disk shape: the last tick's cascade conclusion, WHY, plus when it was written (ISO 8601).
 *
 * `reason` is diagnostic-only and deliberately does NOT reach the agent-facing continuity verb —
 * that surface is a fixed five-field ceiling (TRDD-H24DF6ZC Constraint 1) and widening it for a
 * diagnostic would spend a security budget on convenience. It exists because the bare
 * `reauth-needed` was unactionable: it says a human is needed without saying whether a human can
 * even help, and a stamp nobody can interpret is a status that only looks like one. */
interface TickStatusFile {
  nextAction: NextAction
  reason?: TickReason
  /** WHY a `stuck` tick is stuck — same diagnostic role `reason` plays for `reauth-needed`, and
   *  added for the same reason: a bare `stuck` says rotation is not happening without saying
   *  whether anyone can do anything about it. `all-maxed` means wait for a window;
   *  `cannot-rotate-offline` means a human is needed. Those are opposite instructions, and before
   *  this field the file carried neither — it carried `"ok"`. */
  stuck?: StuckReason
  /**
   * The live account's windows at that tick, when a usage reading was obtained.
   *
   * Persisted because the two beats are disjoint: this tick has credential data and no agents,
   * while the fleet watchdog (which runs the model-fallback sweep) has agents and no credential
   * data. Before this the stamp carried `{nextAction, at, stuck}` only, so the watchdog could not
   * see a model-scoped window at all — a Fable window at 98% was invisible to the one subsystem
   * able to act on it.
   *
   * The alternative — having the watchdog probe usage itself — is worse: it duplicates a
   * rate-limited request this tick already makes, and two callers would then disagree about the
   * same window.
   */
  windows?: WindowSnapshot
  at: string
}

/** A percentage is written only when it is a real number in range. Anything else is dropped, so
 *  the stamp never carries a value the reader would have to defend against. */
function pct(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null
}

/**
 * Validate a window snapshot for the stamp, or return null to omit it entirely.
 *
 * A malformed percentage becomes `null` (UNKNOWN) rather than voiding the whole snapshot, and
 * that is safe ONLY because the consumer fails safe on null: `planModelFallback` treats an
 * unknown account window as EXHAUSTED and refuses to act. So a half-known snapshot cannot cause
 * a switch — it can only prevent one. **If that consumer ever starts treating null as healthy,
 * this function must become all-or-nothing**, because then a dropped `sevenDayPct` would read as
 * "the account has headroom" on no evidence.
 *
 * Two cases still void the whole thing, because they are unusable rather than merely partial:
 *  - `scopedPct` with no `scopedModel` — the sweep JOINS on the model, so a percentage that names
 *    no model cannot be matched to any agent.
 *  - all three percentages unknown — nothing was measured, so writing a snapshot of nulls would
 *    only make an unprobed tick look probed.
 */
function windowsFor(v: unknown): WindowSnapshot | null {
  if (!v || typeof v !== 'object') return null
  const w = v as Record<string, unknown>
  const fiveHourPct = pct(w.fiveHourPct)
  const sevenDayPct = pct(w.sevenDayPct)
  const scopedPct = pct(w.scopedPct)
  const scopedModel = typeof w.scopedModel === 'string' && w.scopedModel !== '' ? w.scopedModel : null
  // A scoped percentage without the model naming it is unusable — the sweep joins on the model.
  if (scopedPct !== null && scopedModel === null) return null
  if (fiveHourPct === null && sevenDayPct === null && scopedPct === null) return null
  return { fiveHourPct, sevenDayPct, scopedModel, scopedPct }
}

/** A stamp older than this is IGNORED. The beat writes every ~60 s while the flag is armed; once
 *  the human disarms it the beat stops writing, so a wide window would let a stale `rotating` keep
 *  overriding the live observable heuristic — dishonest (the module's own honesty invariant). A
 *  few missed beats are tolerated; a long-disarmed value is not. */
const MAX_AGE_S = 300

/** Resolve the stamp path FRESH on every call. `getStateDir()` is anchored on os.homedir(), and a
 *  unit test points HOME at a temp dir AFTER this module was imported — the same reason
 *  server-tick.ts::oauthTickEnabled re-resolves rather than caching a module-load constant. */
function tickStatusPath(): string {
  return statePath('oauth-rotator-tick-status.json')
}

/**
 * Persist the tick's cascade `nextAction`. Accepts the beat's result as `unknown` on purpose:
 * server-tick's `runTickImpl` seam is typed `unknown`, and `withTickLock` returns `null` when a
 * concurrent beat held the lock. A missing / null / invalid `nextAction` is a SILENT no-op, so a
 * skipped, stubbed, or shapeless beat never clobbers the last good value. Atomic tmp+rename, and
 * it NEVER throws — a persistence hiccup must not crash an unattended background beat; the read
 * side already degrades to the interim heuristic when the stamp is absent or stale.
 */
export function writeTickStatus(result: unknown): void {
  try {
    const na = (result as { nextAction?: unknown } | null)?.nextAction
    if (typeof na !== 'string' || !VALID.has(na)) return
    const rs = (result as { reason?: unknown } | null)?.reason
    const payload: TickStatusFile = { nextAction: na as NextAction, at: new Date().toISOString() }
    // An unrecognised reason is DROPPED, not written: the stamp must never carry a value the
    // reader would reject, or the file becomes its own second vocabulary.
    if (typeof rs === 'string' && VALID_REASON.has(rs)) payload.reason = rs as TickReason
    const sk = (result as { stuck?: unknown } | null)?.stuck
    if (typeof sk === 'string' && VALID_STUCK.has(sk)) payload.stuck = sk as StuckReason
    const win = windowsFor((result as { windows?: unknown } | null)?.windows)
    if (win) payload.windows = win
    const file = tickStatusPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload))
    fs.renameSync(tmp, file)
  } catch {
    /* best-effort: a failed stamp just means the read side uses the interim heuristic this tick */
  }
}

/**
 * The last tick's cascade `nextAction`, or `null` when ABSENT / unparseable / STALE. `null` is the
 * EXPECTED default — the beat is OFF unless the human armed the flag (R16) — and the caller falls
 * back to the observable heuristic, never an error. Pure read (R16): it touches only the stamp
 * file, never the tick. `now()` is seconds-since-epoch (matching tick.ts's `now` seam).
 */
export function readTickStatus(opts?: { now?: () => number }): NextAction | null {
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(tickStatusPath(), 'utf8'))
  } catch {
    return null // absent or garbage → interim heuristic
  }
  if (!data || typeof data !== 'object') return null
  const d = data as { nextAction?: unknown; at?: unknown }
  if (typeof d.nextAction !== 'string' || !VALID.has(d.nextAction)) return null
  if (typeof d.at !== 'string') return null
  const ts = Date.parse(d.at)
  if (Number.isNaN(ts)) return null
  const nowMs = opts?.now ? opts.now() * 1000 : Date.now()
  if ((nowMs - ts) / 1000 > MAX_AGE_S) return null // stale → do not override the live heuristic
  return d.nextAction as NextAction
}

/**
 * The last tick's window snapshot, or null when absent, malformed, or STALE.
 *
 * Staleness is enforced with the same `MAX_AGE_S` as `readTickStatus`, and it matters more here:
 * `readTickStatus` degrades to a heuristic when the stamp is old, whereas this feeds a decision
 * to type into a live pane. An hour-old "Fable 98%" could easily describe a window that has since
 * reset, and acting on it would switch a fleet that had no reason to move.
 *
 * Deliberately NOT derived from `readTickStatus` — that returns only `nextAction`, so reusing it
 * would mean parsing the file twice and, worse, would tie the windows' validity to whether the
 * ACTION was recognised. A stamp with an unreadable `nextAction` can still carry usable windows.
 */
export function readTickWindows(opts?: { now?: () => number }): WindowSnapshot | null {
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(tickStatusPath(), 'utf8'))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const d = data as { at?: unknown; windows?: unknown }
  if (typeof d.at !== 'string') return null
  const ts = Date.parse(d.at)
  if (Number.isNaN(ts)) return null
  const nowMs = opts?.now ? opts.now() * 1000 : Date.now()
  if ((nowMs - ts) / 1000 > MAX_AGE_S) return null
  // Re-validate on READ as well as on write. The file is on disk and can be edited, truncated, or
  // written by an older build whose rules differed; a reader that trusts its own writer is only
  // correct while exactly one version has ever run.
  return windowsFor(d.windows)
}
