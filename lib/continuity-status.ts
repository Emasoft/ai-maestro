import { readAgentlensStatus, type AgentlensStatusMetadata } from '@/lib/agentlens-status'

// The composition layer for the continuity `status` verb (TRDD-DXJZM3BW, NPT of KCRMSNL7).
// It assembles the FIVE-field contract the `aimaestro-continuity.sh status <self>` CLI returns
// — a DELIBERATE ceiling (TRDD-H24DF6ZC Constraint 1) so no token can leak through the one
// verb an agent can call. Four fields are the observable metadata from AgentlensPro
// (TRDD-Y916N7WL); the fifth, `next_action`, is computed HERE.
//
// INTERIM next_action: until the OAuth manager (TRDD-1GGQ4HWY) exists, next_action is a
// RECOMMENDATION derived from the observable metadata only — it cannot report the cascade
// states (rotating / reauth-needed) because those require the manager that reads the token.
// When 1GGQ4HWY lands, its live cascade state supersedes this heuristic. Keeping the value
// honest now (never claiming a rotation is happening when nothing is) is what makes the later
// layering safe.

/** The only continuity actions expressible from OBSERVABLE metadata. `rotate`/`reauth` are
 *  deliberately absent — they are cascade outcomes owned by TRDD-1GGQ4HWY, not derivable here. */
export type ContinuityNextAction = 'ok' | 'monitor' | 'switch-recommended' | 'unknown'

export interface ContinuityStatus {
  /** account identified AND not definitively rate-limited (see agentlens-status). */
  accountHealthy: boolean
  /** 5h rate-limit window utilization %, or null when unknown (never 0). */
  window5hPct: number | null
  /** 7d rate-limit window utilization %, or null when unknown. */
  window7dPct: number | null
  /** prompt-cache TTL in minutes the main session rides, or null when unknown. */
  cacheTtlMinutes: number | null
  /** the recommended next continuity action (interim; see module note). */
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

// Assemble the 5-field status. Reads the observable metadata (no token, R16) and computes the
// interim next_action. A separate async so the route and the CLI both consume one source.
export async function getContinuityStatus(): Promise<ContinuityStatus> {
  const m = await readAgentlensStatus()
  return {
    accountHealthy: m.accountHealthy,
    window5hPct: m.window5hPct,
    window7dPct: m.window7dPct,
    cacheTtlMinutes: m.cacheTtlMinutes,
    nextAction: computeNextAction(m),
  }
}
