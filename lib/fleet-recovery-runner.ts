// Fleet-recovery RUNNER — CHN16JXZ Phase D-full. Threads the per-agent recovery STATE across
// watchdog ticks (the actuator is stateless by design) and wires the actuator's injected deps
// to the real substrate:
//
//   - inject  → enqueueCommand() on the server-owned command queue. That is the authenticated
//               #60 path: the entry PERSISTS and drains at the agent's next SAFE IDLE PROMPT via
//               the hook-driven drainer — never a raw keystroke into a live pane. The queue also
//               DEDUPES (409 on a repeat of the same key+when), a second flood-guard atop the
//               actuator's cooldown.
//   - hidPresent → the user-presence record: if the human typed within the last minute, defer
//               (don't race a live user). Cheap synchronous read.
//   - hardEnabled=false → the hard rungs (relaunch/force_restart/resurrect) are Phase C.
//
// Everything world-touching is behind `defaultActuatorDeps`, which is only CALLED at runtime, so
// importing this module is side-effect-free and `runRecoveryPass` is fully testable with a fake
// deps object.

import { getPresence, nowEpochSeconds } from '@/lib/user-presence'
import { enqueueCommand } from '@/lib/command-queue'
import { actuateRecovery, type ActuatorDeps, type RecoveryDecision } from '@/lib/fleet-recovery-actuator'
import type { FleetLivenessSnapshot } from '@/lib/fleet-liveness'

/** If the user typed within this window, DEFER injection — a stalled agent (30 min idle) is not
 *  urgent, and injecting mid-keystroke races the human. */
export const HID_PRESENCE_WINDOW_SECONDS = 60

/** Provenance stamped on every queued recovery command (never an agentId — this is the server's
 *  own watchdog acting, like the queue route records 'user' for the human system-owner). */
export const RECOVERY_ENQUEUED_BY = 'system-fleet-recovery'

/** Per-agent recovery state the runner threads across ticks. Created on the FIRST fire; a
 *  first-timer has no entry and passes attempt 0 / lastActuatedAtMs null to the actuator. */
export interface RecoveryState {
  attempt: number
  lastActuatedAtMs: number
}

/**
 * The real actuator dependencies. `fireEnabled` is the master switch (default-OFF at the call
 * site). `now` is injected so the cooldown clock and the store timestamps share one source.
 */
export function defaultActuatorDeps(fireEnabled: boolean, now: () => number = Date.now): ActuatorDeps {
  return {
    fireEnabled,
    hardEnabled: false, // Phase C
    hidPresent: () => {
      const p = getPresence().last_user_input_epoch
      return p !== null && nowEpochSeconds() - p < HID_PRESENCE_WINDOW_SECONDS
    },
    inject: async (action) => {
      const r = enqueueCommand(action.agentId, {
        commandKey: action.commandKey,
        when: 'idle',
        enqueuedBy: RECOVERY_ENQUEUED_BY,
      })
      if (r.ok) return { ok: true, detail: `enqueued ${action.commandKey} (entry ${r.entry.id})` }
      // 409 = already queued: the previous rung's command has not drained yet (agent still not
      // idle). Benign — report it, do not treat it as a hard failure.
      return { ok: false, detail: `enqueue ${action.commandKey}: ${r.error} (${r.status})` }
    },
    now,
    // actuationBlocked defaults to the real janitor-control gate inside the actuator.
  }
}

export interface RecoveryPassResult {
  fired: { agentId: string; name?: string; rung: string; ok: boolean; detail?: string }[]
  /** Agents whose gentle ladder is exhausted — a human (or Phase C) must act. */
  escalationNeeded: { agentId: string; name?: string; reason: string }[]
}

/**
 * One actuation pass over a snapshot's recoveryTargets, threading `store`.
 *
 * The snapshot already emptied `recoveryTargets` when the janitor signalled a machine-wide STOP
 * (scanFleetLiveness honours the gate), so a halted fleet loops over nothing here. Agents that
 * RECOVERED drop out of recoveryTargets between ticks — their store entry is pruned so the next
 * stall restarts the ladder at esc_nudge instead of mid-escalation.
 *
 * Fully injected (deps, store, now) ⇒ testable without a live fleet. Never throws for a decision;
 * only a throwing `inject` propagates, and the watchdog tick wraps the whole thing in its own
 * never-throw.
 */
export async function runRecoveryPass(
  snap: FleetLivenessSnapshot,
  deps: ActuatorDeps,
  store: Map<string, RecoveryState>,
  now: () => number = Date.now,
): Promise<RecoveryPassResult> {
  const result: RecoveryPassResult = { fired: [], escalationNeeded: [] }
  const targetIds = new Set(snap.recoveryTargets)

  // Prune recovered agents so a future stall starts a fresh ladder from the top.
  for (const id of [...store.keys()]) if (!targetIds.has(id)) store.delete(id)

  for (const a of snap.agents.filter((x) => targetIds.has(x.agentId))) {
    const st = store.get(a.agentId)
    const decision: RecoveryDecision = await actuateRecovery(
      {
        agentId: a.agentId,
        name: a.name,
        class: a.class,
        attempt: st?.attempt ?? 0,
        lastActuatedAtMs: st?.lastActuatedAtMs ?? null,
      },
      deps,
    )
    if (decision.fired) {
      // Advance on any fired attempt (even a failed enqueue): the cooldown then throttles a
      // failing injector, and the next attempt escalates a rung.
      store.set(a.agentId, { attempt: (st?.attempt ?? 0) + 1, lastActuatedAtMs: now() })
      result.fired.push({
        agentId: a.agentId,
        name: a.name,
        rung: decision.action.rung,
        ok: decision.result.ok,
        detail: decision.result.detail,
      })
    } else if (decision.reason === 'hard_gated' || decision.reason === 'hard_not_wired') {
      result.escalationNeeded.push({ agentId: a.agentId, name: a.name, reason: decision.reason })
    }
    // cooldown / hid_present / not_a_target / fire_flag_off / actuation_blocked → routine, no report
  }
  return result
}
