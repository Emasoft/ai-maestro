// Fleet HARD-recovery actuator — CHN16JXZ Phase C step (b). The process-level hands the
// gentle actuator (lib/fleet-recovery-actuator.ts) deliberately refuses to be: relaunch a
// genuinely DEAD agent (registry persisted it, tmux says the process is gone), escalating
// to external teardown only when a plain relaunch fails.
//
// SAFETY INVARIANT (the Phase C prerequisite on the card — do not weaken):
//   ONLY the `dead` liveness class enters here. A `stalled`/`frozen` agent is ALIVE (idle
//   at its own prompt); killing it destroys a live session's in-flight work, strictly worse
//   than leaving it frozen. That agent belongs to the GENTLE ladder, whose correct terminal
//   is hard_gated → "a human must act". Gate 1 enforces this before anything else.
//
// Mirrors the gentle actuator's design on purpose:
//   - STATELESS: attempt count, last-actuated time, and the consecutive-dead-scan count are
//     PASSED IN; the runner (step c) owns those stores and advances them on a fired result.
//   - Every world-touching effect is INJECTED (`relaunch`, `killRemnant`) so the decision is
//     unit-tested with fakes and the real wiring (wakeAgent/continueConversation + teardown)
//     lands in step (c), behind the default-OFF AIM_FLEET_HARD_RECOVERY flag.
//   - The SHARED gates (fire flag, machine-wide STOP, HID presence, per-agent cooldown) are
//     the gentle actuator's own checkEntryGates/checkInjectionGates — reused, never copied,
//     per the TRDD-X8801GT4 rule: one duplicated gate is one place the fleet can be actuated
//     while the owner believes it is halted. `fireEnabled` here is the HARD flag, its own
//     switch independent of the gentle AIM_FLEET_RECOVERY_FIRE.
//
// Gate order — cheapest / most decisive first, so the reported reason is the truthful
// dominant one:
//   1. not_a_target — only `dead` enters (the safety invariant above).
//   2-3. fire_flag_off / actuation_blocked — shared entry gates; flag first ⇒ an OFF
//        actuator performs no I/O at all.
//   4. boot_grace — sessions.json is OVERCOMPLETE while boot-restore is still walking the
//        fleet (persisted agents are absent from tmux until it re-creates them), so firing
//        then would mass-resurrect every persisted agent at once. The precise signal is the
//        boot-restore in-flight stamp (lib/boot-restore-status.ts), which heartbeats per
//        session during the walk and ages out if the restore crashes — NOT a fixed uptime
//        grace, which would be wrong in both directions on a large/small fleet.
//   5. debounce — one scan's `dead` can be a freshly-relaunching agent whose pane is not
//        back yet. The wall-clock dead-since tracker (lib/fleet-dead-debounce.ts, the
//        TRDD-SX593MDG guard built ahead of this actuator) is the ONE source of truth for
//        "dead past the boot window"; the runner passes its verdict per agent and this gate
//        refuses anything the tracker has not confirmed. Duplicating the window here would
//        be a second debounce that drifts from the first.
//   6. crash_loop — the ladder is exhausted (relaunch, then external teardowns, all fired
//        and the agent is still dead): a human must look. Reported BEFORE hid/cooldown so
//        the terminal condition is never masked by a routine gate — the runner pages ONCE
//        on this reason, exactly like the gentle path's escalationNeeded.
//   7-8. hid_present / cooldown — shared injection gates. The cooldown store is the SAME
//        per-agent store the gentle path uses conceptually (per AGENT, not per diagnosis),
//        but a dead agent never receives gentle nudges, so in practice this throttles only
//        the hard ladder; the default window is longer because a relaunch needs boot time.
//   9. FIRE — rung from the shared ladder (`recoveryRungFor('dead', attempt, true)`):
//        relaunch (transcript-preserving wake) first; force_restart/resurrect add a
//        best-effort remnant teardown before the wake. In the server's context resurrect
//        IS force_restart — the janitor's resurrect spawns an external supervisor to do the
//        kill+relaunch, and here the server already is that external supervisor.

import { recoveryRungFor, type RecoveryRung } from '@/lib/fleet-recovery'
import type { LivenessClass } from '@/lib/fleet-liveness'
import { isBootRestoreInFlight } from '@/lib/boot-restore-status'
import {
  checkEntryGates,
  checkInjectionGates,
  type GateDeps,
  type InjectResult,
} from '@/lib/fleet-recovery-actuator'

/** The env flag step (c)'s wiring reads. Exported so the wiring cannot drift from the docs. */
export const HARD_RECOVERY_FLAG = 'AIM_FLEET_HARD_RECOVERY'

/** 30 min between hard actions on one agent: a relaunched session needs time to boot and
 *  re-persist before "still dead" means anything. Longer than the gentle 10 min on purpose. */
export const DEFAULT_HARD_COOLDOWN_MS = 30 * 60_000

/** Fired attempts before the ladder is exhausted: relaunch → force_restart → resurrect. */
export const DEFAULT_MAX_HARD_ATTEMPTS = 3

export interface HardRecoveryTarget {
  agentId: string
  name?: string
  class: LivenessClass
  /** Fired hard attempts so far (drives ladder escalation). Runner-owned. */
  attempt: number
  /** Epoch ms of the last actuation of THIS agent, or null. Runner-owned. */
  lastActuatedAtMs: number | null
  /** The dead-since tracker's verdict: true only when this agent has been continuously
   *  observed dead PAST the boot window (trackDeadDebounce → hardRecoverable). The runner
   *  supplies it; false is the fail-safe default for anything the tracker has not confirmed. */
  debouncedDead: boolean
}

export interface HardRecoveryAction {
  agentId: string
  name?: string
  rung: RecoveryRung
}

export interface HardRecoveryDeps extends GateDeps {
  /** True while the boot-restore walk is still heartbeating — hard recovery must wait it
   *  out. Defaults to the real stamp reader (same pattern as actuationBlocked's default). */
  bootRestoreInFlight?: () => boolean
  /** Override the ladder-exhausted ceiling (default DEFAULT_MAX_HARD_ATTEMPTS). */
  maxAttempts?: number
  /** THE relaunch effect: transcript-preserving wake (wakeAgent + continueConversation in
   *  step (c)); tests pass a fake. Its result IS the fire's result. */
  relaunch: (agentId: string) => Promise<InjectResult>
  /** Best-effort teardown of any half-dead remnant (stale tmux session / stuck pid) BEFORE
   *  the re-wake, used by the force_restart/resurrect rungs. Optional and best-effort by
   *  contract: for a truly dead agent there is usually nothing to kill, so a failure here
   *  must never block the relaunch. */
  killRemnant?: (agentId: string) => Promise<InjectResult>
}

export type HardRecoveryDecision =
  | { fired: true; action: HardRecoveryAction; result: InjectResult }
  | {
      fired: false
      reason:
        | 'not_a_target'
        | 'fire_flag_off'
        | 'actuation_blocked'
        | 'boot_grace'
        | 'debounce'
        | 'crash_loop'
        | 'hid_present'
        | 'cooldown'
      detail?: string
    }

/**
 * Decide and (if every gate passes) hard-recover ONE dead agent. Same contract as the
 * gentle `actuateRecovery`: never throws for a gate decision; a fired attempt with a failed
 * relaunch is still `fired: true` with an honest `result.ok: false` — the caller advances
 * attempt + cooldown on ANY fire, so a failing relaunch escalates instead of machine-gunning.
 */
export async function actuateHardRecovery(
  target: HardRecoveryTarget,
  deps: HardRecoveryDeps,
): Promise<HardRecoveryDecision> {
  // 1. not_a_target — the safety invariant: only a dead process may be hard-recovered.
  if (target.class !== 'dead') return { fired: false, reason: 'not_a_target', detail: target.class }

  // 2-3. shared entry gates (deps.fireEnabled IS the hard flag here).
  const entry = checkEntryGates(deps)
  if (!entry.ok) return { fired: false, reason: entry.reason, detail: entry.detail }

  // 4. boot grace — sessions.json is overcomplete while boot-restore is still walking.
  if ((deps.bootRestoreInFlight ?? isBootRestoreInFlight)()) {
    return { fired: false, reason: 'boot_grace', detail: 'boot-restore in flight' }
  }

  // 5. debounce — only the dead-since tracker's confirmed verdict may pass (one window,
  //    one owner: lib/fleet-dead-debounce.ts).
  if (!target.debouncedDead) {
    return { fired: false, reason: 'debounce', detail: 'within the dead-since boot window' }
  }

  // 6. crash loop — the whole hard ladder fired and the agent is still dead. Human needed.
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_HARD_ATTEMPTS
  if (target.attempt >= maxAttempts) {
    return { fired: false, reason: 'crash_loop', detail: `attempt ${target.attempt}` }
  }

  // 7-8. shared injection gates (HID presence, per-agent cooldown).
  const ready = checkInjectionGates(target.lastActuatedAtMs, deps)
  if (!ready.ok) return { fired: false, reason: ready.reason, detail: ready.detail }

  // 9. FIRE. hardEnabled=true here by definition: this IS the hard actuator, and its own
  //    flag was already gate 2. `dead` enters the ladder at relaunch, so the rung is always
  //    hard and never null.
  const rung = recoveryRungFor('dead', target.attempt, true)!
  const action: HardRecoveryAction = { agentId: target.agentId, name: target.name, rung }

  if (rung !== 'relaunch' && deps.killRemnant) {
    // Best-effort: a dead agent usually has nothing left to kill; a teardown failure must
    // never block the relaunch (it would turn "remnant already gone" into "unrecoverable").
    try {
      await deps.killRemnant(target.agentId)
    } catch {
      /* best-effort by contract */
    }
  }
  const result = await deps.relaunch(target.agentId)
  return { fired: true, action, result }
}
