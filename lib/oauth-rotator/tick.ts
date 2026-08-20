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
// Runtime-safe despite model-fallback importing from this module: that import is `import type`
// (NextAction/StuckReason, erased at compile), so the value edge below closes no cycle.
import { modelFamily, SCOPED_SWITCH_AT_PCT, ACCOUNT_HEADROOM_PCT } from './model-fallback'
// TRDD-GY0LJV6S — the statusline disjunct. `RotatorState` satisfies `RotatorAdmissionView`
// structurally, so the guard needs no adapter and no second view of "who is live".
import {
  freshestAdmissibleUsage,
  type AdmissibleUsage,
  type UsageObservation,
} from '@/lib/statusline-admissible'
import { listStatuslineSnapshots, STATUSLINE_FRESH_MS } from '@/lib/statusline-store'
// `readTickWindows` is safe to import at runtime despite tick-status importing FROM this module:
// that import is `import type` (erased at compile), so no runtime cycle exists.
import { readTickWindows } from './tick-status'
import {
  readAgentlensWindowRows,
  agentlensObservations,
  type AgentlensWindowRow,
} from './agentlens-usage'
import {
  accountEmail,
  usageRequest,
  usageProbe,
  refreshOauthToken,
  util,
  scopedLimits,
  worstScopedPercent,
  earliestResetMs,
  fiveHourResetSec,
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

/** What the tick concluded — feeds DXJZM3BW's `status.next_action`.
 *
 * `stuck` was added 2026-08-06 after a MEASURED outage. See the `stuck` doc block below: that
 * field already existed and already reached the log and the alert store, but it never reached
 * THIS type — and `nextAction` is the only value the status FILE persists. So a rotator that
 * could not rotate persisted as `{"nextAction":"ok"}`, which is what the owner's dashboard and
 * any script read. Measured that day: the tick had not completed for 3.7 days, the live account's
 * refresh token was dead, two alternates were healthy, `active-alerts.json` held
 * `rotator-stuck:all-maxed` with `seen: 5` — and the status file said `ok`. The owner found out by
 * hitting a rate limit and rotating by hand. */
export type NextAction = 'ok' | 'rotating' | 'reauth-needed' | 'stuck'

/**
 * WHY `reauth-needed` needs a reason: the same word covers two failures with OPPOSITE owners.
 *  - `refresh-dead`     — the OAuth refresh token is dead. This does NOT mean a human is needed
 *                         (see the correction below).
 *  - `slot-unreadable`  — the slot could not be READ from this process at all (keychain ACL,
 *                         locked login keychain, a security session the daemon isn't in). The
 *                         credential may be perfectly healthy; nothing a re-login fixes.
 * Collapsing them sent a human to re-login for a defect on the SERVER's side. `slot-unreadable`
 * therefore takes precedence when both are present: a fault we caused must never be reported as
 * a chore we are handing to the user.
 *
 * ⚠ CORRECTED 2026-08-07 — this docstring used to say `refresh-dead` meant "the credential really
 * is unrecoverable; a HUMAN must re-login". **That is false, and it is the claim that made this
 * process cry wolf.** Credential recovery is a THREE-rung cascade (ROTATE → RENEW → REAUTHENTICATE)
 * and a dead refresh only exhausts rung 1. Rung 2 mints a fresh refresh from a live claude.ai
 * session COOKIE with **no human at all** — and the cookie layer lives in the janitor's keychain,
 * which THIS PROCESS CANNOT SEE. So a dead refresh is evidence about the OAuth layer and evidence
 * about NOTHING ELSE.
 *
 * MEASURED that day: of two slots reported "a human must re-login", ONE held a healthy cookie and
 * minted itself unattended; only the other had genuinely lapsed. The message was right about one of
 * two and stated both with equal confidence — the 4th message in one session found asserting the
 * opposite of the truth. (Which account is deliberately not named: this repo is PUBLIC, the slots
 * are the owner's personal mail accounts, and the identity carries none of the meaning.)
 *
 * The honest report names what we OBSERVED (a dead refresh) and not what we cannot know (whether a
 * human is required). Do NOT "fix" this by teaching tick.ts to read cookies: `cascade.ts` and
 * `cookie-vault.ts` already implement that, correctly and with tests, and BOTH have zero
 * production callers (11/11 and 3/3 exports uncalled, measured against a 19-caller control) — the
 * janitor owns the live cookie layer, and a second implementation here has already drifted from
 * it 3× on constants alone. See TRDD-XV9BLQC5.
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
  /** The LIVE account's windows, so `all-maxed` can stop claiming an exhaustion that is not there.
   *  Optional: absent ⇒ the original wording, because a message that INVENTS a number is worse
   *  than one that is merely vague. */
  windows?: { fiveHourPct: number | null; sevenDayPct: number | null; scopedModel: string | null; scopedPct: number | null }
}): string {
  if (f.switched) return 'rotated the live account'
  if (f.reason === 'slot-unreadable') {
    return `reauth-needed: ${f.unreadable} alternate slot(s) UNREADABLE from this process — credential access, not a re-login`
  }
  if (f.reason === 'refresh-dead') {
    // Says what was OBSERVED (the OAuth rung is dead), never that a human is required — this
    // process cannot see the cookie rung that would answer that. See the TickReason docstring.
    return `reauth-needed: ${f.deadRefresh} alternate slot(s) have a dead refresh and are expiring — the OAuth rung is dead, but a live claude.ai cookie can still mint these with NO human; check the cookie layer before re-logging in`
  }
  if (f.stuck === 'all-maxed') {
    // ⚠ THIS MESSAGE USED TO ASSERT THE OPPOSITE OF THE STATE, and it cost the owner real hours.
    // MEASURED 2026-08-07 11:42, live: it printed "live account is exhausted … all paid accounts
    // maxed" while that account read **5h 8% / 7d 72%** and the ONLY spent window was Fable at
    // 100%. `isNearLimit` trips on ANY window ≥ SWITCH(97) including a MODEL-scoped one, so a
    // fleet with 92% of its 5h window free was reported as out of capacity — sending the reader
    // hunting for headroom that was already in their hand.
    //
    // The distinction is not cosmetic, it selects a DIFFERENT REMEDY: a 5h/7d exhaustion means
    // WAIT (or rotate, if anything healthy exists), while a model-only exhaustion means SWITCH THE
    // MODEL and keep working on the same account. Same family as the `tick-stalled` false alarm
    // (TRDD-IGCSDTIU): the failure mode of an alert is not silence, it is confident wrongness.
    // NEUTER PAIR (2026-08-07 — OBSERVED via scripts/dev/neuter, restore verified by blob hash).
    // Complementary, and the red sets are DISJOINT, which is what proves the two halves are pinned
    // independently rather than together:
    //   s/if \(accountWindowsOk && modelSpent\) \{/if (false) {/
    //     → 1 red / 26 green:  the lie returns
    //         all-maxed with a HEALTHY account says the MODEL is spent, and names the real remedy
    //   s/if \(accountWindowsOk && modelSpent\) \{/if (true) {/
    //     → 3 red / 24 green:  the MIRROR defect — a real exhaustion told to switch models
    //         all-maxed with a GENUINELY maxed account still says exhausted — the complement
    //         all-maxed with NO windows keeps the original wording — never invents a number
    //         THE REGRESSION: all-maxed does NOT say "no action needed"
    // That last red is a PRE-EXISTING test, and it is the useful signal: the original path was
    // already covered, so this branch demonstrably preserves it rather than merely claiming to.
    const w = f.windows
    const accountWindowsOk =
      typeof w?.fiveHourPct === 'number' && typeof w?.sevenDayPct === 'number' &&
      w.fiveHourPct < SWITCH_AT_5H && w.sevenDayPct < SWITCH_AT_7D
    // `SCOPED_SWITCH_AT_PCT` (90), not `SWITCH_AT_SCOPED` (97): the scoped-only verdict now
    // trips at the shared policy gate (TRDD-IZ6KU37Y), so an all-maxed declared over a 92% Fable
    // window must still NAME the model remedy — testing at 97 here would print the generic
    // "exhausted" wording for exactly the walls the new gate introduces.
    const modelSpent = typeof w?.scopedPct === 'number' && w.scopedPct >= SCOPED_SWITCH_AT_PCT
    if (accountWindowsOk && modelSpent) {
      const model = w?.scopedModel ?? 'a model'
      return `STUCK: no alternate is healthy — but the live ACCOUNT is NOT exhausted (5h ${w?.fiveHourPct}% / 7d ${w?.sevenDayPct}%). Only the ${model} window is spent (${w?.scopedPct}%), so the remedy is to move agents OFF ${model}, not to rotate the credential`
    }
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

/**
 * The live account's four utilisation numbers at this tick.
 *
 * Every field is nullable and null means UNKNOWN, never zero — an unread window must not look
 * like an empty one. Consumers act on the model-scoped pair only when both the scoped and the
 * account numbers are known, because "the account has headroom" is exactly the claim a missing
 * reading cannot support.
 */
export interface WindowSnapshot {
  fiveHourPct: number | null
  sevenDayPct: number | null
  /** Display name of the worst model-scoped window, e.g. `Fable 5`. */
  scopedModel: string | null
  scopedPct: number | null
  /** The live account's 5h reset instant, epoch SECONDS — the agentlens account-attribution
   *  cohort key (TRDD-SLSSUIQ8). OPTIONAL and written only when known, so stamps from before
   *  this field round-trip byte-identical (the tick-status tests pin them with toEqual). */
  fiveHourResetsAtSec?: number | null
}

export interface TickResult {
  /** The one-line status the continuity CLI surfaces. */
  nextAction: NextAction
  /** The live account's windows this tick, when a usage reading was obtained. Absent when the
   *  tick returned before probing (no live credential, offline). Carried so a subsystem with no
   *  credential access — the fleet watchdog running the model-fallback sweep — can see them. */
  windows?: WindowSnapshot
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
  /**
   * The 429 back-off seams, forwarded to `NetworkDeps` (TRDD-WFIMES6U).
   *
   * `network.ts` declares both as test seams and says why: without an injected store, a test that
   * drives a 429 writes the DEVELOPER'S real machine-wide rotator state. But `netDeps` forwarded
   * only `fetchImpl`, so the seams were unreachable from the tick — which is why no tick test had
   * ever driven a cooldown, and why the status-0 overload the `networkUp` comment describes could
   * sit here undetected. A seam that no caller can reach is not a seam.
   */
  cooldownStore?: NetworkDeps['cooldownStore']
  probeLock?: NetworkDeps['probeLock']
  /**
   * The agentlenspro window rows, injectable so a test can drive the second statusline source
   * with no subprocess. Defaults to the real CLI reader (which is fail-soft `[]` when the CLI is
   * absent — an uninstalled agentlenspro is a normal host state, not a fault). (TRDD-SLSSUIQ8)
   */
  readAgentlensRows?: () => Promise<AgentlensWindowRow[]>
}

function nowS(deps?: TickDeps): number {
  return deps?.now ? deps.now() : Date.now() / 1000
}
function decide(deps: TickDeps | undefined, msg: string): void {
  ;(deps?.decide ?? ((m: string) => console.log(`[oauth-rotator] ${m}`)))(msg)
}
function netDeps(deps?: TickDeps): NetworkDeps {
  // Each key is set only when present, so an absent seam stays absent and `network.ts` falls back
  // to its real default — `{cooldownStore: undefined}` and `{}` are the same to `??`, but keeping
  // the object minimal means a snapshot of it reads as what was actually injected.
  const out: NetworkDeps = {}
  if (deps?.fetchImpl) out.fetchImpl = deps.fetchImpl
  if (deps?.cooldownStore) out.cooldownStore = deps.cooldownStore
  if (deps?.probeLock) out.probeLock = deps.probeLock
  return out
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

  // SECOND SOURCE (TRDD-SLSSUIQ8): agentlenspro's un-quantized window rows, mapped into the SAME
  // UsageObservation shape and re-filtered by the SAME admission machinery below — never a bypass
  // of it. The mapper only attributes a row to the live account on an EXACT 5h-reset-cohort match
  // (the persisted `fiveHourResetsAtSec` from the last endpoint probe): rows carry no account
  // identity, and a live measurement showed two accounts' rows side by side, so timestamp-only
  // attribution would hand the rotator another account's numbers — the account-burning
  // misattribution `statusline-admissible.ts` exists to prevent. Its own try: an absent or
  // erroring CLI must leave this function EXACTLY as it was before the card.
  try {
    // Cohort FIRST, CLI second. With no persisted live cohort the mapper drops every row by
    // construction (unknown identity is never guessed), so reading the CLI would spawn a
    // subprocess whose output is definitionally discarded — a wasted spawn on every beat until
    // the first endpoint probe stamps the cohort, and a REAL agentlenspro spawn inside any test
    // that drives statuslineNear with default deps (measured: 24s + a 5s-timeout flake in the
    // disjunct suite before this gate was hoisted).
    const cohort = readTickWindows()?.fiveHourResetsAtSec ?? null
    if (cohort !== null) {
      const rows = deps?.readAgentlensRows ? await deps.readAgentlensRows() : await readAgentlensWindowRows()
      if (rows.length > 0) {
        const rawSwitch = state.last_switch_at
        snapshots = snapshots.concat(
          agentlensObservations(rows, {
            liveFp: typeof state.live_fp === 'string' && state.live_fp !== '' ? state.live_fp : null,
            lastSwitchAtS: typeof rawSwitch === 'number' && Number.isFinite(rawSwitch) ? rawSwitch : null,
            liveResets5hSec: cohort,
          }),
        )
      }
    }
  } catch {
    /* fail-soft: the agentlens source may only ever ADD observations, never break the read */
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

/** The ACCOUNT-window half of `isSafeAlternate`, without the model-scoped check.
 *
 * WHY THIS EXISTS — measured 2026-08-06, and it is a real incident, not a hypothetical. The
 * rotator wrote `stuck: "all-maxed"` and refused to move while an account sat at **4% of its 5h
 * window** (independently confirmed via `agentlenspro statusline-history windows`: two account
 * profiles, one at 5h≈4%/7d=70%, the other at 5h≈99%/7d=20%, with EIGHT sessions pinned on the
 * exhausted one). Nothing was maxed except **Fable**, whose model-scoped window was spent on BOTH
 * accounts — so `isSafeAlternate` disqualified every candidate and the rotator chose paralysis.
 *
 * The scoped check is still right as the PREFERRED test (TRDD-JI7F1236: rotating onto an account
 * whose Fable window is spent makes every Fable call fail). What was wrong is treating it as
 * ABSOLUTE, because the two failures are not the same size:
 *
 *   • a 5h/7d-exhausted account blocks **every** request, on every model;
 *   • a model-exhausted account blocks **only that model**, and the agents can be moved off it
 *     (that is precisely what the model-fallback lane does).
 *
 * So when NO candidate passes the full test, falling back to one that is merely account-safe
 * trades a total outage for a partial degradation. It can never be worse than staying put: the
 * live account is already at/above its switch threshold, and the model window is spent everywhere,
 * so rotating cannot make the model situation worse than it already is. */
export function isAccountWindowSafe(bfh: number, bsd: number): boolean {
  return bfh < SAFE_5H && bsd < SAFE_7D
}

// ── The model-scoped rotation policy (TRDD-IZ6KU37Y — the janitor#222 mirror) ─────────────────
//
// One policy, two implementations (the janitor's `token_burn.py` daemon-side, this file
// server-side), so the fleet behaves identically whichever process is playing the rotator. The
// three pieces below mirror their `models_in_use` / `scoped_rotation_veto` /
// `model_fallback_verdict` — same evidence rules, same fail-open asymmetry, same 90/90 gates
// (`SCOPED_SWITCH_AT_PCT` / `ACCOUNT_HEADROOM_PCT`, env-overridable via the SHARED names
// `ROTATOR_SCOPED_SWITCH_AT` / `ROTATOR_SCOPED_ACCOUNT_HEADROOM`).

/** The model FAMILIES this account demonstrably ran work on, read from its own scoped windows.
 *
 * Evidence is `percent > 0`: a model's window cannot be consumed without running that model. An
 * explicit `isActive: false` WITHDRAWS the evidence (the server says the limit is not in
 * effect); a missing field (`null`) does not. Pure. An EMPTY set means NO EVIDENCE — callers
 * must read it as "unknown", never as "no model is in use". */
export function modelsInUse(usage: unknown): Set<string> {
  const out = new Set<string>()
  for (const l of scopedLimits(usage)) {
    if (l.percent === null || l.percent <= 0 || l.isActive === false) continue
    const family = modelFamily(l.model)
    if (family) out.add(family)
  }
  return out
}

/** The candidate's scoped percent that matters for THIS live account — the worst window among
 * models the live account is actually using — or null when nothing vetoes it.
 *
 * Both conditions are POSITIVE evidence, so every unknown fails OPEN (no veto): an empty
 * `inUse` set, a candidate with no scoped entries, or a model the live account never touched.
 * That asymmetry is the entire design. The mirror image — the blanket `worstScopedPercent`
 * this replaces in the candidate test — is "any spent scoped window makes an account an
 * invalid target", which is what sidelined the fleet's healthiest account for ~123h
 * (janitor#222): its Fable window was spent while the fleet needed no Fable at all. A non-null
 * return means only "this target does not help THIS model"; it never means "this account is
 * unhealthy", and the caller DEPRIORITIZES (the `scopedOnly` bucket) rather than drops. */
export function scopedVetoPct(inUse: ReadonlySet<string>, candUsage: unknown): number | null {
  if (inUse.size === 0) return null // no evidence about the live models → nothing can veto
  let worst: number | null = null
  for (const l of scopedLimits(candUsage)) {
    if (l.percent === null || !inUse.has(modelFamily(l.model))) continue
    if (worst === null || l.percent > worst) worst = l.percent
  }
  return worst
}

/** TRUE when the live account's wall is SOLELY model-scoped: some scoped window is at/over
 * `SCOPED_SWITCH_AT_PCT` while EVERY known account-wide window sits at/below
 * `ACCOUNT_HEADROOM_PCT` — with at least one account window KNOWN, because headroom must be
 * PROVEN, never assumed (an unreadable payload yields false: acting on unproven headroom is how
 * "could not measure" silently becomes "measured fine").
 *
 * The consequence of `true` is the two scoped-only rules (the janitor's post-#222 ruling):
 *   1. rotate ONLY onto an alternate with headroom on the model in use (the veto above), and
 *   2. when none exists, do NOT rotate at all — not onto a same-model-spent target, not
 *      degraded. Rotation cannot recover a model window that is spent everywhere; it burns the
 *      dwell window and a healthy account's runway for nothing. The remedy is the
 *      model-fallback lane (`/model` switch), which keys on the `all-maxed` verdict this
 *      branch still emits.
 *
 * Unlike the janitor's `model_fallback_verdict` this takes no snapshot-age parameter: it is
 * only ever computed on the usage payload THIS tick just fetched (freshness by construction).
 * The 300s age gate lives where staleness is possible — `readTickWindows` (tick-status.ts),
 * which feeds the watchdog's sweep. */
export function isScopedOnlyWall(fh: number | null, sd: number | null, scoped: number | null): boolean {
  if (scoped === null || scoped < SCOPED_SWITCH_AT_PCT) return false
  if (fh === null && sd === null) return false // headroom unproven → never claim scoped-only
  return (
    (fh === null || fh <= ACCOUNT_HEADROOM_PCT) &&
    (sd === null || sd <= ACCOUNT_HEADROOM_PCT)
  )
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
  const res = await refreshOauthToken(blob, netDeps(deps))
  if (res.blob === null) return [null, false]
  const refreshed = res.blob
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
    // SELF-HEAL A MIS-BRAND (TRDD-Y1ZWU998). The pre-fix code branded `refresh_dead_fp` on ANY
    // null return, so a fortnight of network blips had all three live slots carrying the
    // human-only retry ban over credentials nothing ever judged. A brand standing next to a
    // last-cause the classifier calls retryable is that bug's residue — clear it, so the slot
    // re-enters the retry loop. A credential that really is dead re-brands honestly below the
    // moment the endpoint says so.
    if (meta0?.refresh_dead_fp !== undefined && meta0?.last_refresh_failure !== 'credential-dead') {
      delete meta0.refresh_dead_fp
      changed = true
    }
    const fails0 = typeof meta0?.refresh_failures === 'number' ? meta0.refresh_failures : 0
    if (fails0 >= MAX_REFRESH_FAILURES && meta0?.refresh_dead_fp === fingerprint(blob)) continue
    const res = await refreshOauthToken(blob, netDeps(deps))
    if (res.blob === null) {
      // Count EVERY failure (the cascade escalates to REAUTH on the counter), and record the
      // classifier's cause in the same meta the janitor writes (`last_refresh_failure`) — but
      // brand `refresh_dead_fp` ONLY when the endpoint actually judged the grant. A transport
      // failure is retryable; branding it armed a human-only ban over a credential nothing
      // rejected (TRDD-Y1ZWU998 — measured at 100% of live slots: 775/567/219 consecutive
      // `network` failures, all three branded dead).
      const meta = slots[email]
      if (meta && typeof meta === 'object') {
        meta.refresh_failures = (typeof meta.refresh_failures === 'number' ? meta.refresh_failures : 0) + 1
        meta.last_refresh_failure = res.cause
        if (res.cause === 'credential-dead') meta.refresh_dead_fp = fingerprint(blob)
        changed = true
      }
      continue
    }
    const fresh = res.blob
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
        // The stored credential really is dead (its single-use grant was consumed and the
        // replacement lost), so record the cause the brand rests on — the mis-brand self-heal
        // above keys on `last_refresh_failure !== 'credential-dead'` and would otherwise strip
        // this legitimate brand on the next beat and resume pointless traffic.
        meta.last_refresh_failure = 'credential-dead'
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
  out?: { stuck?: StuckReason; windows?: WindowSnapshot },
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
  // `accountKey` is what keys the 429 back-off + TTL cache (TRDD-W4T70Y3R). Passing it is not
  // optional decoration: without a key the probe skips the cooldown entirely and this call site
  // goes back to re-knocking every 60 s, which is the behaviour the card exists to stop.
  // `usageProbe` rather than `usageRequest`: the latter drops the `reason`, and `reason` is the
  // only thing that distinguishes the three different meanings status 0 now carries. See the
  // `networkUp` derivation below — reading 0 as "offline" is wrong for two of them.
  const liveOutcome = await usageProbe(liveBlob, netDeps(deps), {
    accountKey: liveEmail ?? undefined,
  })
  const liveStatus = liveOutcome.status
  const liveData = liveOutcome.data
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
  // Publish the windows to the caller. These four numbers exist ONLY as locals here, so any
  // other subsystem that needs them has no way to see them — the model-fallback sweep lives in
  // the fleet watchdog, which has agents but no credential data, and this tick has credential
  // data but no agents. Writing them on the SAME additive out-param `stuck` uses (TRDD-RFQFCCU4)
  // keeps every existing caller and test byte-identical.
  if (out) {
    out.windows = {
      fiveHourPct: fh,
      sevenDayPct: sd,
      scopedModel: scWorst?.model ?? null,
      scopedPct: scWorst?.percent ?? null,
      fiveHourResetsAtSec: fiveHourResetSec(liveData),
    }
  }
  const fhS = fh !== null ? `${Math.round(fh)}%` : '?'
  const sdS = sd !== null ? `${Math.round(sd)}%` : '?'
  const scS = scWorst !== null ? ` ${scWorst.model}=${Math.round(scWorst.percent)}%` : ''
  const liveExpired = blobLocallyExpired(liveBlob)
  // NETWORK-DOWN IS A POSITIVE FINDING, NOT THE ABSENCE OF A READING (TRDD-WFIMES6U).
  //
  // This was `liveStatus !== 0`, which was right when 0 could ONLY mean network/abort/timeout/
  // unparseable. TRDD-W4T70Y3R then made `usageProbe` return 0 for two MORE reasons that say
  // nothing whatever about the network: `cooldown` (we are throttling OURSELVES, deliberately,
  // with no usable cache) and `lock_contended` (another process holds the probe lock this
  // instant). So a self-imposed back-off — or merely a second process probing — made the rotator
  // conclude it was offline.
  //
  // That is not a cosmetic misread. `networkUp` gates FIVE things below: candidates are not
  // probed at all, a lapsed-but-rescuable alternate is not renewed, `selectDrainFirst` is
  // skipped, and the log line says "API unreachable" — which points the next person debugging it
  // straight at the network, the one place nothing is wrong. Rotation degrades to picking on
  // token-expiry alone at exactly the moment a throttle means it is most needed, which is the
  // same failure W4T70Y3R fixed arriving by the route W4T70Y3R opened.
  //
  // So: conclude "down" only from `reason === 'error'`, the one value that actually reports a
  // failed call. Same discipline as the injected-prompt veto (#117) — act on positive evidence,
  // never on a missing reading.
  const networkUp = liveStatus !== 0 || liveOutcome.reason !== 'error'
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
  // TRUE only in the 200 arm, for the same reason as `expiryOnly`: "the wall is SOLELY
  // model-scoped" is a claim about KNOWN account windows. It gates the two scoped-only rules in
  // the candidate hunt below (TRDD-IZ6KU37Y).
  let scopedWall = false
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
    // THE SCOPED-ONLY TRIGGER (TRDD-IZ6KU37Y, mirroring the janitor's rotator). A model window
    // at/over the shared 90% gate while the account has proven headroom is a reason to ACT even
    // though `isNearLimit`'s 97% disjunct has not tripped — and `scopedWall` is deliberately
    // computed independently of `usageNear`, because a 98% scoped window with healthy accounts
    // trips BOTH, and the scoped-only rules must apply there too (rotating away from a healthy
    // account onto a same-model-spent one is the #222 incident regardless of which threshold
    // noticed the wall first).
    scopedWall = isScopedOnlyWall(fh, sd, sc)
    expiryOnly = liveExpired && !usageNear && !scopedWall
    near = usageNear || scopedWall || liveExpired
    liveDesc = `5h=${fhS} 7d=${sdS}${scS}${scopedWall ? ' +SCOPED-WALL' : ''}${liveExpired ? ' +LOCALLY-EXPIRING' : ''}${slDesc}`
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
  // The model families the LIVE account demonstrably runs, from its own scoped windows — the
  // evidence side of `scopedVetoPct`. Computed ONCE, outside the loop (it reads only liveData).
  const liveInUse = modelsInUse(liveData)
  // Candidates rejected ONLY by the model-scoped check, whose 5h/7d are both healthy. Consulted
  // solely when `candidates` is empty — see the fallback below `isAccountWindowSafe`.
  const scopedOnly: Candidate[] = []
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
      const o2 = await usageProbe(b, netDeps(deps), { accountKey: email })
      let [st2, d2] = [o2.status, o2.data]
      // A SELF-IMPOSED BACK-OFF IS NOT AN EXPIRED TOKEN (TRDD-WFIMES6U). Same status-0 overload as
      // `networkUp` above: `cooldown` and `lock_contended` also arrive as 0, and REFRESH-ON-ERR
      // below would answer them by burning a real token refresh — per candidate, per 60 s tick —
      // and then re-probing into the same cooldown for the same 0. The refresh is for a token the
      // endpoint REJECTED; we never even asked. Fall through to the degraded classification, which
      // is already the right answer for a candidate we could not read.
      const unread = st2 === 0 && (o2.reason === 'cooldown' || o2.reason === 'lock_contended')
      if (st2 !== 200 && st2 !== 429 && !unread) {
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
        ;[st2, d2] = await usageRequest(b, netDeps(deps), { accountKey: email })
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
      // Also reject a candidate whose MODEL-SCOPED window is spent — but only for a model the
      // LIVE account is actually using (TRDD-JI7F1236, narrowed by TRDD-IZ6KU37Y). The blanket
      // form (`worstScopedPercent(d2)`) vetoed on ANY spent scoped window, which is the shape
      // that sidelined the fleet's healthiest account for ~123h (janitor#222). `scopedVetoPct`
      // fails OPEN on every unknown, so a candidate spent on a model nobody runs stays eligible.
      if (!isSafeAlternate(bfh, bsd, scopedVetoPct(liveInUse, d2))) {
        // MODEL-SCOPED-ONLY REJECTS ARE HELD, NOT DROPPED. If this candidate fails ONLY because a
        // model window is spent — its 5h/7d are both healthy — keep it as a second-choice target.
        // It is used below only when NOTHING passes the full test, so the preferred behaviour is
        // bit-for-bit unchanged whenever a fully-safe account exists. See `isAccountWindowSafe`
        // for the incident this closes: `stuck: "all-maxed"` declared while an account sat at 4%
        // of its 5h window, because Fable was spent on every account.
        if (isAccountWindowSafe(bfh, bsd)) scopedOnly.push([email, b, bfh, bsd])
        continue // near a limit → skip (as a FIRST choice)
      }
      candidates.push([email, b, bfh, bsd])
    } else {
      const eh = expiresInH(b)
      if (eh === null) continue // cannot confirm validity offline → not a safe degraded target
      degraded.push([email, b, eh])
    }
  }
  if (indexHealed) saveState(state) // before any switchLiveTo (it re-loads state from disk)

  // MODEL-SCOPED FALLBACK — the fix for `stuck: "all-maxed"` declared over a 4%-used account.
  // Placed AFTER the probe loop (it needs the final counts) and BEFORE the drain-guard, which
  // reads `candidates.length` and must see the set we will actually rotate from.
  //
  // Strictly last-resort: it fires ONLY when the full test admitted nobody, so whenever a
  // fully-safe account exists the behaviour is unchanged. Pushing (rather than reassigning) keeps
  // `candidates` const and keeps ONE list feeding both the guard and `selectDrainFirst`, so the
  // count the guard sees can never disagree with the set the selection uses.
  //
  // NEUTER RUNS (2026-08-06 — OBSERVED via scripts/dev/neuter, restores blob-verified). A
  // COMPLEMENTARY PAIR, because one mutation can only certify half of a conditional: deleting it
  // proves the fallback FIRES, and making it unconditional proves it stays SUBORDINATE. Each reds
  // exactly one test, and a different one, so neither half is decorative:
  //   s{if \(candidates\.length === 0 && scopedOnly\.length > 0\) candidates\.push\(\.\.\.scopedOnly\)}{}
  //     → 1 red / 22 green:  rotates onto an account blocked ONLY by a spent MODEL window …
  //   s{…same…}{candidates.push(...scopedOnly)}
  //     → 1 red / 22 green:  still PREFERS a fully-safe account when one exists — last-resort only
  // `!scopedWall` (TRDD-IZ6KU37Y): when the wall is SOLELY model-scoped, rotating onto a target
  // whose same-model window is also spent trades nothing — the model stays walled, the dwell
  // window is burned, and a healthy account was abandoned. The push stays for ACCOUNT walls,
  // where a total outage genuinely beats a partial (model-only) degradation.
  if (!scopedWall && candidates.length === 0 && scopedOnly.length > 0) candidates.push(...scopedOnly)

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
  // 1b) SCOPED-ONLY STOP (TRDD-IZ6KU37Y — the janitor's post-#222 ruling, mirrored). The wall is
  // solely model-scoped and no alternate has headroom on the model in use, so there is nothing a
  // credential rotation can recover: the DEGRADED tier below is skipped ON PURPOSE (a blind
  // rotation off a healthy account is strictly worse than staying put), and the `all-maxed`
  // verdict hands the wall to the model-fallback lane — `stuckSuggestsModelFallback` keys on it,
  // and `deriveDecision`'s healthy-account branch names the `/model` remedy in the status line.
  if (scopedWall && best === null) {
    const wallDesc = scWorst !== null ? `${scWorst.model}=${Math.round(scWorst.percent)}%` : 'a model window'
    decide(
      deps,
      `auto: live ${liveEmail ?? '(live)'} ${liveDesc} — model-scoped wall only (${wallDesc}) and no alternate has headroom on that model; staying put. Rotation cannot recover a model window that is spent everywhere — the model-fallback lane (/model switch) is the remedy.`,
    )
    if (out) out.stuck = 'all-maxed'
    return false
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
  const rotateOut: { stuck?: StuckReason; windows?: WindowSnapshot } = {}
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
    // A tick that WANTED to rotate and could not is not `ok`. This is last in the chain on
    // purpose: `reauth-needed` names something a human can act on right now (re-login), while
    // `stuck` usually means "wait for a window", so the actionable verdict keeps precedence.
    // But it must beat `ok`, because `ok` is what a reader treats as health.
    else if (rotateOut.stuck) { nextAction = 'stuck' }
  }
  // The decision line is the beat's only log surface, so it must not say "no action needed" while
  // nextAction is reauth-needed — that reads as health and is how this stayed unexamined. State
  // the fault and its scope (counts only; never an email, never a token).
  const stuck = switched ? undefined : rotateOut.stuck
  const decision = deriveDecision({ switched, reason, stuck, unreadable, deadRefresh, refreshedCount: refreshed.length, windows: rotateOut.windows })
  // Emit the decision line for a STUCK tick too. Previously only `reason` did, so the most urgent
  // outcome was also the quietest one on the beat's own log surface.
  if (reason || stuck) decide(deps, decision)
  return { nextAction, reason, stuck, windows: rotateOut.windows, refreshed, switched, decision }
}
