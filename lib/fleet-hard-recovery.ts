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
//   4. boot_grace — sessions.json is OVERCOMPLETE right after a server restart (persisted
//        agents are absent from tmux until boot-restore re-creates them), so firing early
//        would mass-resurrect every persisted agent at once. Refuse until the server has
//        been up past the grace window.
//   5. debounce — one scan's `dead` can be a transient read; require N CONSECUTIVE dead
//        scans (runner-counted) before the first kill-class action.
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

/** Consecutive dead scans required before the FIRST hard action (runner-counted). */
export const DEFAULT_MIN_DEAD_SCANS = 3

/** No hard action until the server has been up this long — the boot-overcomplete window. */
export const DEFAULT_BOOT_GRACE_MS = 10 * 60_000

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
  /** How many CONSECUTIVE scans this agent has classified `dead`. Runner-owned. */
  consecutiveDeadScans: number
}

export interface HardRecoveryAction {
  agentId: string
  name?: string
  rung: RecoveryRung
}

export interface HardRecoveryDeps extends GateDeps {
  /** Ms since the server process started — gates the boot-overcomplete window. */
  msSinceBoot: () => number
  /** Override the boot grace window (default DEFAULT_BOOT_GRACE_MS). */
  bootGraceMs?: number
  /** Override the consecutive-dead-scan floor (default DEFAULT_MIN_DEAD_SCANS). */
  minDeadScans?: number
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

  // 4. boot grace — sessions.json overcomplete right after a restart.
  const grace = deps.bootGraceMs ?? DEFAULT_BOOT_GRACE_MS
  const up = deps.msSinceBoot()
  if (up < grace) {
    return { fired: false, reason: 'boot_grace', detail: `${Math.round((grace - up) / 1000)}s left` }
  }

  // 5. debounce — N consecutive dead scans before the first kill-class action.
  const minScans = deps.minDeadScans ?? DEFAULT_MIN_DEAD_SCANS
  if (target.consecutiveDeadScans < minScans) {
    return { fired: false, reason: 'debounce', detail: `${target.consecutiveDeadScans}/${minScans} scans` }
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
