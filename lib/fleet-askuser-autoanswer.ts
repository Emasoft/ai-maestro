/**
 * AskUser auto-answer — accept the DEFAULT option of a selection menu an agent has been
 * parked on, so an unattended fleet does not stall forever on `ask_user` (the block state
 * `lib/agent-block-state.ts` documents as "the case that blocks forever").
 *
 * THE ONE INVARIANT THAT IS NOT TUNABLE: this leg answers `ask_user` menus ONLY — NEVER a
 * `permission` prompt. A tool-permission prompt IS the user's permission system; auto-
 * confirming one would silently approve arbitrary tool use, which is a security bypass, not
 * a convenience. The classifier already separates the two (a permission prompt names the
 * tool it asks about); this module hard-refuses the `permission` reason at every layer.
 *
 * Why ENTER and not a digit: ENTER accepts the currently-HIGHLIGHTED row, which is the menu's
 * default (Claude Code opens AskUserQuestion with the recommended option selected). A digit
 * would OVERRIDE the default with our guess — the task is "answer with the default", so the
 * default is what we accept. On a multi-select menu ENTER submits the default selection state,
 * which is the same contract.
 *
 * Why ENTER is dangerous, and the three guards that make it safe (learned from
 * `model-fallback-actuator.ts`: "a bare ENTER into a live prompt SUBMITS whatever text is
 * sitting in it"):
 *   1. DWELL — the menu must have been open, UNCHANGED, for at least `dwellMs` before it is
 *      answered. A menu the human is actively reading, or one drawn a second ago, is not ours.
 *   2. RE-VERIFY — the pane is re-read immediately before the keystroke and must still show
 *      the SAME menu (same signature). If the human answered it in the gap, we do nothing.
 *   3. LOCKOUT — the same menu signature is never answered twice within `lockoutMs`. If our
 *      ENTER did not dismiss it, hammering ENTER at it is a runaway; a human must look.
 *
 * Ships DARK: the watchdog leg is enabled only by AIM_FLEET_ASKUSER_AUTOANSWER=1, for the same
 * reason as the model-fallback leg — no test can prove the ENTER actually dismissed a real
 * menu, only that the keystroke was sent. Arming it is a deliberate human act.
 *
 * Everything is injected (pane reads, the keystroke, the clock), so the whole decision ladder
 * is testable without a live fleet. The gates are IMPORTED from `fleet-recovery-actuator`,
 * never re-implemented (TRDD-X8801GT4: a duplicated gate is one more place the fleet can be
 * actuated while the owner believes it is halted).
 */
import {
  checkEntryGates,
  checkInjectionGates,
  type GateBlockReason,
  type GateDeps,
  type InjectResult,
} from '@/lib/fleet-recovery-actuator'
import { getRuntime } from '@/lib/agent-runtime'
import { computeSessionName } from '@/types/agent'
import { readPaneVerdict } from '@/services/block-state-service'

/** Minimal shape this module needs from an agent record. */
export interface AskUserAgentRef {
  id: string
  name?: string
  workingDirectory?: string
}

/** What the tick needs to know about one pane: the block reason plus the menu's identity. */
export interface AskUserVerdict {
  reason: string
  /** The question lines above the choices — part of the menu's identity. */
  question: string
  choices: { key: string; label: string }[]
}

/** Per-agent memory across ticks: the open menu's dwell clock, and the last answer sent. */
export interface AskUserState {
  /** Signature of the menu currently observed open, or null when the agent is not on one. */
  signature: string | null
  firstSeenAtMs: number
  /** The last menu this leg answered, kept even after the menu closes — the lockout memory. */
  answeredSignature: string | null
  answeredAtMs: number
}

export interface AskUserAnswerDeps extends GateDeps {
  /** Fresh pane verdict for one agent; null when the pane is unreadable. */
  readVerdict: (agent: AskUserAgentRef) => Promise<AskUserVerdict | null>
  /** THE side effect: one ENTER keystroke into the agent's pane. */
  inject: (agent: AskUserAgentRef) => Promise<InjectResult>
  /** Per-agent last actuation — the SAME clock the recovery ladder stamps, so the cooldown is
   *  per agent, not per subsystem. */
  lastActuatedAtMs: (agentId: string) => number | null
  /** Injectable delay for the post-answer settle, so tests do not wait real seconds. */
  sleep?: (ms: number) => Promise<void>
  settleMs?: number
  dwellMs?: number
  lockoutMs?: number
}

/** A menu must sit unchanged this long before it is answered. The watchdog beats every 5 min,
 *  so in production the effective dwell is at least one full beat; this floor exists so a
 *  faster caller cannot answer a menu the instant it appears. */
export const ASKUSER_DWELL_MS = 120_000

/** Never answer the same menu signature twice within this window. */
export const ASKUSER_LOCKOUT_MS = 30 * 60_000

/** How long the dialog gets to react to ENTER before the post-condition read. */
export const ASKUSER_SETTLE_MS = 1_500

export type AskUserSkipReason =
  | 'permission_menu' // NEVER answered — the security invariant, reported so it is visible
  | 'dwell'           // menu too fresh (or it changed, restarting the clock)
  | 'lockout'         // this exact menu was already answered recently and did not dismiss
  | 'cooldown'        // per-agent actuation cooldown (shared with the recovery ladder)
  | 'hid_present'     // user at the keyboard — their menu, not ours
  | 'menu_gone'       // re-verify found the menu no longer open — nothing sent
  | 'menu_changed'    // re-verify found a DIFFERENT menu — nothing sent, dwell restarted
  | 'unreadable'      // pane could not be read

export interface AskUserTickResult {
  /** Entry-gate refusal (fire flag / machine-wide STOP). When set, nothing was read at all. */
  blocked?: GateBlockReason
  answered: {
    agentId: string
    name?: string
    /** The default option ENTER accepted — the first row, which is where Claude Code parks
     *  the highlight. Reported for the log; the keystroke itself chooses nothing. */
    defaultLabel: string
    question: string
    /** true = menu dismissed · false = still open after ENTER · null = pane unreadable after. */
    confirmed: boolean | null
    detail?: string
  }[]
  skipped: { agentId: string; name?: string; reason: AskUserSkipReason; detail?: string }[]
}

/** The menu's identity: the question plus every row. A changed question or changed rows is a
 *  DIFFERENT menu, and the dwell clock restarts. */
export function menuSignature(v: AskUserVerdict): string {
  return JSON.stringify([v.question, v.choices.map((c) => `${c.key}. ${c.label}`)])
}

/**
 * Run one auto-answer tick over the fleet. Answers AT MOST ONE agent per invocation — the
 * same self-draining design as the model-fallback sweep: an answered agent is no longer
 * `ask_user`-blocked, so the next tick's re-read simply does not find it. No plan to persist,
 * nothing to reconcile after a crash.
 */
export async function runAskUserAutoAnswerTick(
  agents: readonly AskUserAgentRef[],
  store: Map<string, AskUserState>,
  deps: AskUserAnswerDeps,
): Promise<AskUserTickResult> {
  const now = deps.now ?? Date.now
  const dwellMs = deps.dwellMs ?? ASKUSER_DWELL_MS
  const lockoutMs = deps.lockoutMs ?? ASKUSER_LOCKOUT_MS

  // Entry gates FIRST, so an OFF (or machine-wide-STOPPED) leg performs no I/O at all.
  const entry = checkEntryGates(deps)
  if (!entry.ok) return { blocked: entry.reason, answered: [], skipped: [] }

  const result: AskUserTickResult = { answered: [], skipped: [] }
  let fired = false

  for (const agent of agents) {
    const verdict = await deps.readVerdict(agent)
    const prior = store.get(agent.id)

    if (!verdict) {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: 'unreadable' })
      continue
    }

    // THE SECURITY INVARIANT. A permission prompt is never answered, and never silently:
    // it is reported every tick so a human sees the fleet is parked on one.
    if (verdict.reason === 'permission') {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: 'permission_menu' })
      continue
    }

    if (verdict.reason !== 'ask_user') {
      // Not on a menu: the dwell clock dies with the menu, the lockout memory survives it —
      // a recurring identical menu must still be lockout-refused, or a menu our ENTER keeps
      // failing to dismiss gets hammered once per reappearance.
      if (prior && prior.signature !== null) store.set(agent.id, { ...prior, signature: null })
      continue
    }

    const sig = menuSignature(verdict)

    // Dwell bookkeeping: a new or changed menu restarts the clock.
    if (!prior || prior.signature !== sig) {
      store.set(agent.id, {
        signature: sig,
        firstSeenAtMs: now(),
        answeredSignature: prior?.answeredSignature ?? null,
        answeredAtMs: prior?.answeredAtMs ?? 0,
      })
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: 'dwell' })
      continue
    }
    if (now() - prior.firstSeenAtMs < dwellMs) {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: 'dwell' })
      continue
    }

    // Lockout: this exact menu was answered already and is evidently still open.
    if (prior.answeredSignature === sig && now() - prior.answeredAtMs < lockoutMs) {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: 'lockout' })
      continue
    }

    // Per-agent injection gates (HID + the ladder-shared cooldown).
    const ready = checkInjectionGates(deps.lastActuatedAtMs(agent.id), deps)
    if (!ready.ok) {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: ready.reason as AskUserSkipReason, detail: ready.detail })
      continue
    }

    // One answer per tick: agents after the first eligible one wait for the next beat.
    if (fired) continue

    // RE-VERIFY immediately before the keystroke. Between the scan read above and this point
    // a human may have answered the menu; ENTER must never land on whatever replaced it.
    const fresh = await deps.readVerdict(agent)
    if (!fresh || fresh.reason !== 'ask_user') {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: 'menu_gone' })
      if (prior.signature !== null) store.set(agent.id, { ...prior, signature: null })
      continue
    }
    if (menuSignature(fresh) !== sig) {
      // A different question is now open — restart its dwell rather than answer it blind.
      store.set(agent.id, { ...prior, signature: menuSignature(fresh), firstSeenAtMs: now() })
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: 'menu_changed' })
      continue
    }

    const res = await deps.inject(agent)
    fired = true
    store.set(agent.id, { ...prior, answeredSignature: sig, answeredAtMs: now() })

    if (!res.ok) {
      result.answered.push({
        agentId: agent.id,
        name: agent.name,
        defaultLabel: fresh.choices[0]?.label ?? '(unknown)',
        question: fresh.question,
        confirmed: null,
        detail: `inject failed: ${res.detail ?? 'unknown'}`,
      })
      continue
    }

    // Post-condition: did the menu actually dismiss? Without this the leg reports success for
    // having SENT a keystroke — the weakest possible claim.
    await (deps.sleep ?? defaultSleep)(deps.settleMs ?? ASKUSER_SETTLE_MS)
    const after = await deps.readVerdict(agent)
    result.answered.push({
      agentId: agent.id,
      name: agent.name,
      defaultLabel: fresh.choices[0]?.label ?? '(unknown)',
      question: fresh.question,
      confirmed: after === null ? null : after.reason !== 'ask_user',
      detail: after?.reason === 'ask_user' ? 'menu still open after ENTER' : undefined,
    })
  }

  return result
}

/**
 * Production deps. The keystroke is a tmux key NAME (`Enter`), never text — there is no
 * command string on this path at all, so the injection-proof property of the curated-key
 * boundary holds trivially: nothing that could be typed exists to be typed.
 */
export function defaultAskUserAnswerDeps(
  fireEnabled: boolean,
  lastActuatedAtMs: (agentId: string) => number | null,
  now: () => number = Date.now,
): AskUserAnswerDeps {
  return {
    fireEnabled,
    hidPresent: () => false, // caller overrides with the real presence probe when it has one
    now,
    lastActuatedAtMs,
    readVerdict: async (agent) => {
      if (!agent.name) return null
      const pane = await readPaneVerdict(agent.name, 0, agent.workingDirectory)
      if (!pane.ok) return null
      return {
        reason: pane.verdict.reason,
        question: pane.verdict.excerpt.join('\n'),
        choices: pane.verdict.choices,
      }
    },
    inject: async (agent) => {
      if (!agent.name) return { ok: false, detail: `no session for agent ${agent.id}` }
      // `computeSessionName(name, 0)` — the SAME resolution the read path uses, so the pane we
      // verified and the pane we answer are the same pane by construction (see
      // `block-state-service.readPaneVerdict`'s session-name warning).
      const sessionName = computeSessionName(agent.name, 0)
      try {
        await getRuntime().sendKeys(sessionName, 'Enter')
        return { ok: true }
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
