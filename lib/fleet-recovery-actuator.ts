// Fleet-recovery ACTUATOR — CHN16JXZ Phase B (2/2). The hands to fleet-recovery.ts's
// brain: given ONE stalled agent and the current gates, decide WHETHER to fire and
// WHICH rung, then perform it through the INJECTED side effect. Everything that touches
// the world — the authenticated #60 injection, the machine-wide STOP gate, the HID-presence
// probe, the clock — is injected, so the decision is unit-tested with fakes and the real
// wiring (default-OFF) lands in the watchdog at D-full.
//
// STATELESS by design: the per-agent attempt count and last-actuated time are PASSED IN,
// never held here. The watchdog (D-full) owns that store and updates it on a `fired`
// result. This keeps the actuator a pure function of (target, gates) — the only impurity
// is the one injected `inject` call, which the tests replace with a fake.
//
// SEVEN gates, fail-safe: any gate unsure ⇒ do NOT fire. Ordered cheapest/most-decisive
// first so the reported reason is the truthful dominant one (a hard-gated agent that needs
// a human is reported as such, never masked by a later cooldown):
//   1. not_a_target      — only a `stalled` agent is a recovery target here. token_blocked
//                          is the OAuth cascade's (1GGQ4HWY); everything else is healthy.
//   2. fire_flag_off     — the master switch is OFF by default (mirror the janitor's
//                          default-off posture). A misclassification must never move an
//                          agent until the operator opts in. Checked before any I/O.
//   3. actuation_blocked — the janitor machine-wide STOP (kill-switch/pause/maintenance,
//                          #79). A deliberate halt is the owner's; recovering against it is
//                          the two-daemon fight the one-daemon-per-host rule forbids.
//   4. hard_gated /      — the chosen rung is HARD. Gated off ⇒ hard_gated (gentle ladder
//      hard_not_wired      exhausted, a human must act). Enabled ⇒ hard_not_wired: the
//                          process-kill wiring is Phase C, NOT this gentle-only actuator.
//   5. hid_present       — the user is at the keyboard. Injecting mid-keystroke races the
//                          human; defer to the next scan.
//   6. cooldown          — actuated within the window. One nudge per window, so a wedged
//                          agent is not machine-gunned and a crash-loop pages once.
//   7. FIRE              — build the action and inject it (the authenticated #60 path).

import { recoveryRungFor, isHardRung, type RecoveryRung, type RecoveryDiagnosis } from '@/lib/fleet-recovery'
import type { LivenessClass } from '@/lib/fleet-liveness'
import { fleetActuationBlocked } from '@/lib/janitor-control'

/**
 * Map a liveness class to the recovery-ladder diagnosis, or null when the class is not a
 * recovery target FOR THIS ACTUATOR. Only `stalled` (idle at prompt past the stall window)
 * enters the ladder, as `frozen` — the full gentle ladder from the top. `token_blocked` is
 * deliberately NOT mapped: a dead credential must be healed by the OAuth cascade first
 * (resuming it just burns another turn). The healthy/offline classes map to null.
 */
export function diagnosisForClass(cls: LivenessClass): RecoveryDiagnosis | null {
  return cls === 'stalled' ? 'frozen' : null
}

/** The slash command + ESC posture each GENTLE rung injects (server-side names, from the
 *  recovery-ladder-parity spec). The three HARD rungs carry no slash: this actuator refuses
 *  them (they need the process-kill wiring of Phase C, not a keystroke). */
// The two reload rungs are a genuine plain→forced ESCALATION, not a duplicate: a plain
// `/reload-plugins` can be REFUSED by a plugin that is mid-use, so `update` escalates to
// `--force` to override that refusal and guarantee the newest cached plugin code loads
// (the janitor ships `--force` for exactly this reason). Mapping `update` to the
// `/janitor-reload-plugins` skill instead would inject the SAME `--force` keystrokes as this
// rung and collapse the escalation. NOTE for D-full: the true version-BUMP (fetching a newer
// release) is daemon/server-owned, not a session slash — this is the gentle self-service form.
const GENTLE_RUNG_ACTION: Partial<Record<RecoveryRung, { slash: string; needsEsc: boolean }>> = {
  esc_nudge: { slash: '/janitor-resume', needsEsc: true }, // dismiss a stuck modal, then kick a fresh turn
  rearm: { slash: '/janitor-arm', needsEsc: false }, // restore the heartbeat cron
  reload: { slash: '/reload-plugins', needsEsc: false }, // in-place plugin-code swap (may be refused mid-use)
  update: { slash: '/reload-plugins --force', needsEsc: false }, // force past a mid-use refusal → newest code loads
}

/** 10 min between nudges: shorter than the 30 min stall window, so a still-stalled agent is
 *  re-nudged on a later scan (escalating one rung) but never machine-gunned. Injectable. */
export const DEFAULT_COOLDOWN_MS = 10 * 60_000

/** The one agent this call decides about. `attempt`/`lastActuatedAtMs` are supplied by the
 *  caller's store — the actuator is stateless. */
export interface RecoveryTarget {
  agentId: string
  name?: string
  class: LivenessClass
  /** How many times this agent has already been actuated (drives ladder escalation). */
  attempt: number
  /** Epoch ms of the last actuation of THIS agent, or null if never actuated. */
  lastActuatedAtMs: number | null
}

/** What the injector is asked to perform — the authenticated #60 injection payload. */
export interface RecoveryAction {
  agentId: string
  name?: string
  rung: RecoveryRung
  /** The slash command to inject (server-side name for the rung). */
  slash: string
  /** esc_nudge dismisses a stuck modal (raw ESC) before the slash; other rungs do not. */
  needsEsc: boolean
}

/** The injector's honest report. `ok:false` still counts as a fire (we attempted it) — the
 *  actuator never lies about whether the injection succeeded. */
export interface InjectResult {
  ok: boolean
  detail?: string
}

export interface ActuatorDeps {
  /** MASTER SWITCH — OFF by default. Only true when the operator opts in (D-full flag). */
  fireEnabled: boolean
  /** Enable the HARD rungs (Phase C). Default false — this gentle-only actuator never runs them. */
  hardEnabled?: boolean
  /** The janitor machine-wide STOP gate. Defaults to the real janitor-control reader. */
  actuationBlocked?: () => { blocked: boolean; reason: string | null }
  /** True when the user is actively at the keyboard — defer injection to avoid racing them. */
  hidPresent: () => boolean
  /** THE side effect: perform the authenticated injection (#60). Injected so the real
   *  queue/tmux wiring lands in D-full; tests pass a fake. */
  inject: (action: RecoveryAction) => Promise<InjectResult>
  /** Cooldown window in ms (default DEFAULT_COOLDOWN_MS). */
  cooldownMs?: number
  /** Clock, injectable for tests. */
  now?: () => number
}

export type RecoveryDecision =
  | { fired: true; action: RecoveryAction; result: InjectResult }
  | {
      fired: false
      reason:
        | 'not_a_target'
        | 'fire_flag_off'
        | 'actuation_blocked'
        | 'hard_gated'
        | 'hard_not_wired'
        | 'hid_present'
        | 'cooldown'
      detail?: string
    }

/**
 * Decide and (if every gate passes) actuate recovery for ONE agent. Returns a structured
 * decision — the reason on a no-fire is the truthful dominant gate. Never throws for a gate
 * decision; only a throwing `inject` propagates (the caller's watchdog wraps the whole tick
 * in its own never-throw, so a bad injector cannot take the server down).
 */
export async function actuateRecovery(target: RecoveryTarget, deps: ActuatorDeps): Promise<RecoveryDecision> {
  // 1. not_a_target — only a stalled agent enters the ladder here.
  const diagnosis = diagnosisForClass(target.class)
  if (diagnosis === null) return { fired: false, reason: 'not_a_target', detail: target.class }

  // 2. fire_flag_off — the master switch. Checked before any I/O so an OFF actuator reads nothing.
  if (!deps.fireEnabled) return { fired: false, reason: 'fire_flag_off' }

  // 3. actuation_blocked — the janitor machine-wide STOP.
  const gate = (deps.actuationBlocked ?? fleetActuationBlocked)()
  if (gate.blocked) return { fired: false, reason: 'actuation_blocked', detail: gate.reason ?? undefined }

  // 4. rung — escalate one rung per attempt from the diagnosis's entry. A HARD result is
  //    NOT this actuator's to run: gated off ⇒ hard_gated (human needed); enabled ⇒
  //    hard_not_wired (Phase C owns the process-kill wiring).
  const rung = recoveryRungFor(diagnosis, target.attempt, deps.hardEnabled ?? false)
  if (rung === null) return { fired: false, reason: 'hard_gated', detail: `attempt ${target.attempt}` }
  if (isHardRung(rung)) return { fired: false, reason: 'hard_not_wired', detail: rung }

  // 5. hid_present — the user is typing; defer.
  if (deps.hidPresent()) return { fired: false, reason: 'hid_present' }

  // 6. cooldown — one nudge per window.
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const now = (deps.now ?? Date.now)()
  if (target.lastActuatedAtMs !== null) {
    const since = now - target.lastActuatedAtMs
    if (since < cooldownMs) {
      return { fired: false, reason: 'cooldown', detail: `${Math.round((cooldownMs - since) / 1000)}s left` }
    }
  }

  // 7. FIRE. rung is gentle (steps 4 excluded hard), so GENTLE_RUNG_ACTION always has it.
  const spec = GENTLE_RUNG_ACTION[rung]!
  const action: RecoveryAction = {
    agentId: target.agentId,
    name: target.name,
    rung,
    slash: spec.slash,
    needsEsc: spec.needsEsc,
  }
  const result = await deps.inject(action)
  return { fired: true, action, result }
}
