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

  // ONE per invocation. `plan.actions[0]` is always due (dueAtMs === now for i=0); the rest are
  // deliberately dropped rather than queued — the next sweep re-derives them from the panes, and
  // by then this agent has left the list.
  const action = plan.actions[0]!
  const decision = await actuateModelFallback(action, input.lastActuatedAtMs(action.agentId), deps)
  if (!decision.fired) {
    return { acted: false, reason: 'refused', detail: `${decision.reason}${decision.detail ? `: ${decision.detail}` : ''}` }
  }
  return { acted: true, agentId: action.agentId, decision }
}
