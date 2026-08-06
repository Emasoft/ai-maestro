import { readAgentlensStatus, type AgentlensStatusMetadata } from '@/lib/agentlens-status'
import { readTickStatus } from '@/lib/oauth-rotator/tick-status'
import { isBootRestoreInFlight } from '@/lib/boot-restore-status'

// The composition layer for the continuity `status` verb (TRDD-DXJZM3BW, NPT of KCRMSNL7).
// It assembles the FIVE-field contract the `aimaestro-continuity.sh status <self>` CLI returns
// — a DELIBERATE ceiling (TRDD-H24DF6ZC Constraint 1) so no token can leak through the one
// verb an agent can call. Four fields are the observable metadata from AgentlensPro
// (TRDD-Y916N7WL); the fifth, `next_action`, is composed HERE.
//
// next_action — cascade-first, heuristic-fallback (TRDD-1GGQ4HWY, now landed). The OAuth-rotator
// beat stamps its live cascade conclusion (ok / rotating / reauth-needed) to a file; this reads
// that stamp (PERSIST-THEN-READ) and, when a FRESH one exists, it SUPERSEDES the observable
// heuristic — the beat reads the token the heuristic cannot. When the stamp is absent or stale
// (the beat is OFF by default, R16), next_action falls back to `computeNextAction` over the
// observable metadata. A status GET only READS the stamp; it NEVER runs the tick, so a read can
// never actuate a live-credential rotation — that is the whole point of the file bridge.

/** The continuity actions surfaced by the `status` verb. `ok` / `monitor` / `switch-recommended`
 *  / `unknown` are derivable from OBSERVABLE metadata; `rotating` / `reauth-needed` are the
 *  OAuth-cascade outcomes owned by the rotator beat (TRDD-1GGQ4HWY) and reach here only via the
 *  persisted tick-status stamp; `restoring` is the boot-restore walk (TRDD-JAU1ES1C), likewise via
 *  a stamp.
 *
 *  This ENUM is where a new continuity state goes. The response itself is a fixed FIVE-field
 *  ceiling (TRDD-H24DF6ZC Constraint 1) with a closed-set guard in the schema test, so widening
 *  the vocabulary must never widen the surface — a 6th field would spend a security budget that
 *  was deliberately capped. */
export type ContinuityNextAction =
  | 'ok'
  | 'monitor'
  | 'switch-recommended'
  | 'unknown'
  | 'rotating'
  | 'reauth-needed'
  | 'restoring'
  /** The tick WANTED to rotate and could not (all accounts maxed / offline / drain-guard hold).
   *  Added 2026-08-06: this state existed in the tick and was reported only to the log and the
   *  alert store, so the persisted status said `ok` through a 3.7-day rotation outage. Rotation
   *  being OFF must never be spelled the same way as rotation being unnecessary. */
  | 'stuck'

export interface ContinuityStatus {
  /** account identified AND not definitively rate-limited (see agentlens-status). */
  accountHealthy: boolean
  /** 5h rate-limit window utilization %, or null when unknown (never 0). */
  window5hPct: number | null
  /** 7d rate-limit window utilization %, or null when unknown. */
  window7dPct: number | null
  /** prompt-cache TTL in minutes the main session rides, or null when unknown. */
  cacheTtlMinutes: number | null
  /** the next continuity action: the OAuth-cascade state when a fresh one is stamped, else the
   *  observable heuristic (see module note). */
  nextAction: ContinuityNextAction
}

// Pressure at/above this % (of the authoritative window) is worth watching before it exhausts.
const MONITOR_PRESSURE_PCT = 90

// Pure so the recommendation rule has ONE testable home. Derives next_action from the four
// observables only.
export function computeNextAction(m: AgentlensStatusMetadata): ContinuityNextAction {
  if (!m.available) return 'unknown'
  // cc-rate-limits (CC's own snapshot) marked a window exhausted → the account is rate-limited;
  // switching to a fresh account (TRDD-9ZIF82HI) is the remedy, NOT reauth (a windowed account
  // still has a valid token).
  if (!m.accountHealthy) return 'switch-recommended'
  // Approaching the limit on the authoritative snapshot → watch closely. A calibrated pct is a
  // lower bound, so it informs 'monitor' but never 'switch-recommended' on its own.
  const pressure = Math.max(m.window5hPct ?? 0, m.window7dPct ?? 0)
  if (pressure >= MONITOR_PRESSURE_PCT) return 'monitor'
  return 'ok'
}

/** Injected seams so the supersede logic is unit-testable with no CLI / network / credential I/O,
 *  matching the oauth-rotator modules' deps pattern. The route calls `getContinuityStatus()` with
 *  no args, so both default to the real readers. */
export interface ContinuityStatusDeps {
  /** default `readAgentlensStatus` — the four observable metadata fields (no token, R16). */
  readMetadata?: () => Promise<AgentlensStatusMetadata>
  /** default `readTickStatus` — the persisted OAuth-cascade next_action, or null when absent/stale. */
  readTickAction?: () => ContinuityNextAction | null
  /** default `isBootRestoreInFlight` — true only while the boot-restore walk is heartbeating. */
  readBootRestoring?: () => boolean
}

// Assemble the 5-field status. Reads the observable metadata (no token, R16) for four fields, then
// composes next_action cascade-first: a FRESH persisted OAuth-cascade state supersedes the
// observable heuristic; absent/stale falls back to `computeNextAction`. Only READS the stamp — a
// status GET never runs the tick (R16). One source consumed by both the route and the CLI.
export async function getContinuityStatus(deps: ContinuityStatusDeps = {}): Promise<ContinuityStatus> {
  const readMetadata = deps.readMetadata ?? readAgentlensStatus
  const readTickAction = deps.readTickAction ?? readTickStatus
  const readBootRestoring = deps.readBootRestoring ?? isBootRestoreInFlight
  const m = await readMetadata()
  // PRECEDENCE — cascade, then restoring, then the heuristic. Each source is ranked by WHAT IT
  // KNOWS, not by how recently it spoke:
  //
  //   1. The cascade stamp read the actual TOKEN. `reauth-needed` means a human must log in, and
  //      that stays true (and stays the most actionable thing on the host) whether or not a
  //      restore is running. Letting `restoring` mask it would hide a real credential failure
  //      behind a transient state — a dead account reported as merely busy.
  //   2. `restoring` outranks the heuristic because the heuristic is exactly what goes unreliable
  //      during a restore: AgentlensPro's metadata is missing or half-formed while sessions come
  //      up, so `computeNextAction` can emit a spurious `switch-recommended` and provoke an
  //      account switch the host never needed. That misfire is the concrete harm this state exists
  //      to prevent — not the cosmetic difference between "restoring" and "live".
  //   3. The heuristic is the steady-state default, and says so about itself (a calibrated lower
  //      bound over observables).
  const nextAction = readTickAction() ?? (readBootRestoring() ? 'restoring' : computeNextAction(m))
  return {
    accountHealthy: m.accountHealthy,
    window5hPct: m.window5hPct,
    window7dPct: m.window7dPct,
    cacheTtlMinutes: m.cacheTtlMinutes,
    nextAction,
  }
}
