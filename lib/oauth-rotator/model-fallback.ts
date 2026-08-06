/**
 * Automatic model fallback when a MODEL-SCOPED window is exhausted (USER mandate, 2026-08-06).
 *
 * > "the rotation is a matter handled by the daemon, so the ai-maestro server needs no script and
 * > no skill at all to rotate, and the same for detecting all agents using the Fable model after
 * > the Fable window is exhausted, and to type Esc and then `/model opus` in each one (with 60
 * > seconds interval between each agent to avoid rate limit ban). So inside the ai-maestro harness
 * > the exhaustion of the Fable window must be always handled automatically."
 *
 * WHY THIS EXISTS AT ALL — the incident it comes from. A model-scoped weekly window can be spent
 * while the ACCOUNT still has most of its capacity. Measured that day: the live account sat at
 * 5h 42% / 7d 60% with its Fable window at ~98%. The rotator's answer was to evict the entire
 * fleet onto other accounts — which were at 99% (5h) and 87% (7d) — and then refuse to come back,
 * because `isSafeAlternate` (tick.ts) disqualifies an account maxed on ANY window, including one
 * that binds a single model. The owner recovered by hand, and the manual fix was one keystroke
 * sequence: ESC, then `/model opus`.
 *
 * So: rotating the CREDENTIAL is the expensive answer to a MODEL limit. Switching the model is the
 * cheap one — the account goes on serving every other request at full speed.
 *
 * THIS MODULE IS PURE. It decides WHO to switch and WHEN; it performs no injection, reads no
 * files, and calls no clock it was not given. The daemon owns the side effect (the same split as
 * `fleet-recovery-actuator`, whose `RecoveryAction` shape this deliberately mirrors — including
 * carrying a curated command KEY rather than a command string, so the pane write stays
 * injection-proof by construction).
 */
import type { NextAction } from './tick'

/** An agent the sweep may act on. `model` is whatever the agent is CURRENTLY running. */
export interface FallbackCandidate {
  agentId: string
  name?: string
  /** Normalised model family, lowercase (`fable`, `opus`, `sonnet`, …). */
  model: string
}

/** One scheduled switch. `dueAtMs` is absolute, so the caller needs no timer arithmetic. */
export interface FallbackAction {
  agentId: string
  name?: string
  /** Curated key from lib/agent-commands.ts — NEVER a raw command string. */
  commandKey: string
  /** Send ESC before the command. The pane may be mid-render or showing a selection menu, and
   *  `/model opus` typed into a menu selects a menu row instead of running. */
  escapeFirst: true
  /**
   * `/model opus` does NOT switch the model on its own — Claude Code answers it with an
   * AskUserQuestion confirmation, and the switch happens only once that is confirmed with ENTER
   * (USER, 2026-08-06).
   *
   * This is why the field exists rather than the injector "just sending the command". A sweep that
   * types the command and walks away does not leave the agent unchanged — it leaves it BLOCKED on
   * a dialog, still on the exhausted model, and now unable to proceed at all. That is a worse
   * state than the one being repaired, produced fleet-wide, 60 seconds apart. It is also precisely
   * the failure `block-state` was built to detect: `reason: 'ask_user'`.
   */
  confirmAfterMs: number
  /** When this one may fire. Successive actions are spaced by `intervalMs`. */
  dueAtMs: number
}

export type FallbackSkip =
  | 'no-model-scoped-exhaustion' // the model window is fine — nothing to fall back FROM
  | 'account-also-exhausted'     // switching model cannot help; this needs a rotation or a wait
  | 'no-agents-on-that-model'    // nobody to switch

export type FallbackPlan =
  | { act: true; actions: FallbackAction[] }
  | { act: false; skip: FallbackSkip }

/**
 * The USER's number. Sixty seconds between agents, to avoid tripping a rate-limit ban by
 * switching a whole fleet at once. Do not "optimise" this away: the sweep exists because the
 * fleet was rate-limited, and a burst is how you get banned rather than throttled.
 */
export const FALLBACK_INTERVAL_MS = 60_000

/**
 * How long to wait after the command before sending the confirming ENTER. The dialog has to be
 * drawn first; confirming into a pane that has not rendered it yet sends the keystroke to the
 * prompt instead, leaving the dialog up and unanswered.
 *
 * Well under `FALLBACK_INTERVAL_MS`, so an agent's confirm always lands before the next agent's
 * command — the sweep never has two panes mid-dialog at once.
 */
export const CONFIRM_DELAY_MS = 3_000

/**
 * The model FAMILY, lowercased, from whatever the registry recorded.
 *
 * `Agent.model` is a human display string — `"Opus 4.8"`, `"Sonnet 5"`, `"Fable 5"` (types/agent.ts:207)
 * — never a bare family token. So comparing it to `'fable'` directly matches NOTHING, and the sweep
 * would find no agents on the exhausted model and quietly do nothing, which reads exactly like a
 * healthy fleet. The version moves (Opus 4.8 → Opus 5) while the family is what a window is scoped
 * to, so the family is the only stable join key between a scoped limit and an agent.
 */
export function modelFamily(model: string): string {
  return model.trim().split(/[\s\-_/]+/)[0]?.toLowerCase() ?? ''
}

/** Below this the account itself has room, so a model switch is worth doing. At or above it the
 *  account is the constraint and switching model just moves the same pressure to another model. */
export const ACCOUNT_HEADROOM_PCT = 90

export interface FallbackInputs {
  /** The exhausted model family, lowercase (e.g. `fable`). */
  scopedModel: string
  /** That model's window utilisation, 0-100. */
  scopedPct: number
  /** The ACCOUNT's own windows, 0-100. Null when unknown. */
  account5hPct: number | null
  account7dPct: number | null
  /** Every agent the harness owns, with the model each is running. */
  agents: FallbackCandidate[]
  /** Where to fall back TO. A curated key, resolved by the injector via getAgentCommand(). */
  targetCommandKey?: string
  /** Absolute epoch ms for the FIRST action. */
  startAtMs: number
  intervalMs?: number
  /** Trip point for `scopedPct`. */
  scopedThresholdPct?: number
}

/**
 * Plan the sweep. Returns the ordered, time-spaced switches, or a NAMED reason for doing nothing.
 *
 * The two refusals are the interesting part, and both are the mirror of a mistake already made:
 *
 *  - `no-model-scoped-exhaustion` — do not switch a fleet that is not actually blocked.
 *  - `account-also-exhausted` — this is the rotator's error, inverted. It rotated the credential
 *    to escape a MODEL limit; the equal and opposite bug is switching the MODEL to escape an
 *    ACCOUNT limit. When the account is spent, no model on it has capacity, and a fleet-wide
 *    switch buys nothing while spending a burst of requests against the very limit that is
 *    already binding. The remedy there is a rotation, or waiting for the window.
 */
export function planModelFallback(input: FallbackInputs): FallbackPlan {
  const interval = input.intervalMs ?? FALLBACK_INTERVAL_MS
  const threshold = input.scopedThresholdPct ?? 97
  const target = input.targetCommandKey ?? 'model-opus'

  if (!(input.scopedPct >= threshold)) {
    return { act: false, skip: 'no-model-scoped-exhaustion' }
  }

  // An UNKNOWN account window is not a healthy one. Reading null as "fine" would let the sweep
  // fire in exactly the case it cannot reason about — the same fail-open shape that let a
  // rotator report `ok` while it was stuck.
  const worstAccount = Math.max(
    input.account5hPct ?? Number.POSITIVE_INFINITY,
    input.account7dPct ?? Number.POSITIVE_INFINITY,
  )
  if (worstAccount >= ACCOUNT_HEADROOM_PCT) {
    return { act: false, skip: 'account-also-exhausted' }
  }

  // Family-vs-family. Comparing the raw strings would never match (see modelFamily).
  const scoped = modelFamily(input.scopedModel)
  const victims = input.agents.filter(a => modelFamily(a.model) === scoped)
  if (victims.length === 0) {
    return { act: false, skip: 'no-agents-on-that-model' }
  }

  return {
    act: true,
    actions: victims.map((a, i) => ({
      agentId: a.agentId,
      name: a.name,
      commandKey: target,
      escapeFirst: true,
      confirmAfterMs: CONFIRM_DELAY_MS,
      // i * interval, NOT "now + interval each time": the caller may hand these to a scheduler
      // long after planning, and a relative chain would compound its own dispatch latency.
      dueAtMs: input.startAtMs + i * interval,
    })),
  }
}

/** True when a tick verdict indicates the fleet is stuck in a way a model switch could relieve.
 *  `stuck: 'all-maxed'` is the signature: every account failed the target test, which is what a
 *  model-scoped exhaustion looks like from the rotator's side. */
export function stuckSuggestsModelFallback(nextAction: NextAction, stuck?: string): boolean {
  return nextAction === 'stuck' && stuck === 'all-maxed'
}
