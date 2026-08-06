/**
 * The beat-driven sweep: one model switch per invocation, paced, crash-safe, stateless.
 *
 * THE PACING DESIGN, because the obvious one is worse. The USER requires 60 seconds between
 * agents. The obvious implementations are (a) hold the beat and sleep 60s between agents, or
 * (b) persist the plan and let later beats drain it. (a) blocks the rotator beat for minutes and
 * loses everything on restart; (b) needs a store, and a persisted plan goes stale the moment an
 * agent switches model by any other route.
 *
 * Neither is necessary, because **the candidate list drains itself**. An agent that switches to
 * Opus is no longer running Fable, so the very next sweep re-reads its pane and does not find it.
 * So: actuate AT MOST ONE agent per invocation and re-derive the list every time. The fleet is
 * switched one agent per interval, in an order that self-corrects, with no plan to persist and
 * nothing to reconcile after a crash. A restart mid-sweep simply resumes from what the panes say.
 *
 * The interval is enforced HERE rather than trusting the beat's cadence: a beat that fires faster
 * than 60s would otherwise switch the fleet in a burst — the exact rate-limit ban the interval
 * exists to avoid — and beat cadences change without anyone thinking about this file.
 */
import {
  planModelFallback,
  FALLBACK_INTERVAL_MS,
  type FallbackCandidate,
  type FallbackSkip,
} from './model-fallback'
import { actuateModelFallback, type ModelFallbackDeps, type ModelFallbackDecision } from './model-fallback-actuator'

export interface SweepInputs {
  scopedModel: string
  scopedPct: number
  account5hPct: number | null
  account7dPct: number | null
  /** Every agent's currently-running model, from `collectFallbackCandidates`. */
  candidates: FallbackCandidate[]
  /** Epoch ms of the last switch this sweep performed for ANY agent, or null. */
  lastSweepAtMs: number | null
  /** Per-agent last actuation, shared with the recovery ladder's cooldown. */
  lastActuatedAtMs: (agentId: string) => number | null
  intervalMs?: number
}

export type SweepOutcome =
  | { acted: true; agentId: string; decision: ModelFallbackDecision }
  | { acted: false; reason: FallbackSkip | 'paced' | 'refused'; detail?: string }

/**
 * Run one sweep step. Returns what it did, or a NAMED reason it did nothing — `paced` and
 * `no-agents-on-that-model` mean very different things and a caller logging "no action" for both
 * cannot tell a working sweep from a stalled one.
 */
export async function runModelFallbackSweep(
  input: SweepInputs,
  deps: ModelFallbackDeps,
): Promise<SweepOutcome> {
  const now = (deps.now ?? Date.now)()
  const interval = input.intervalMs ?? FALLBACK_INTERVAL_MS

  // The USER's 60s, enforced here so a faster beat cannot turn the sweep into a burst.
  if (input.lastSweepAtMs !== null && now - input.lastSweepAtMs < interval) {
    const left = Math.round((interval - (now - input.lastSweepAtMs)) / 1000)
    return { acted: false, reason: 'paced', detail: `${left}s left` }
  }

  const plan = planModelFallback({
    scopedModel: input.scopedModel,
    scopedPct: input.scopedPct,
    account5hPct: input.account5hPct,
    account7dPct: input.account7dPct,
    agents: input.candidates,
    startAtMs: now,
  })
  if (!plan.act) return { acted: false, reason: plan.skip }

  // ONE SWITCH per invocation — but try candidates in order until one is not COOLDOWN-gated.
  //
  // Taking only `actions[0]` was the first version and it stalls the whole sweep on one agent:
  // a switch that FAILED to take leaves that agent still on the exhausted model, still first in
  // the list, and holding a 10-minute per-agent cooldown — so for ten minutes the sweep refuses
  // and NO other agent gets switched. In the happy case it is invisible (a switched agent leaves
  // the list on the next pane read), which is exactly why it needs saying.
  //
  // Cooldown is the only PER-AGENT gate, so it is the only one worth skipping past. Every other
  // refusal — the fire flag, a machine-wide STOP, HID presence, an unknown command key — is
  // fleet-wide, and trying the next agent would just re-refuse N times and report the last one.
  let lastRefusal: string | undefined
  for (const action of plan.actions) {
    const decision = await actuateModelFallback(action, input.lastActuatedAtMs(action.agentId), deps)
    if (decision.fired) return { acted: true, agentId: action.agentId, decision }
    const detail = `${decision.reason}${decision.detail ? `: ${decision.detail}` : ''}`
    if (decision.reason !== 'cooldown') return { acted: false, reason: 'refused', detail }
    lastRefusal = detail
  }
  // Every candidate was cooling down. Healthy and temporary — they were all switched recently.
  return { acted: false, reason: 'refused', detail: lastRefusal ?? 'no actionable candidate' }
}
