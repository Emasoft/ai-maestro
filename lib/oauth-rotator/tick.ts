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
import { accountEmail, usageRequest, refreshOauthToken, util, type NetworkDeps } from './network'
import * as fs from 'fs'
import * as path from 'path'

// ── Thresholds (rotator.py defaults; see file header for why they are constants here) ────────
/** Rotate the live account AWAY once EITHER window crosses this % (proactive, pre-429). */
const SWITCH_AT_5H = 97
const SWITCH_AT_7D = 97
/** Only rotate ONTO an alternate below this % on BOTH windows (never jump onto a maxed one). */
const SAFE_5H = 90
const SAFE_7D = 90
/** Anti-thrash: minimum seconds between two auto-switches. */
const MIN_DWELL_S = 60
/** A token within this many hours of its LOCAL expiresAt (or past it) counts as dead/dying —
 * API-independent, so rotation fires even when /usage is unreachable. */
const EXPIRY_GRACE_H = 0.5
/** Keepalive horizon: refresh an idle slot once its runway drops below this many hours. */
const KEEPALIVE_AHEAD_H = 6
/** Consecutive keepalive-refresh failures after which a present-but-failing refresh token is
 * treated as dead (escalated to the human REAUTH nudge by the cascade). */
const MAX_REFRESH_FAILURES = 3
/** A live-account 429 must persist across this many consecutive ticks before it is believed
 * (a single 429 is often the usage endpoint's own throttle, not a real limit). */
const LIVE_429_DEBOUNCE = 2
/** Freshness window for the session identity beacon; older than this and it is ignored. */
const BEACON_MAX_AGE_S = 24 * 3600

/** What the tick concluded — feeds DXJZM3BW's `status.next_action`. */
export type NextAction = 'ok' | 'rotating' | 'reauth-needed'

export interface TickResult {
  /** The one-line status the continuity CLI surfaces. */
  nextAction: NextAction
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

// ── Pure decision helpers (faithful ports; unit-testable with no I/O) ────────────────────────

/** True iff the blob's token is at/within EXPIRY_GRACE_H of its LOCAL expiresAt (or past it).
 * A blob with no datable expiry returns false — never declare a token dead on missing data. */
export function blobLocallyExpired(blob: unknown): boolean {
  const e = expiresInH(blob)
  return e !== null && e <= EXPIRY_GRACE_H
}

/** The LIVE account is "near a limit" once EITHER window crosses its switch threshold. Unknown
 * (null) usage never trips it — only a positive over-threshold signal rotates. */
export function isNearLimit(fh: number | null, sd: number | null): boolean {
  return (fh !== null && fh >= SWITCH_AT_5H) || (sd !== null && sd >= SWITCH_AT_7D)
}

/** An alternate is a safe TARGET only if below SAFE on BOTH windows. */
export function isSafeAlternate(bfh: number, bsd: number): boolean {
  return bfh < SAFE_5H && bsd < SAFE_7D
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
    const fresh = await refreshOauthToken(blob, netDeps(deps))
    if (fresh === null) {
      // A refresh that keeps failing is dead — count it so the cascade escalates to REAUTH.
      const meta = slots[email]
      if (meta && typeof meta === 'object') {
        meta.refresh_failures = (typeof meta.refresh_failures === 'number' ? meta.refresh_failures : 0) + 1
        changed = true
      }
      continue
    }
    try {
      writeSlot(email, fresh)
    } catch (exc) {
      if (exc instanceof SlotKeychainWriteError) {
        decide(deps, `[keepalive] ${email}: keychain write refused (${exc.message}) — kept old token, skipped`)
        continue
      }
      throw exc
    }
    const meta = slots[email]
    if (meta && typeof meta === 'object') {
      meta.fp = fingerprint(fresh)
      meta.expires_at = oauthOf(fresh).expiresAt ?? null
      meta.refresh_failures = 0 // a successful exchange clears the dead-refresh counter
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
export async function autoRotate(deps?: TickDeps): Promise<boolean> {
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
  const fhS = fh !== null ? `${Math.round(fh)}%` : '?'
  const sdS = sd !== null ? `${Math.round(sd)}%` : '?'
  const liveExpired = blobLocallyExpired(liveBlob)
  const networkUp = liveStatus !== 0

  let near: boolean
  let liveDesc: string
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
    near = isNearLimit(fh, sd) || liveExpired
    liveDesc = `5h=${fhS} 7d=${sdS}${liveExpired ? ' +LOCALLY-EXPIRING' : ''}`
  } else if (liveStatus === 401 || liveStatus === 403) {
    near = true
    liveDesc = `token REJECTED (HTTP ${liveStatus}) — expired/invalid`
  } else if (liveExpired) {
    near = true
    liveDesc = `LOCALLY EXPIRED + API unreachable (status ${liveStatus})`
  } else {
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
      if (!isSafeAlternate(bfh, bsd)) continue // itself near a limit → skip
      candidates.push([email, b, bfh, bsd])
    } else {
      const eh = expiresInH(b)
      if (eh === null) continue // cannot confirm validity offline → not a safe degraded target
      degraded.push([email, b, eh])
    }
  }
  if (indexHealed) saveState(state) // before any switchLiveTo (it re-loads state from disk)

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
    decide(deps, `auto: live ${liveEmail ?? '(live)'} exhausted (${liveDesc}) but no alternate is healthy + below safe threshold and none is structurally renewable — all paid accounts maxed; waiting for a window to reset`)
  } else {
    decide(deps, `auto: live ${liveEmail ?? '(live)'} is LOCALLY EXPIRED and the API is unreachable, but no alternate with a known future expiry exists — cannot rotate; manual re-auth needed`)
  }
  return false
}

// ── The composed tick (cmd_tick) ─────────────────────────────────────────────────────────────
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
  const switched = await autoRotate(deps)

  // Derive next_action: a switch happened → rotating; else if the fleet has any account that
  // can only be recovered by a human re-login → reauth-needed; else ok. "reauth-needed" is a
  // cheap local check: an alternate slot with no refresh token AND no live session, whose token
  // is dead/dying, is exactly the cascade's REAUTH_NUDGE leg.
  let nextAction: NextAction = switched ? 'rotating' : 'ok'
  if (!switched) {
    const state = loadState()
    const slots = (state.slots ?? {}) as unknown as Record<string, Record<string, unknown>>
    for (const email of Object.keys(slots)) {
      if (email === state.live_email) continue
      const b = readSlot(email)
      if (!b) { nextAction = 'reauth-needed'; break } // unreadable alternate → needs attention
      const inner = oauthOf(b)
      const hasRefresh = Boolean(inner.refreshToken || inner.refresh_token)
      // A dead-refresh alternate (no refresh at all, or a refresh whose exchange has failed
      // MAX_REFRESH_FAILURES times running) that is also expiring can only be fixed by a human
      // re-login — the cascade's REAUTH_NUDGE leg. (No browser tier here, so a live-cookie
      // RENEW_COOKIE recovery is out of scope; this is the conservative "needs a human" signal.)
      const failures = typeof inner === 'object' ? Number((slots[email] as Record<string, unknown> | undefined)?.refresh_failures) || 0 : 0
      const deadRefresh = !hasRefresh || failures >= MAX_REFRESH_FAILURES
      if (deadRefresh && blobLocallyExpired(b)) { nextAction = 'reauth-needed'; break }
    }
  }
  const decision = switched ? 'rotated the live account' : refreshed.length ? `refreshed ${refreshed.length} slot(s)` : 'no action needed'
  return { nextAction, refreshed, switched, decision }
}
