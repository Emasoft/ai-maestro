// The OAuth-rotator ORCHESTRATION tick (TRDD-1GGQ4HWY Phase F/G) — the daemon's beat, ported.
//
// This is the piece that turns the janitor's background daemon into a FUNCTION OF THE
// ai-maestro server: it COMPOSES the already-ported, already-tested E-actuators
// (live.ts / rotate.ts / network.ts / slots.ts) into the two continuity actions the daemon
// ran every 60 s — RENEW (keepalive-refresh idle alternate slots before they lapse) and
// ROTATE (swap the live credential to a safe alternate when the live account is exhausted /
// expiring / rejected). It introduces NO new irreversible primitive: `switchLiveTo` and
// `writeSlot` were ported in Phase E; this file only sequences them behind the daemon's
// exact decision logic.
//
// FAITHFUL port of rotator.py's `cmd_auto` (the ROTATE decision), `_keepalive_refresh` (the
// RENEW loop), `_refresh_and_heal_slot`, `_reconcile_live_email`, `_resolve_untrusted_live`
// (the F1 mirror-identity safety), and the `cmd_tick` composition. The control flow — the
// 429 debounce, the anti-thrash dwell, DRAIN-FIRST target selection, the degraded fallback,
// the refresh-on-err net, the RENEW-before-rotate guard, the mirror-source stay-put — is
// preserved 1:1 because a divergence here writes a WRONG live credential (the one
// irreversible failure this whole subsystem exists to avoid).
//
// ── ACTIVATION (R16 / the design's config gate) ────────────────────────────────────────────
// `runTick` ACTUATES (it can call `switchLiveTo` → the real `Claude Code-credentials` write).
// It MUST NOT be wired to fire until the USER enables it: the safe default is "the server
// never CALLS runTick", which is what Phase G's config gate enforces (default OFF). Enabling
// the timer is the single R16 activation step — the mechanism is complete; only the call site
// is gated. Every unit test drives runTick with injected deps (a stub fetch + the E-layer's
// 0-IMPACT keychain guards: forced-off backend + temp HOME), so no test touches the real
// credential or the network.
//
// ── The three thresholds that decide a rotation (match rotator.py's env DEFAULTS) ───────────
// ai-maestro does not expose these as env vars (a var that alters what the rotator writes is
// exactly the kind TRDD-CC9PY337 keeps out of the environment); they are fixed constants here,
// and become a dashboard setting the day tuning is wanted. The values are the janitor's
// shipped defaults, so server and any #N fallback decide identically.

import {
  loadState,
  saveState,
  readSlot,
  writeSlot,
  fingerprint,
  oauthOf,
  expiresInH,
  rotatorRoot,
  SlotKeychainWriteError,
  type RotatorState,
  type CredentialBlob,
} from './slots'
import { readLiveBlobWithSource } from './live'
import { switchLiveTo } from './rotate'
// TRDD-GY0LJV6S — the statusline disjunct. `RotatorState` satisfies `RotatorAdmissionView`
// structurally, so the guard needs no adapter and no second view of "who is live".
import {
  freshestAdmissibleUsage,
  type AdmissibleUsage,
  type UsageObservation,
} from '@/lib/statusline-admissible'
import { listStatuslineSnapshots, STATUSLINE_FRESH_MS } from '@/lib/statusline-store'
import {
  accountEmail,
  usageRequest,
  refreshOauthToken,
  util,
  scopedLimits,
  worstScopedPercent,
  earliestResetMs,
  type NetworkDeps,
} from './network'
import * as fs from 'fs'
import * as path from 'path'

// ── Thresholds (rotator.py defaults; see file header for why they are constants here) ────────
/** Rotate the live account AWAY once EITHER window crosses this % (proactive, pre-429). */
const SWITCH_AT_5H = 97
const SWITCH_AT_7D = 97
/** Only rotate ONTO an alternate below this % on BOTH windows (never jump onto a maxed one). */
const SAFE_5H = 90
const SAFE_7D = 90
/** Same two thresholds, applied to a MODEL-SCOPED weekly window (Fable 5 has one of its own).
 * A scoped window IS a weekly window, so it inherits the 7d numbers rather than getting invented
 * ones — named separately only so the two can diverge the day tuning wants them to. */
const SWITCH_AT_SCOPED = SWITCH_AT_7D
const SAFE_SCOPED = SAFE_7D
/** Anti-thrash: minimum seconds between two auto-switches. */
const MIN_DWELL_S = 60
/** A token within this many hours of its LOCAL expiresAt (or past it) counts as dead/dying —
 * API-independent, so rotation fires even when /usage is unreachable. */
const EXPIRY_GRACE_H = 0.5
/** Keepalive horizon: refresh an idle slot once its runway drops below this many hours. */
const KEEPALIVE_AHEAD_H = 6
/** Consecutive keepalive-refresh failures after which a present-but-failing refresh token is
 * treated as dead (escalated to the human REAUTH nudge by the cascade). */
/** Consecutive failed refreshes after which a slot's refresh token is treated as DEAD — only a
 *  human re-login repairs it. Exported so the dashboard's account list calls a token dead on the
 *  SAME threshold the tick does; a UI with its own number would eventually disagree with the
 *  mechanism it is reporting on, and the owner would be told to re-login an account the rotator
 *  still considers healthy (or worse, the reverse). */
export const MAX_REFRESH_FAILURES = 3
/** A live-account 429 must persist across this many consecutive ticks before it is believed
 * (a single 429 is often the usage endpoint's own throttle, not a real limit). */
const LIVE_429_DEBOUNCE = 2
/** Freshness window for the session identity beacon; older than this and it is ignored. */
const BEACON_MAX_AGE_S = 24 * 3600

/** What the tick concluded — feeds DXJZM3BW's `status.next_action`. */
export type NextAction = 'ok' | 'rotating' | 'reauth-needed'

/**
 * WHY `reauth-needed` needs a reason: the same word covers two failures with OPPOSITE owners.
 *  - `refresh-dead`     — the credential really is unrecoverable; a HUMAN must re-login.
 *  - `slot-unreadable`  — the slot could not be READ from this process at all (keychain ACL,
 *                         locked login keychain, a security session the daemon isn't in). The
 *                         credential may be perfectly healthy; nothing a re-login fixes.
 * Collapsing them sent a human to re-login for a defect on the SERVER's side. `slot-unreadable`
 * therefore takes precedence when both are present: a fault we caused must never be reported as
 * a chore we are handing to the user.
 */
export type TickReason = 'refresh-dead' | 'slot-unreadable'

/**
 * WHY `stuck` exists (TRDD-RFQFCCU4). "Nothing was rotatable" was reported ONLY through
 * `decide()`, i.e. to the log — it never reached `TickResult`, so `runTick` computed
 * `decision: 'no action needed'` and `nextAction: 'ok'` for a fleet with NOTHING left to rotate
 * to. A fully exhausted fleet reported itself HEALTHY.
 *
 * That is the same failure the comment further down was written to fix one level lower ("must not
 * say 'no action needed' while nextAction is reauth-needed — that reads as health and is how this
 * stayed unexamined"), still present one level up. It stayed hidden through the 2026-08-02
 * incident only by luck: two slots happened to be dead-refresh, which forced `reauth-needed`
 * anyway. Three HEALTHY-but-maxed accounts would have read `ok` while every session stalled.
 *
 *  - `all-maxed`             — the API is reachable and no alternate is healthy + below threshold.
 *  - `cannot-rotate-offline` — the live credential is locally expired and the API is unreachable.
 *  - `drain-guard-hold`      — a rotation was DECLINED by the drain-guard: the live account still
 *                              has headroom and a working token, and rotating for a local expiry
 *                              alone would have spent the last healthy alternate.
 * They are separated because the OWNER differs: the first waits for a window, the second needs a
 * human. Collapsing them would re-create the ambiguity `TickReason` already exists to avoid.
 *
 * WHY THE HOLD IS REPORTED RATHER THAN STAYING SILENT (TRDD-GY0LJV6S). It satisfies this type's
 * own definition — the tick WANTED to rotate (`near`) and did not — and nothing else in the beat
 * can see it: `surveyAlternates` (:784) skips the live account, so a LIVE credential that is
 * expiring is invisible to it, and `keepaliveRefresh` (:469) never refreshes the live account by
 * design. Left silent, the beat would report `nextAction: 'ok'` and `'no action needed'` for
 * precisely the state that preceded the 2026-08-02 lockout — which is the defect documented in
 * this very comment block, re-created one branch further along. `server-tick.ts:185` turns it into
 * `rotator-stuck:drain-guard-hold`, and alert-delivery's per-code escalating backoff is what keeps
 * a condition that can hold for many ticks from becoming a 60-second siren.
 */
export type StuckReason = 'all-maxed' | 'cannot-rotate-offline' | 'drain-guard-hold'

/**
 * PURE. The beat's one-line verdict. Extracted from `runTick` (TRDD-RFQFCCU4) because this is the
 * EXACT site of the defect and it was unreachable to a test: driving it through `runTick` needs
 * real credential I/O, so every existing test stubs the whole tick and the derivation itself was
 * pinned by nothing.
 *
 * PRECEDENCE, and why it is this way:
 *   switched > reason > stuck > refreshed > idle
 * `reason` outranks `stuck` where both hold, because a dead credential names an ACTIONABLE human
 * chore while `all-maxed` only names a wait. `stuck` outranks `refreshed`/idle because a tick that
 * WANTED to rotate and could not is the most urgent thing this beat can observe — and before this
 * it was the one outcome that produced the string `'no action needed'`, i.e. the fleet reporting
 * itself healthy while it was about to stall completely.
 */
export function deriveDecision(f: {
  switched: boolean
  reason?: TickReason
  stuck?: StuckReason
  unreadable: number
  deadRefresh: number
  refreshedCount: number
}): string {
  if (f.switched) return 'rotated the live account'
  if (f.reason === 'slot-unreadable') {
    return `reauth-needed: ${f.unreadable} alternate slot(s) UNREADABLE from this process — credential access, not a re-login`
  }
  if (f.reason === 'refresh-dead') {
    return `reauth-needed: ${f.deadRefresh} alternate slot(s) have a dead refresh and are expiring — a human must re-login`
  }
  if (f.stuck === 'all-maxed') {
    return 'STUCK: live account is exhausted and no alternate is healthy + below the safe threshold — all paid accounts maxed'
  }
  if (f.stuck === 'cannot-rotate-offline') {
    return 'STUCK: live credential is locally expired and the API is unreachable — cannot rotate; manual re-auth needed'
  }
  if (f.stuck === 'drain-guard-hold') {
    return 'HOLDING: the live account still has headroom and a working token, but its stored copy is expiring and at most one healthy alternate remains — not spending the last one on a local expiry; re-login the live account before its stored copy dies'
  }
  if (f.refreshedCount) return `refreshed ${f.refreshedCount} slot(s)`
  return 'no action needed'
}

export interface TickResult {
  /** The one-line status the continuity CLI surfaces. */
  nextAction: NextAction
  /** Why `nextAction` is `reauth-needed`; absent for `ok` / `rotating`. */
  reason?: TickReason
  /** Set when the tick WANTED to rotate and could not. Absent when no rotation was needed —
   *  "did not need to rotate" and "could not rotate" are opposite facts. */
  stuck?: StuckReason
  /** Emails whose slot token was keepalive-refreshed this tick. */
  refreshed: string[]
  /** True iff the live credential was switched to an alternate this tick. */
  switched: boolean
  /** The terminal decision line (also emitted via deps.decide). */
  decision: string
}

/**
 * Injected seams so a unit test is 0-IMPACT and deterministic:
 *  - `fetchImpl` stubs every OAuth HTTP call (network.ts default = the platform fetch);
 *  - `now` is seconds-since-epoch (default Date.now()/1000) for dwell / beacon staleness —
 *    matching rotator.py's time.time();
 *  - `decide` captures the one terminal decision line (default = console).
 * The credential I/O (slots/live) is the real module; a test forces it 0-IMPACT via the
 * E-layer's `CLAUDE_SAFE_STORAGE_BACKEND=none` + temp-`HOME` guards, never a mock.
 */
export interface TickDeps {
  fetchImpl?: typeof fetch
  now?: () => number
  decide?: (msg: string) => void
  /**
   * The statusline observations, injectable so a test can drive the disjunct below with no fs.
   * Defaults to the real store. Returning `[]` is how a test says "no statusline signal", which
   * must be indistinguishable from today's behaviour — see `statuslineNear`. (TRDD-GY0LJV6S)
   */
  readSnapshots?: () => Promise<UsageObservation[]>
}

function nowS(deps?: TickDeps): number {
  return deps?.now ? deps.now() : Date.now() / 1000
}
function decide(deps: TickDeps | undefined, msg: string): void {
  ;(deps?.decide ?? ((m: string) => console.log(`[oauth-rotator] ${m}`)))(msg)
}
function netDeps(deps?: TickDeps): NetworkDeps {
  return deps?.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}
}

/**
 * Does the STATUSLINE, on its own, give a reason to rotate? — TRDD-GY0LJV6S.
 *
 * ── IT MAY ONLY EVER ADD A REASON, NEVER REMOVE ONE ──────────────────────────────────────────────
 * `false` here means "no statusline signal", NOT "the account is fine". That asymmetry is the whole
 * design and it is not a compromise: the one `usageRequest` below supplies FOUR things and the
 * statusline can carry two. The model-scoped weekly windows (`worstScopedPercent` — Fable 5 has a
 * weekly limit appearing in NEITHER top-level bucket, TRDD-JI7F1236) and `liveStatus` (the 429
 * debounce, the 401/403 token-REJECTED branch, `networkUp`) are ENDPOINT-ONLY. So a statusline
 * reading of "5h=10%" cannot license "not near" — the account may be fully spent on one model, or
 * its token already rejected. Only a POSITIVE at-threshold reading is actionable, and it is used as
 * a pure disjunct so it can never subtract from the endpoint's verdict.
 *
 * ── WHY IT CALLS `isNearLimit` INSTEAD OF COMPARING TO SWITCH_AT_5H ITSELF ────────────────────────
 * One predicate, never two. A second copy of the threshold logic is precisely how a limit gets
 * raised in one place and not the other. `scoped: null` is not a gap being papered over — it is
 * that function's documented contract ("unknown usage never trips it"), which is exactly true of a
 * source that structurally cannot observe the scoped windows.
 *
 * Returns null for the usage when nothing is admissible, so the caller can log WHY it stayed quiet.
 */
export async function statuslineNear(
  state: RotatorState,
  deps?: TickDeps,
): Promise<{ near: boolean; usage: AdmissibleUsage | null }> {
  let snapshots: UsageObservation[]
  try {
    snapshots = deps?.readSnapshots ? await deps.readSnapshots() : await listStatuslineSnapshots()
  } catch {
    // FAIL-SOFT, deliberately. An unreadable statusline store must leave the rotator exactly as it
    // was before this card — never rotate, never block a rotation the endpoint would have made.
    return { near: false, usage: null }
  }
  // ⚠ MILLISECONDS. `deps.now()` is this module's clock and it returns SECONDS (`nowS` divides
  // Date.now() by 1000, matching Python's time.time() for the janitor daemon), while a snapshot's
  // `capturedAt` is epoch ms. Converting HERE keeps one injectable clock instead of two; passing
  // `nowS(deps)` straight through would be wrong by 1000× and — as in `admitSnapshot`'s own unit
  // trap — wrong in the direction that makes every sample look ancient, silently disabling this
  // whole path while reading as a working check.
  const nowMs = deps?.now ? deps.now() * 1000 : Date.now()
  const usage = freshestAdmissibleUsage(snapshots, state, {
    now: nowMs,
    maxAgeMs: STATUSLINE_FRESH_MS,
  })
  if (usage === null) return { near: false, usage: null }
  return { near: isNearLimit(usage.fiveHourPct, usage.sevenDayPct, null), usage }
}

// ── Pure decision helpers (faithful ports; unit-testable with no I/O) ────────────────────────

/** True iff the blob's token is at/within EXPIRY_GRACE_H of its LOCAL expiresAt (or past it).
 * A blob with no datable expiry returns false — never declare a token dead on missing data. */
export function blobLocallyExpired(blob: unknown): boolean {
  const e = expiresInH(blob)
  return e !== null && e <= EXPIRY_GRACE_H
}

/** The LIVE account is "near a limit" once ANY window crosses its switch threshold. Unknown
 * (null) usage never trips it — only a positive over-threshold signal rotates.
 *
 * `scoped` is the worst MODEL-SCOPED window (`worstScopedPercent`), and it is a REQUIRED
 * parameter rather than an optional one on purpose: a caller that forgets it would silently get
 * the old two-bucket blindness back, which is exactly the bug this closes (TRDD-JI7F1236). Fable
 * 5 has its own weekly window that appears in NEITHER top-level bucket, so an account can be
 * fully spent on it while 5h/7d read low. */
export function isNearLimit(fh: number | null, sd: number | null, scoped: number | null): boolean {
  return (
    (fh !== null && fh >= SWITCH_AT_5H) ||
    (sd !== null && sd >= SWITCH_AT_7D) ||
    (scoped !== null && scoped >= SWITCH_AT_SCOPED)
  )
}

/** An alternate is a safe TARGET only if below SAFE on EVERY window — the two top-level buckets
 * and every model-scoped one. Without the scoped check we would rotate ONTO an account whose
 * Fable-5 window is exhausted, and every call on that model would fail (TRDD-JI7F1236).
 *
 * A null `scoped` means the response reported no scoped window (or none with a number), which is
 * NOT the same as an unknown bucket: it disqualifies nothing. That mirrors the null-discipline
 * above — only a positive over-threshold reading acts. The caller already rejects an alternate
 * whose 5h/7d are unknown before reaching here. */
export function isSafeAlternate(bfh: number, bsd: number, scoped: number | null): boolean {
  return bfh < SAFE_5H && bsd < SAFE_7D && (scoped === null || scoped < SAFE_SCOPED)
}

/** DRAIN-FIRST: among healthy candidates `[email, blob, util5h, util7d]`, pick the one closest
 * to its own limit (highest max-of-windows) so partially-spent accounts drain before fresh
 * ones. Stable on ties (first wins). Pure. Returns null when empty. */
export type Candidate = [string, CredentialBlob, number, number]
export function selectDrainFirst(candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null
  for (const c of candidates) {
    if (best === null || Math.max(c[2], c[3]) > Math.max(best[2], best[3])) best = c
  }
  return best
}

/** THE DRAIN-GUARD (TRDD-GY0LJV6S). True when rotating would spend the fleet's last healthy
 * alternate for LOCAL EXPIRY ALONE, off an account that still has real headroom.
 *
 * THE INCIDENT it exists for (2026-08-01): the rotator twice moved off `fmuaddib` — at 39%/24%,
 * then 9%/38% — purely because its stored token was expiring. When the target maxed out there was
 * no way back: by then `fmuaddib`'s slot copy was 10.9 days expired with 69 consecutive refresh
 * failures. The ACCOUNT had headroom the whole time; the rotator's copy of the key was dead.
 *
 * WHY REFUSING IS SAFE — this is the whole argument, and it rests on one measured fact. The
 * predicate is only ever consulted after `usageRequest` returned 200 USING THE LIVE TOKEN, so the
 * token demonstrably works right now and `liveExpired` is a PREDICTION of failure, not an
 * observation of one. When the prediction comes true the endpoint answers 401/403 — a different
 * branch, where `expiryOnly` is false and this guard does not apply. So a hold costs at most one
 * 60 s tick of latency after a REAL failure, and buys not spending the escape hatch on a failure
 * that has not happened.
 *
 * `viableTargets` COUNTS USAGE-CONFIRMED CANDIDATES ONLY, NEVER THE `degraded` BUCKET. A degraded
 * slot is "not provably dead", which is not "healthy" — and a paper spare that was dead in fact IS
 * the incident. Counting them would license the worst shape of all: with 0 confirmed candidates
 * and 2 degraded ones, an account working at 9% usage would be rotated onto a target whose usage
 * is unknown, for an expiry that had not yet happened.
 *
 * NULL DISCIPLINE, mirroring `isNearLimit`: unknown usage never TRIPS a rotation, and here it must
 * never SUPPRESS one either — an account we cannot measure is not an account we can call
 * low-usage. "Low usage" is `isSafeAlternate`, i.e. the rotator's own "would I rotate ONTO this?"
 * test, so no new threshold is invented and the 90-97 band is deliberately UNPROTECTED: an account
 * at 95% has no headroom worth saving. Pure.
 *
 * ⚠ THE NULL CHECK IS ALSO THE ESCAPE HATCH'S SECOND LOCK, which is worth knowing before anyone
 * "simplifies" it. `httpJson` returns `{ status, json: null }` for ANY non-2xx (network.ts:133), so
 * on every branch other than 200 the usage windows are structurally null and this predicate
 * declines regardless of `expiryOnly`. Measured: forcing `expiryOnly = true` in the 401 branch
 * reddens NOTHING, because this line has already refused. The two locks are independent, and
 * removing either leaves the hatch open — but only on paper, which is why neither is pinned by the
 * other's test. See the neuter record in `tests/unit/oauth-rotator-drain-guard.test.ts`. */
export function drainsLastEscapeHatch(f: {
  /** `near` is true SOLELY because the live token is locally expiring. Set only where the usage
   *  endpoint answered 200, so 5h / 7d / scoped are KNOWN and below their switch thresholds. */
  expiryOnly: boolean
  fh: number | null
  sd: number | null
  scoped: number | null
  /** Usage-confirmed safe alternates. NOT `degraded` — see above. */
  viableTargets: number
}): boolean {
  if (!f.expiryOnly) return false
  if (f.fh === null || f.sd === null) return false // unmeasurable ≠ low-usage
  if (!isSafeAlternate(f.fh, f.sd, f.scoped)) return false // no headroom worth protecting
  // `<= 1`: spares remaining after a rotation are `viableTargets - 1`, so "the target would become
  // the last healthy slot" is exactly 1. Zero is included because the honest report there is this
  // hold, not `all-maxed` — which would claim the live account is exhausted while it reads 9%.
  return f.viableTargets <= 1
}

// ── The session identity beacon (F1 anchor; rotate.ts writes it, we read it) ─────────────────
function liveIdentityPath(): string {
  return path.join(rotatorRoot(), 'live-identity.json')
}

/** The last session-stamped live identity `{fp, email, ts}`, or null when absent/garbage/stale.
 * A stale beacon may predate a /login, so trusting it would recreate the wrong-identity bug. */
export function readLiveIdentityBeacon(deps?: TickDeps): { fp: string; email?: string; ts: number } | null {
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(liveIdentityPath(), 'utf8'))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const d = data as { fp?: unknown; ts?: unknown; email?: unknown }
  if (typeof d.fp !== 'string' || !d.fp) return null
  if (typeof d.ts !== 'number') return null
  if (nowS(deps) - d.ts > BEACON_MAX_AGE_S) return null
  // fp/ts are proven present + typed above; email stays optional.
  return { fp: d.fp, ts: d.ts, email: typeof d.email === 'string' ? d.email : undefined }
}

// ── Slot refresh + heal (the shared kernel of cmd_auto's two refresh paths) ──────────────────
/**
 * Refresh ONE slot's token and heal both stores. Returns `[freshBlob | null, indexChanged]`:
 * null when the grant yielded nothing (the caller decides degraded-keep vs drop). On success
 * the fresh token is mirrored via writeSlot and the state-index meta (fp/expires_at/
 * refresh_failures=0) is updated in `state` — the caller MUST saveState BEFORE any switchLiveTo
 * (which re-loads state from disk). FAIL-SOFT: a locked/declined keychain returns the fresh
 * token for in-memory use (a rotation writes a DIFFERENT keychain item, so a refused slot-write
 * never blocks the decision). Faithful port of `_refresh_and_heal_slot`.
 */
async function refreshAndHealSlot(
  email: string,
  blob: CredentialBlob,
  state: RotatorState,
  deps?: TickDeps,
): Promise<[CredentialBlob | null, boolean]> {
  const refreshed = await refreshOauthToken(blob, netDeps(deps))
  if (refreshed === null) return [null, false]
  try {
    writeSlot(email, refreshed)
  } catch (exc) {
    if (exc instanceof SlotKeychainWriteError) {
      decide(deps, `[auto] ${email}: keychain write refused after refresh (${exc.message}) — using fresh token in-memory`)
      return [refreshed, false]
    }
    throw exc
  }
  const slots = state.slots as unknown as Record<string, Record<string, unknown>> | undefined
  const meta = slots?.[email]
  if (meta && typeof meta === 'object') {
    meta.fp = fingerprint(refreshed)
    meta.expires_at = oauthOf(refreshed).expiresAt ?? null
    meta.refresh_failures = 0 // a successful exchange clears the dead-refresh counter (TRDD-HJGR4I5W)
    return [refreshed, true]
  }
  return [refreshed, false]
}

// ── Ground-truth reconcile: make state.json agree with the ACTUAL live credential ────────────
/** Faithful port of `_reconcile_live_email`. Cheap in steady state (local fp compare, no
 * network, no write); calls /roles at most once per genuine drift. Leaves state UNTOUCHED when
 * the credential changed but its account is unresolvable, so the drift stays detectable (F5). */
async function reconcileLiveEmail(state: RotatorState, liveBlob: CredentialBlob, deps?: TickDeps): Promise<RotatorState> {
  const realFp = fingerprint(liveBlob)
  if (state.live_fp === realFp) return state // steady state — no drift
  const oldEmail = state.live_email
  let realEmail = await accountEmail(liveBlob, netDeps(deps))
  if (!realEmail) {
    for (const em of Object.keys(state.slots ?? {})) {
      const sb = readSlot(em)
      if (sb && fingerprint(sb) === realFp) { realEmail = em; break }
    }
  }
  if (!realEmail) {
    decide(deps, `auto: live credential CHANGED (fp ${state.live_fp ?? '?'} -> ${realFp}) but its account is UNRESOLVABLE — leaving state unreconciled so the drift stays detectable; will retry next tick (F5)`)
    return state
  }
  state.live_email = realEmail
  state.live_fp = realFp
  state.live_429_streak = 0
  state.last_reconcile_at = nowS(deps)
  saveState(state)
  decide(deps, `auto: reconciled live account — state said ${JSON.stringify(oldEmail)} but the real live credential is ${JSON.stringify(realEmail)}; state.json corrected`)
  return state
}

// ── Mirror-source identity resolution (F1/F2: the primary was unreadable) ────────────────────
/** Faithful port of `_resolve_untrusted_live`. Returns `[probeBlob | null, state]`: a token OF
 * THE TRUE LIVE ACCOUNT to usage-probe, or null → the caller MUST stay put this tick (a wrong
 * stay-put costs one tick; a wrong rotation on a phantom identity is the incident this guards). */
async function resolveUntrustedLive(mirrorBlob: CredentialBlob, state: RotatorState, deps?: TickDeps): Promise<[CredentialBlob | null, RotatorState]> {
  decide(deps, 'auto: ⚠ primary live credential UNREADABLE from this context — using the -livebak MIRROR; identity untrusted until independently resolved (F1)')
  const beacon = readLiveIdentityBeacon(deps)
  const mirrorFp = fingerprint(mirrorBlob)
  if (beacon !== null) {
    const bFp = beacon.fp
    const bEmail = beacon.email
    if (bFp === mirrorFp) {
      if (typeof bEmail === 'string' && bEmail && state.live_email !== bEmail) {
        state.live_email = bEmail
        state.live_fp = bFp
        state.live_429_streak = 0
        saveState(state)
        decide(deps, `auto: live identity confirmed via session beacon: ${bEmail} (mirror == live credential)`)
      }
      return [mirrorBlob, state]
    }
    if (typeof bEmail === 'string' && bEmail) {
      if (state.live_email !== bEmail || state.live_fp !== bFp) {
        state.live_email = bEmail
        state.live_fp = bFp
        state.live_429_streak = 0
        saveState(state)
      }
      decide(deps, `auto: live identity from session beacon: ${bEmail} — the mirror holds a DIFFERENT credential; probing the live account via its slot token (F2)`)
      const twin = readSlot(bEmail)
      if (twin !== null && !blobLocallyExpired(twin)) return [twin, state]
      if (twin !== null && oauthOf(twin).refreshToken) {
        const [refreshed, healed] = await refreshAndHealSlot(bEmail, twin, state, deps)
        if (refreshed !== null && !blobLocallyExpired(refreshed)) {
          if (healed) saveState(state)
          return [refreshed, state]
        }
      }
      decide(deps, `auto: live account ${bEmail} has no usable slot twin to probe — staying put this tick (fail-safe)`)
      return [null, state]
    }
  }
  const mEmail = await accountEmail(mirrorBlob, netDeps(deps))
  decide(deps, `auto: live identity UNKNOWABLE (no fresh session beacon; the mirror resolves to ${mEmail ?? 'unresolvable'} but its relation to the account in use is unknown) — staying put rather than deciding on an untrusted identity (F1)`)
  return [null, state]
}

// ── RENEW: keepalive-refresh idle slot tokens nearing expiry (F2b) ───────────────────────────
/** Faithful port of `_keepalive_refresh`. For each ALTERNATE slot with a refresh token within
 * KEEPALIVE_AHEAD_H of expiry, exchange it and write it back. The LIVE account is never
 * refreshed here (Claude Code owns its single-use rotating grant). Best-effort; never throws.
 * Returns the emails refreshed. */
export async function keepaliveRefresh(deps?: TickDeps): Promise<string[]> {
  const actions: string[] = []
  const state = loadState()
  const slots = (state.slots ?? {}) as unknown as Record<string, Record<string, unknown>>
  const liveEmail = state.live_email
  let changed = false
  for (const email of Object.keys(slots)) {
    if (email === liveEmail) continue // never refresh the live account out from under Claude
    const blob = readSlot(email)
    if (!blob) continue
    const inner = oauthOf(blob)
    if (!(inner.refreshToken || inner.refresh_token)) continue // setup-token slot — unrefreshable
    const eh = expiresInH(blob)
    if (eh === null || eh > KEEPALIVE_AHEAD_H) continue // ample runway (or undatable)
    // STOP RETRYING A TOKEN ALREADY CLASSIFIED DEAD. Observed 2026-07-29: a slot whose refresh
    // token really was dead sat at MAX_REFRESH_FAILURES and kept getting one OAuth round-trip per
    // 60 s beat anyway — its counter went 1 -> 26 in 25 minutes and would have grown forever. The
    // cascade had ALREADY concluded "a human must re-login"; continuing to ask the endpoint cannot
    // change that answer, so every one of those calls was pointless traffic against a known-dead
    // credential.
    //
    // The gate is keyed on the FINGERPRINT that failed, not merely on the count, because a gate
    // that never un-gates is worse than the retries it replaces: a human re-login writes a NEW
    // blob with a different fp, and this slot must resume refreshing the instant that happens —
    // otherwise the one action that fixes it would be silently ignored.
    const meta0 = slots[email] as Record<string, unknown> | undefined
    const fails0 = typeof meta0?.refresh_failures === 'number' ? meta0.refresh_failures : 0
    if (fails0 >= MAX_REFRESH_FAILURES && meta0?.refresh_dead_fp === fingerprint(blob)) continue
    const fresh = await refreshOauthToken(blob, netDeps(deps))
    if (fresh === null) {
      // A refresh that keeps failing is dead — count it so the cascade escalates to REAUTH, and
      // record WHICH credential failed so a replacement is retried rather than inheriting the ban.
      const meta = slots[email]
      if (meta && typeof meta === 'object') {
        meta.refresh_failures = (typeof meta.refresh_failures === 'number' ? meta.refresh_failures : 0) + 1
        meta.refresh_dead_fp = fingerprint(blob)
        changed = true
      }
      continue
    }
    try {
      writeSlot(email, fresh)
    } catch (exc) {
      // THE EXCHANGE ALREADY HAPPENED. `refreshOauthToken` above returned a fresh pair, which
      // means the endpoint accepted — and therefore ROTATED — the old grant (this module's
      // header and reauth-flow.ts:20-21 both state the grant is single-use rotating). So the
      // old token in the slot is ALREADY DEAD, and the previous "kept old token, skipped" was
      // describing a credential that no longer works: every later beat re-presented it, got
      // null, and burned one of MAX_REFRESH_FAILURES until the slot was classified
      // refresh-dead — a slot bricked purely by one transient keychain refusal.
      //
      // Record it as dead IMMEDIATELY instead, against the OLD blob's fingerprint. That is
      // the honest state (the credential really is unusable) and it routes the slot straight
      // to the REAUTH leg a human can act on, rather than three beats of pointless traffic.
      // The fingerprint keying is what lets it recover: a human re-login writes a new blob
      // with a different fp, and the gate above stops applying the instant that happens.
      //
      // And this catch is now TOTAL. The docstring promises "never throws", but the
      // non-SlotKeychainWriteError path re-threw — and `writeSlot`'s NO_KEYCHAIN fallback is
      // a plaintext mkdir/write/chmod/rename, so an ENOSPC or EACCES on a keyring-less host
      // escaped `runTick`, skipped the `saveState` below (losing every mutation this loop had
      // already made) and stopped the beat before `autoRotate` ever ran.
      // ...but mark the slot DEAD only when the grant ACTUALLY rotated.
      //
      // The premise above — "the endpoint accepted and therefore ROTATED the old grant" —
      // is not universally true, and `network.ts:247-251` is explicit about it: a
      // NON-rotating server omits `refresh_token` from the response and we deliberately
      // "keep the old one … so we never lose the ability to refresh again". Against such a
      // server the old blob in the slot is still perfectly refreshable, so banning it on a
      // TRANSIENT write failure (a momentarily-locked keychain, where `writeSlot` throws
      // before writing anything) is the brick this branch was written to prevent, merely
      // arrived at from the other side: `refresh_dead_fp` is keyed on the UNCHANGED old
      // blob, so the gate at :559 matches on every later beat, keepalive never retries even
      // once the keychain unlocks seconds later, and only a human re-login clears it.
      //
      // When the grant did NOT rotate we still surface the failure, but leave the slot
      // retryable — the next beat re-presents a credential that genuinely still works.
      const oldRefresh = oauthOf(blob).refreshToken ?? oauthOf(blob).refresh_token
      const newRefresh = oauthOf(fresh).refreshToken ?? oauthOf(fresh).refresh_token
      const grantRotated = Boolean(newRefresh) && newRefresh !== oldRefresh
      const meta = slots[email]
      if (meta && typeof meta === 'object' && grantRotated) {
        meta.refresh_failures = MAX_REFRESH_FAILURES
        meta.refresh_dead_fp = fingerprint(blob)
        changed = true
      }
      const why = exc instanceof SlotKeychainWriteError ? 'keychain write refused' : 'slot write failed'
      decide(
        deps,
        `[keepalive] ${email}: ${why} (${exc instanceof Error ? exc.message : String(exc)}) — the refreshed token could not be stored; ` +
          (grantRotated
            ? 'the old grant was rotated by the exchange and is now dead, so the slot needs re-login'
            : 'the endpoint did not rotate the grant, so the stored credential still works and the next beat will retry'),
      )
      continue
    }
    const meta = slots[email]
    if (meta && typeof meta === 'object') {
      meta.fp = fingerprint(fresh)
      meta.expires_at = oauthOf(fresh).expiresAt ?? null
      meta.refresh_failures = 0 // a successful exchange clears the dead-refresh counter
      delete meta.refresh_dead_fp // ...and the fingerprint that earned the retry ban
      changed = true
    }
    actions.push(email)
  }
  if (changed) saveState(state)
  return actions
}

// ── ROTATE: usage-based swap of the live credential to a safe alternate (cmd_auto) ───────────
/** Faithful port of `cmd_auto`. No-op unless the live account is near a limit / expiring /
 * rejected AND a safer alternate exists. Reads quota from /api/oauth/usage (zero inference
 * cost), never switches onto an account itself near a limit, honours the dwell guard, and
 * fails safe (unknown usage never triggers a switch). Returns true iff a switch occurred. */
export async function autoRotate(
  deps?: TickDeps,
  /** OUT-param, deliberately ADDITIVE (TRDD-RFQFCCU4). This function is exported and has one
   *  internal call site, so widening the RETURN type would break every existing caller and test
   *  for a fact only `runTick` consumes. An optional out-param leaves them all untouched: callers
   *  that do not pass it observe byte-identical behaviour. Written ONLY on a stuck path. */
  out?: { stuck?: StuckReason },
): Promise<boolean> {
  let state = loadState()
  const [liveBlobRaw, liveSrc] = readLiveBlobWithSource()
  let liveBlob = liveBlobRaw
  if (liveBlob === null) {
    decide(deps, 'auto: no live credential')
    return false
  }
  if (liveSrc === 'mirror') {
    ;[liveBlob, state] = await resolveUntrustedLive(liveBlob, state, deps)
    if (liveBlob === null) return false // identity unknowable this tick — already logged
  } else {
    state = await reconcileLiveEmail(state, liveBlob, deps)
  }
  const liveEmail = state.live_email
  const [liveStatus, liveData] = await usageRequest(liveBlob, netDeps(deps))
  const fh = util(liveData, 'five_hour')
  const sd = util(liveData, 'seven_day')
  // The worst MODEL-SCOPED window (Fable 5 has its own weekly limit, reachable only via
  // `limits[]` — the flat `seven_day_opus`-style keys are null). Without it an account fully
  // spent on one model reads as healthy on both buckets. TRDD-JI7F1236.
  const sc = worstScopedPercent(liveData)
  const scWorst = scopedLimits(liveData).reduce<{ model: string; percent: number } | null>(
    (w, l) => (l.percent !== null && (w === null || l.percent > w.percent) ? { model: l.model, percent: l.percent } : w),
    null,
  )
  const fhS = fh !== null ? `${Math.round(fh)}%` : '?'
  const sdS = sd !== null ? `${Math.round(sd)}%` : '?'
  const scS = scWorst !== null ? ` ${scWorst.model}=${Math.round(scWorst.percent)}%` : ''
  const liveExpired = blobLocallyExpired(liveBlob)
  const networkUp = liveStatus !== 0
  // Must be read after RECONCILIATION (`:546`/`:549`) — not, as an earlier version of this comment
  // claimed, "after the endpoint call". The endpoint call sits between them and contributes nothing
  // to it; the requirement is only that `state` already carries the reconciled `live_fp` /
  // `last_switch_at` the admissibility guard compares against, since a snapshot is admitted
  // relative to WHO IS LIVE NOW and a pre-reconciliation state would judge it by the wrong account.
  // The distinction matters because the wrong version invites someone to preserve an ordering
  // constraint that does not exist while moving the one that does.
  //
  // ⚠ THE RESULT IS OBSERVED, NOT ACTED ON — see the two ⛔ blocks below. `sl` feeds the log line
  // only. That is deliberate: it makes the misattribution measurable in production before anyone
  // re-lands a debounced version. Never throws (fail-soft inside), so it cannot break a tick.
  const sl = await statuslineNear(state, deps)
  const slDesc = sl.usage !== null
    ? ` [statusline 5h=${Math.round(sl.usage.fiveHourPct)}%${sl.usage.sevenDayPct !== null ? ` 7d=${Math.round(sl.usage.sevenDayPct)}%` : ''}${sl.near ? ' OVER-THRESHOLD' : ''}]`
    : ''

  let near: boolean
  let liveDesc: string
  // THE DRAIN-GUARD's precondition, assigned in exactly ONE branch on purpose: only the 200 arm
  // has KNOWN usage, so only there can "the sole reason to rotate is a local expiry" be a FACT
  // rather than an absence of data. It stays false for 429 / 401 / 403 / unreachable — and that is
  // precisely what makes the escape hatch work: a token that really has died answers 401, lands in
  // a branch this flag never reaches, and rotates. See `drainsLastEscapeHatch`.
  let expiryOnly = false
  if (liveStatus === 429) {
    const streak = (typeof state.live_429_streak === 'number' ? state.live_429_streak : 0) + 1
    state.live_429_streak = streak
    saveState(state)
    if (streak < LIVE_429_DEBOUNCE) {
      decide(deps, `auto: live ${liveEmail ?? '(live)'} returned 429 (streak ${streak}/${LIVE_429_DEBOUNCE}) — likely a transient usage-endpoint throttle; deferring rotation`)
      return false
    }
    near = true
    liveDesc = `RATE-LIMITED (429 x${streak})`
  } else if (liveStatus === 200) {
    if (state.live_429_streak) { state.live_429_streak = 0; saveState(state) }
    // The statusline is a PURE DISJUNCT here — it can add a reason to rotate, never remove one.
    // Everything the endpoint said is still consulted, unchanged. See `statuslineNear`.
    // ⛔ NO STATUSLINE DISJUNCT HERE, AND THE ABSENCE IS THE DESIGN — reverted from `d17fffbd`
    // after adversarial review. `usageRequest` with the LIVE token has just returned 200, so it is
    // ground truth for the exact two windows the statusline carries. When they disagree the
    // statusline is wrong BY CONSTRUCTION (misattribution or lag), and a source that can never
    // legitimately override the answer already in hand adds no TRUE reason here — only a false one.
    //
    // And the false one is near-deterministic, not hypothetical. The stamp records who was live at
    // ARRIVAL, not who produced the report (see `lib/statusline-admissible.ts`, and TRDD-GY0LJV6S's
    // own "two things it does NOT do"). Sessions running when we switch A→B keep A's token in
    // memory — they are not retro-fixed — and go on reporting A's ~98% for as long as they live.
    // Ingest stamps those with B's fp, post-switch, so BOTH guards admit them. A disjunct here
    // would read 98% on a fresh B and rotate straight back out, per account, until the fleet is
    // spent: the exact burn loop TRDD-SIV45HOG exists to prevent, re-entered through its own guard.
    //
    // `MIN_DWELL_S` is not the backstop it looks like: `last_switch_at` is written ONLY inside
    // `switchLiveTo` (rotate.ts:44), so a rotation that finds no candidate leaves the dwell
    // untouched and the next tick retries immediately.
    const usageNear = isNearLimit(fh, sd, sc)
    // ⚠ `&& !usageNear` is REDUNDANT TODAY, and measured as such: neutering it to
    // `expiryOnly = liveExpired` leaves all 15 drain-guard tests GREEN. It cannot be otherwise —
    // `isNearLimit` trips when SOME window is >= SWITCH (97) while `isSafeAlternate` (the guard's
    // "low usage" test) requires EVERY window < SAFE (90), so `usageNear` implies `!isSafeAlternate`
    // and the guard already declines. It is kept because it makes the variable TRUE TO ITS NAME —
    // "expiry was the sole reason" — which is the claim `drainsLastEscapeHatch` documents and
    // reasons from, and because it becomes load-bearing the moment anyone reorders the two
    // thresholds. Do not read the green suite as cover for deleting it.
    expiryOnly = liveExpired && !usageNear
    near = usageNear || liveExpired
    liveDesc = `5h=${fhS} 7d=${sdS}${scS}${liveExpired ? ' +LOCALLY-EXPIRING' : ''}${slDesc}`
  } else if (liveStatus === 401 || liveStatus === 403) {
    near = true
    liveDesc = `token REJECTED (HTTP ${liveStatus}) — expired/invalid`
  } else if (liveExpired) {
    near = true
    liveDesc = `LOCALLY EXPIRED + API unreachable (status ${liveStatus})`
  } else {
    // ⛔ ALSO REVERTED from `d17fffbd`: an `else if (sl.near)` sat here and rotated when the usage
    // endpoint was unreachable but the statusline read at/over threshold. Unlike the 200 branch
    // above, that one is genuinely ADDITIVE — the endpoint said nothing, so the statusline is the
    // only signal — and it is worth re-landing. It is reverted anyway because it inherits the SAME
    // misattribution: the trigger fires just as readily on an old session's report about the
    // PREVIOUS account, and it is worse here, because with the usage API down every candidate is
    // unevaluable too, so the rotation goes out blind (`degraded`, most-runway-first) and can walk
    // the whole fleet one dwell window at a time instead of stalling on one account.
    //
    // Re-land it with the debounce it lacked: `sl.near` sustained across ≥2 consecutive ticks
    // (mirroring `LIVE_429_DEBOUNCE`, which exists for precisely this "one bad sample must not
    // rotate" reason) plus a statusline-specific dwell well above `MIN_DWELL_S`. That is its own
    // change with its own tests — not a same-turn patch bolted onto the review that found the bug.
    decide(deps, `auto: live ${liveEmail ?? '(live)'} usage unreachable (status ${liveStatus}) but token still valid locally; staying put`)
    return false
  }
  if (!near) {
    decide(deps, `auto: live ${liveEmail ?? '(live)'} ${liveDesc} — within limits`)
    return false
  }
  const last = state.last_switch_at
  if (typeof last === 'number' && (nowS(deps) - last) < MIN_DWELL_S) {
    decide(deps, `auto: live ${liveEmail ?? '(live)'} exhausted (${liveDesc}) but inside dwell window; deferring`)
    return false
  }

  // Build the alternate-candidate list. A safe TARGET is NEVER locally expired; when the
  // network is up we require a fresh /usage 200 below SAFE on both windows (DRAIN-FIRST); when
  // it is DOWN (we are only here because the live token is locally dead) we fall back to LOCAL
  // expiry — any alternate with known future runway, most-runway-first.
  const candidates: Candidate[] = []
  const degraded: Array<[string, CredentialBlob, number]> = [] // (email, blob, expiresInH)
  let indexHealed = false
  for (const email of Object.keys(state.slots ?? {})) {
    if (email === liveEmail) continue
    let b = readSlot(email)
    if (!b) continue
    if (blobLocallyExpired(b)) {
      // RENEW-before-rotate: a lapsed-but-rescuable alternate rejoins the flow if it carries a
      // refresh grant and the network is up; otherwise it is excluded (never rotate onto dead).
      if (!(networkUp && oauthOf(b).refreshToken)) continue
      const [refreshed, healed] = await refreshAndHealSlot(email, b, state, deps)
      if (refreshed === null || blobLocallyExpired(refreshed)) continue
      indexHealed = indexHealed || healed
      b = refreshed
    }
    if (networkUp) {
      let [st2, d2] = await usageRequest(b, netDeps(deps))
      if (st2 !== 200 && st2 !== 429) {
        // REFRESH-ON-ERR net: a non-200/429 probe almost always means the slot's access token
        // expired (401/403). Refresh + re-probe before excluding, so one stale token can't
        // deadlock rotation. 429 is NOT refreshed (maxed account, not an expired token).
        const [refreshed, healed] = await refreshAndHealSlot(email, b, state, deps)
        if (refreshed === null) {
          const eh = expiresInH(b)
          if (oauthOf(b).refreshToken && eh !== null && !blobLocallyExpired(b)) degraded.push([email, b, eh])
          continue
        }
        indexHealed = indexHealed || healed
        b = refreshed
        ;[st2, d2] = await usageRequest(b, netDeps(deps))
      }
      if (st2 !== 200) {
        // 429 → genuinely maxed, drop it. Else (transient probe failure on a FRESH token) →
        // keep as a degraded fallback so one bad probe can't pin the user to a dead live account.
        if (st2 !== 429) {
          const eh = expiresInH(b)
          if (eh !== null && !blobLocallyExpired(b)) degraded.push([email, b, eh])
        }
        continue
      }
      const bfh = util(d2, 'five_hour')
      const bsd = util(d2, 'seven_day')
      if (bfh === null || bsd === null) continue // unknown usage → not a safe target
      // Also reject a candidate whose MODEL-SCOPED window is spent: rotating onto it would look
      // like a healthy switch and then fail every call on that model. TRDD-JI7F1236.
      if (!isSafeAlternate(bfh, bsd, worstScopedPercent(d2))) continue // near a limit → skip
      candidates.push([email, b, bfh, bsd])
    } else {
      const eh = expiresInH(b)
      if (eh === null) continue // cannot confirm validity offline → not a safe degraded target
      degraded.push([email, b, eh])
    }
  }
  if (indexHealed) saveState(state) // before any switchLiveTo (it re-loads state from disk)

  // THE DRAIN-GUARD (TRDD-GY0LJV6S) — the LAST thing before either rotation path, so ONE placement
  // covers BOTH `switchLiveTo` calls below (drain-first and degraded). It has to sit here rather
  // than earlier because it needs the candidate COUNT, and the count is only known once the loop
  // above has probed. A guard placed before the loop would have to guess it.
  //
  // ⚠ IT COUNTS `candidates` ONLY, never `degraded`. Rotating a working low-usage account onto an
  // unevaluable target for an expiry that has not happened is the incident — not the case the
  // degraded fallback exists for ("beats pinning the user to an exhausted/dead live account", and
  // the live account here is neither exhausted nor dead: the endpoint just accepted its token).
  //
  // COST, stated rather than glossed: while this holds, every tick re-probes each alternate, where
  // the pre-guard code would have rotated once and gone quiet. Bounded in the normal case — either
  // Claude Code refreshes the live token (`liveExpired` clears, no rotation was wanted after all)
  // or the token dies (401 → rotate). A blob carrying a bogus `expiresAt` that the endpoint keeps
  // validating holds indefinitely, which is the CORRECT outcome (the token works) but keeps paying
  // the probes. Note also that `refreshAndHealSlot` has no MAX_REFRESH_FAILURES gate — unlike
  // keepalive's (:489) — so a dead-refresh alternate costs one wasted OAuth round-trip per held
  // tick. That is pre-existing in every long `near` state; it is named HERE because this guard is
  // what makes long `near` states common.
  if (drainsLastEscapeHatch({ expiryOnly, fh, sd, scoped: sc, viableTargets: candidates.length })) {
    decide(
      deps,
      `auto: live ${liveEmail ?? '(live)'} ${liveDesc} — DRAIN-GUARD: rotating for a local expiry alone would spend the last healthy alternate (${candidates.length} usage-confirmed); staying put while the token still answers 200. A real token failure returns 401 and rotates on the next tick.`,
    )
    if (out) out.stuck = 'drain-guard-hold'
    return false
  }

  // 1) Best usage-confirmed safe target (DRAIN-FIRST), when the network is up.
  const best = networkUp ? selectDrainFirst(candidates) : null
  if (best !== null) {
    const [targetEmail, targetBlob, bfh, bsd] = best
    const reason = `live ${liveEmail ?? '(live)'} ${liveDesc} -> rotate`
    switchLiveTo(targetEmail, targetBlob, reason)
    decide(deps, `auto: switched ${liveEmail ?? '(live)'} -> ${targetEmail} (target 5h=${Math.round(bfh)}% 7d=${Math.round(bsd)}%; ${reason})`)
    return true
  }
  // 2) DEGRADED fallback — no usage-confirmed target, but a structurally-valid alternate exists.
  // Rotating onto the most-runway one beats pinning the user to an exhausted/dead live account.
  if (degraded.length) {
    let target = degraded[0]
    for (const c of degraded) if (c[2] > target[2]) target = c
    const [targetEmail, targetBlob, targetEh] = target
    const why = networkUp ? 'no usage-confirmed target' : 'no usage; API unreachable'
    const reason = `live ${liveEmail ?? '(live)'} ${liveDesc} -> degraded rotate (${why})`
    switchLiveTo(targetEmail, targetBlob, reason)
    decide(deps, `auto: switched ${liveEmail ?? '(live)'} -> ${targetEmail} (degraded; target token valid ~${targetEh.toFixed(1)}h; ${reason})`)
    return true
  }
  // 3) Genuinely stuck — nothing rotatable in either path.
  if (networkUp) {
    // Name WHEN the soonest window returns. The instant is already in the payload we fetched
    // (`resets_at`, on both buckets and every scoped limit); before TRDD-JI7F1236 this line said
    // "waiting for a window to reset" and could not say when, so the only recourse was to keep
    // polling blindly. Falls back to the old wording when the response carried no timestamp.
    const resetMs = earliestResetMs(liveData)
    const when =
      resetMs === null
        ? 'waiting for a window to reset'
        : `earliest window resets ${new Date(resetMs).toISOString()} (in ~${Math.max(0, (resetMs - Date.now()) / 3_600_000).toFixed(1)}h)`
    decide(deps, `auto: live ${liveEmail ?? '(live)'} exhausted (${liveDesc}) but no alternate is healthy + below safe threshold and none is structurally renewable — all paid accounts maxed; ${when}`)
    // ⚠ UNPINNED BY ANY TEST, and measured as such (TRDD-RFQFCCU4): deleting this line leaves the
    // whole suite green (22 rotator files / 307 tests). Reaching this branch needs real credential
    // I/O — a live account exhausted with no healthy alternate — so `deriveDecision` is tested
    // directly and this ASSIGNMENT is the one link nothing covers. Do not read the green suite as
    // cover for editing it.
    if (out) out.stuck = 'all-maxed'
  } else {
    decide(deps, `auto: live ${liveEmail ?? '(live)'} is LOCALLY EXPIRED and the API is unreachable, but no alternate with a known future expiry exists — cannot rotate; manual re-auth needed`)
    if (out) out.stuck = 'cannot-rotate-offline'
  }
  return false
}

// ── The alternate survey: WHICH slots are faulted, not merely how many ───────────────────────

/** What a sweep of the non-live slots found. EMAILS, not counts — a repair has to know WHOSE slot
 *  to re-capture, and a count cannot say. The tick renders `.length` for its decision line; the
 *  repair leg reads the identities. ONE definition, so the beat that REPORTS a fault and the leg
 *  that FIXES it can never disagree about which slots are faulted. */
export interface AlternateSurvey {
  /** Slots this process could not read AT ALL — a credential-ACCESS fault (the keychain is out of
   *  reach), not something a re-login repairs. */
  unreadable: string[]
  /** Slots whose refresh token is absent or has failed MAX_REFRESH_FAILURES times running AND
   *  whose access token is expired. This is the ONE class a re-capture actually repairs. */
  refreshDead: string[]
}

/** Survey EVERY alternate rather than breaking on the first fault. One unreadable slot is a slot
 * problem; ALL of them unreadable is a process-identity problem (this process cannot reach the
 * keychain at all) — and only a full count can tell those apart. Breaking early made both look
 * identical, so the operator could not distinguish "re-login one account" from "the server has no
 * credential access", which are not even the same person's job. */
export function surveyAlternates(): AlternateSurvey {
  const state = loadState()
  const slots = (state.slots ?? {}) as unknown as Record<string, Record<string, unknown>>
  const unreadable: string[] = []
  const refreshDead: string[] = []
  for (const email of Object.keys(slots)) {
    if (email === state.live_email) continue
    const b = readSlot(email)
    if (!b) { unreadable.push(email); continue } // unreadable alternate → needs attention
    const inner = oauthOf(b)
    const hasRefresh = Boolean(inner.refreshToken || inner.refresh_token)
    // A dead-refresh alternate (no refresh at all, or a refresh whose exchange has failed
    // MAX_REFRESH_FAILURES times running) that is ALSO expiring can only be fixed by a re-login.
    // Expiry is half the test on purpose: a dead refresh on a token that still has runway is not
    // yet a fault, and re-capturing it would spend a browser window on an account that works.
    const failures = typeof inner === 'object' ? Number((slots[email] as Record<string, unknown> | undefined)?.refresh_failures) || 0 : 0
    const refreshIsDead = !hasRefresh || failures >= MAX_REFRESH_FAILURES
    if (refreshIsDead && blobLocallyExpired(b)) refreshDead.push(email)
  }
  return { unreadable, refreshDead }
}

// ── The composed tick (cmd_tick)─────────────────────────────────────────────────────────────
/**
 * One rotation beat: keepalive-refresh idle slots (RENEW), then usage-based auto-rotate
 * (ROTATE), then derive the `next_action` status. Faithful to `cmd_tick`'s ordering
 * (keepalive → auto). The Phase-F browser tiers (cookie capture, seeded-slot bootstrap, the
 * REAUTH "only human step") and the integrity-repair pass are deliberately NOT invoked here —
 * they are the lower-priority human-recovery leg; this tick is the autonomous continuity core.
 *
 * ⚠ ACTUATES: with real slots present, `autoRotate` can call switchLiveTo (the live write). The
 * server MUST gate CALLING this behind the config flag (Phase G) until the R16 go-ahead.
 */
export async function runTick(deps?: TickDeps): Promise<TickResult> {
  const refreshed = await keepaliveRefresh(deps)
  if (refreshed.length) decide(deps, `keepalive: refreshed ${refreshed.join(', ')}`)
  const rotateOut: { stuck?: StuckReason } = {}
  const switched = await autoRotate(deps, rotateOut)

  // Derive next_action: a switch happened → rotating; else if the fleet has any account that
  // can only be recovered by a human re-login → reauth-needed; else ok. "reauth-needed" is a
  // cheap local check: an alternate slot with no refresh token AND no live session, whose token
  // is dead/dying, is exactly the cascade's REAUTH_NUDGE leg.
  let nextAction: NextAction = switched ? 'rotating' : 'ok'
  let reason: TickReason | undefined
  let unreadable = 0
  let deadRefresh = 0
  if (!switched) {
    // The sweep itself lives in `surveyAlternates` so the leg that REPAIRS a dead slot reads the
    // same definition of "dead" this beat reports (TRDD-CVQJNW3A). The tick needs only the counts
    // — its decision line is counts-only by rule, never an email — but a repair must know WHOSE
    // slot to re-capture, and that identity is exactly what this loop used to throw away.
    const survey = surveyAlternates()
    unreadable = survey.unreadable.length
    deadRefresh = survey.refreshDead.length
    // Precedence: OUR fault before THEIRS — see the TickReason doc comment.
    if (unreadable > 0) { nextAction = 'reauth-needed'; reason = 'slot-unreadable' }
    else if (deadRefresh > 0) { nextAction = 'reauth-needed'; reason = 'refresh-dead' }
  }
  // The decision line is the beat's only log surface, so it must not say "no action needed" while
  // nextAction is reauth-needed — that reads as health and is how this stayed unexamined. State
  // the fault and its scope (counts only; never an email, never a token).
  const stuck = switched ? undefined : rotateOut.stuck
  const decision = deriveDecision({ switched, reason, stuck, unreadable, deadRefresh, refreshedCount: refreshed.length })
  // Emit the decision line for a STUCK tick too. Previously only `reason` did, so the most urgent
  // outcome was also the quietest one on the beat's own log surface.
  if (reason || stuck) decide(deps, decision)
  return { nextAction, reason, stuck, refreshed, switched, decision }
}
