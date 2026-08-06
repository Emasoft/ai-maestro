/**
 * Perform ONE planned model switch, gated exactly like every other fleet actuation.
 *
 * The planner (`model-fallback.ts`) decides WHO and WHEN. This performs the keystrokes for one
 * agent whose turn has come. The daemon beat owns the clock: it ticks, takes the actions whose
 * `dueAtMs` has passed, and calls this once per agent — which is what produces the USER's
 * 60-second spacing without anyone holding a timer across the fleet.
 *
 * WHY THIS IS NOT A CONTINUITY-REGISTRY EVENT. The confirmation dialog `/model opus` raises is a
 * recognisable screen state with a fixed answer, which is exactly `ContinuityEvent`'s shape, and
 * that was the first design. It cannot work: `checkInjectionGates` enforces a per-agent cooldown
 * (DEFAULT_COOLDOWN_MS = 10 min) that `fleet-recovery-actuator` shares between subsystems ON
 * PURPOSE, so an agent actuated by the command at T is gated until T+10min — and the dialog needs
 * an answer in seconds. A reactive confirm would therefore never fire in time, leaving the agent
 * parked on the dialog: the precise failure this whole path exists to avoid. So the command and
 * its confirmation are ONE actuation, spending ONE cooldown, which is also the honest accounting
 * — they are one operator intent, not two.
 *
 * The gates themselves are IMPORTED, never re-implemented. A duplicated gate is one more place
 * the fleet can be actuated while the owner believes it is halted (TRDD-X8801GT4).
 */
import {
  checkEntryGates,
  checkInjectionGates,
  type GateBlockReason,
  type GateDeps,
  type InjectResult,
} from '@/lib/fleet-recovery-actuator'
import { getAgentCommand } from '@/lib/agent-commands'
import type { FallbackAction } from './model-fallback'

/** The three keystrokes, in order. Named so a decision reports how far it got — a partial
 *  actuation must be distinguishable from one that never started. */
export type FallbackStep = 'esc' | 'command' | 'confirm'

/** What the injector is asked to send. `commandKey` is present only for the `command` step, and
 *  is a CURATED key — never command text, so this boundary stays injection-proof by construction. */
export interface FallbackInjection {
  agentId: string
  name?: string
  step: FallbackStep
  commandKey?: string
}

export interface ModelFallbackDeps extends GateDeps {
  /** THE side effect. Injected, so this module is fully testable with a fake. */
  inject: (injection: FallbackInjection) => Promise<InjectResult>
  /** Curated-key existence check. Defaults to the real allowlist. */
  commandExists?: (key: string) => boolean
  /** Injectable delay, so a test does not wait three real seconds. */
  sleep?: (ms: number) => Promise<void>
  /**
   * OPTIONAL post-condition: read the agent's pane and report the block verdict
   * (`services/block-state-service`.readPaneVerdict). Supplying it is what turns "we sent the
   * keys" into "the switch actually landed". Omitted ⇒ `confirmed: null`, which the caller must
   * NOT read as success — unknown is not verified.
   */
  verify?: (agentId: string) => Promise<{ blocked: boolean; reason: string } | null>
}

export type ModelFallbackDecision =
  | {
      fired: true
      steps: FallbackStep[]
      /** true = the pane is no longer on a question · false = still blocked (the dialog was NOT
       *  answered) · null = no verifier was supplied, so nothing is known. */
      confirmed: boolean | null
      detail?: string
    }
  | { fired: false; reason: 'unknown_command_key' | GateBlockReason; detail?: string }

/**
 * Order mirrors `actuateContinuity`, deliberately, so the reported reason means the same thing in
 * both subsystems:
 *
 *   1. unknown_command_key — a CONFIGURATION defect, reported even while the fire flag is OFF.
 *      This subsystem ships dark, so a typo caught only after arming would first surface as a
 *      fleet silently receiving nothing, in production.
 *   2-3. the shared ENTRY gates      (master flag, machine-wide STOP)
 *   4-5. the shared INJECTION gates  (HID presence, per-agent cooldown)
 *   6. FIRE: ESC → command → (settle) → ENTER.
 */
export async function actuateModelFallback(
  action: FallbackAction,
  lastActuatedAtMs: number | null,
  deps: ModelFallbackDeps,
): Promise<ModelFallbackDecision> {
  // 1. The curated boundary, before anything can be sent.
  const exists = deps.commandExists ?? ((key: string) => getAgentCommand(key) !== undefined)
  if (!exists(action.commandKey)) {
    return { fired: false, reason: 'unknown_command_key', detail: action.commandKey }
  }

  // 2-3. ENTRY gates.
  const entry = checkEntryGates(deps)
  if (!entry.ok) return { fired: false, reason: entry.reason, detail: entry.detail }

  // 4-5. INJECTION gates.
  const ready = checkInjectionGates(lastActuatedAtMs, deps)
  if (!ready.ok) return { fired: false, reason: ready.reason, detail: ready.detail }

  // 6. FIRE.
  const steps: FallbackStep[] = []
  const base = { agentId: action.agentId, name: action.name }

  // ESC first: the pane may be mid-render or showing a selection menu, where `/model opus` would
  // be swallowed as a menu keystroke rather than run as a command.
  const escRes = await deps.inject({ ...base, step: 'esc' })
  steps.push('esc')
  if (!escRes.ok) {
    return { fired: true, steps, confirmed: null, detail: `esc failed: ${escRes.detail ?? 'unknown'}` }
  }

  const cmdRes = await deps.inject({ ...base, step: 'command', commandKey: action.commandKey })
  steps.push('command')
  if (!cmdRes.ok) {
    // DO NOT send the confirming ENTER here. The command did not land, so there is no dialog to
    // confirm — and a bare ENTER into a live prompt SUBMITS whatever text is sitting in it. That
    // turns a failed model switch into an agent being handed an arbitrary instruction, which is
    // far worse than the switch not happening. Stop, and report honestly.
    return { fired: true, steps, confirmed: null, detail: `command failed: ${cmdRes.detail ?? 'unknown'}` }
  }

  // The dialog has to be DRAWN before it can be answered; confirming into a pane that has not
  // rendered it yet sends the keystroke to the prompt instead and leaves the dialog up.
  await (deps.sleep ?? defaultSleep)(action.confirmAfterMs)

  const confRes = await deps.inject({ ...base, step: 'confirm' })
  steps.push('confirm')
  if (!confRes.ok) {
    return { fired: true, steps, confirmed: false, detail: `confirm failed: ${confRes.detail ?? 'unknown'}` }
  }

  // Post-condition. Without this the subsystem reports success for having sent keystrokes, which
  // is the weakest possible claim: the agent could be sitting on the unanswered dialog right now.
  if (!deps.verify) return { fired: true, steps, confirmed: null }
  const verdict = await deps.verify(action.agentId)
  if (!verdict) return { fired: true, steps, confirmed: null, detail: 'pane unreadable' }
  const stillAsking = verdict.blocked && (verdict.reason === 'ask_user' || verdict.reason === 'permission')
  return {
    fired: true,
    steps,
    confirmed: !stillAsking,
    detail: stillAsking ? `still blocked: ${verdict.reason}` : undefined,
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
