// Fleet HARD-recovery RUNNER — CHN16JXZ Phase C step (c). Threads the per-agent hard-ladder
// state across watchdog ticks (the actuator is stateless) and wires the injected effects to
// the real substrate:
//
//   - relaunch    → wakeAgent(agentId, {continueConversation: true, isSystemOwner}) — the exact
//                   transcript-preserving shape boot-restore uses (services/boot-restore-service.ts):
//                   the one caller that unambiguously means "continue exactly where you left off".
//                   A dead agent resumed with a FRESH context comes back alive, in the right repo,
//                   having forgotten what it was doing — and confidently does the wrong next thing.
//   - killRemnant → best-effort tmux teardown of any half-dead pane, mirroring the registry's own
//                   killAgentSessions shape (per-index computeSessionName + bare-name fallback).
//
// The debounce and boot gates are NOT re-derived here: the runner passes the dead-since
// tracker's partition verdict per agent (`debouncedDead`) and the actuator consults the
// boot-restore stamp itself — one owner per guard.
//
// Store note: the gentle path stamps a SHARED per-agent clock (recoveryStore) because several
// legs can nudge the same live pane. A DEAD agent has no pane — no gentle nudge, no fallback
// switch, no ask-user answer can target it — so cross-subsystem double-actuation is impossible
// by construction and this runner keeps its own store. `pagedCrashLoop` is the page-ONCE flag:
// crash_loop is reported on the TRANSITION into it, then held silent until the agent leaves the
// dead set (which resets its ladder entirely).

import { getAgent } from '@/lib/agent-registry'
import { killSessionSync } from '@/lib/agent-runtime'
import { computeSessionName } from '@/types/agent'
import {
  actuateHardRecovery,
  type HardRecoveryDeps,
  type HardRecoveryDecision,
} from '@/lib/fleet-hard-recovery'
import type { FleetAgentLiveness } from '@/lib/fleet-liveness'

/** Per-agent hard-ladder state, threaded across ticks. Pruned when the agent leaves the dead
 *  set, so a recovered-then-crashed-again agent restarts at relaunch with a fresh page budget. */
export interface HardRecoveryState {
  attempt: number
  lastActuatedAtMs: number
  pagedCrashLoop?: boolean
}

/** The real hard-actuator dependencies. `fireEnabled` is the AIM_FLEET_HARD_RECOVERY switch
 *  (default-OFF at the call site). Lazy-imports the wake service so importing THIS module stays
 *  side-effect-light for tests that only exercise runHardRecoveryPass with fakes. */
export function defaultHardRecoveryDeps(fireEnabled: boolean, now: () => number = Date.now): HardRecoveryDeps {
  return {
    fireEnabled,
    hidPresent: () => false, // a dead agent has no pane to race the user in; HID defer is moot
    now,
    relaunch: async (agentId) => {
      const { wakeAgent } = await import('@/services/agents-core-service')
      const r = await wakeAgent(agentId, {
        sessionIndex: 0,
        startProgram: true,
        authContext: { isSystemOwner: true },
        continueConversation: true,
      })
      if (r.error) return { ok: false, detail: r.error }
      if (r.data?.alreadyRunning) return { ok: true, detail: 'already running (not dead after all)' }
      return { ok: true, detail: `relaunched ${r.data?.sessionName ?? agentId}` }
    },
    killRemnant: async (agentId) => {
      // Mirror killAgentSessions: per-index names, bare-name fallback. Best-effort by contract.
      const agent = getAgent(agentId)
      const name = agent?.name
      if (!name) return { ok: false, detail: 'agent not in registry' }
      const sessions = agent?.sessions || []
      for (const s of sessions) killSessionSync(computeSessionName(name, s.index))
      if (sessions.length === 0) killSessionSync(name)
      return { ok: true, detail: 'remnant teardown attempted' }
    },
    // actuationBlocked + bootRestoreInFlight default to the real readers inside the actuator.
  }
}

export interface HardRecoveryPassResult {
  fired: { agentId: string; name?: string; rung: string; ok: boolean; detail?: string }[]
  /** Agents whose hard ladder is exhausted — reported ONCE per dead episode (page-once). */
  crashLooping: { agentId: string; name?: string; detail?: string }[]
}

/**
 * One hard-actuation pass over the current DEAD set. `debouncedIds` is the dead-since
 * tracker's hardRecoverable verdict for this tick; every dead agent is still driven through
 * the actuator (so the debounce refusal stays a real, reachable gate), but only confirmed
 * ones can fire. Prunes state for agents no longer dead — leaving the dead set is the reset.
 */
export async function runHardRecoveryPass(
  deadAgents: readonly Pick<FleetAgentLiveness, 'agentId' | 'name' | 'class'>[],
  debouncedIds: ReadonlySet<string>,
  deps: HardRecoveryDeps,
  store: Map<string, HardRecoveryState>,
  now: () => number = Date.now,
): Promise<HardRecoveryPassResult> {
  const result: HardRecoveryPassResult = { fired: [], crashLooping: [] }
  const deadIds = new Set(deadAgents.map((a) => a.agentId))
  for (const id of [...store.keys()]) if (!deadIds.has(id)) store.delete(id)

  for (const a of deadAgents) {
    const st = store.get(a.agentId)
    const decision: HardRecoveryDecision = await actuateHardRecovery(
      {
        agentId: a.agentId,
        name: a.name,
        class: a.class,
        attempt: st?.attempt ?? 0,
        lastActuatedAtMs: st?.lastActuatedAtMs ?? null,
        debouncedDead: debouncedIds.has(a.agentId),
      },
      deps,
    )
    if (decision.fired) {
      // Advance on any fired attempt (even a failed wake): the cooldown throttles a failing
      // relaunch and the next attempt escalates to the teardown rungs.
      store.set(a.agentId, {
        attempt: (st?.attempt ?? 0) + 1,
        lastActuatedAtMs: now(),
        pagedCrashLoop: st?.pagedCrashLoop,
      })
      result.fired.push({
        agentId: a.agentId,
        name: a.name,
        rung: decision.action.rung,
        ok: decision.result.ok,
        detail: decision.result.detail,
      })
    } else if (decision.reason === 'crash_loop') {
      if (!st?.pagedCrashLoop) {
        result.crashLooping.push({ agentId: a.agentId, name: a.name, detail: decision.detail })
        store.set(a.agentId, {
          attempt: st?.attempt ?? 0,
          lastActuatedAtMs: st?.lastActuatedAtMs ?? 0,
          pagedCrashLoop: true,
        })
      }
    }
    // boot_grace / debounce / cooldown / flag-off / STOP → routine, no report
  }
  return result
}
