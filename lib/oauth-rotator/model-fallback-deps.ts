/**
 * Production wiring for the model-fallback actuator: the real keystrokes, and the real verifier.
 *
 * This is the ONLY place the curated key becomes text. `actuateModelFallback` carries
 * `commandKey: 'model-opus'` end to end and never a command string, so the resolution happens
 * once, here, against the allowlist — an unknown key produces no keystroke at all.
 *
 * WHY NOT `enqueueCommand`. The sibling `fleet-recovery-runner` injects by enqueueing with
 * `when: 'idle'`, and copying that here would be the obvious move and would break the feature:
 * the queue drains ASYNCHRONOUSLY, possibly minutes later, while the confirming ENTER has to land
 * a few seconds after the command actually RUNS. Queued, the confirm would fire relative to the
 * ENQUEUE — answering a dialog that does not exist yet and leaving the real one unanswered. Two
 * of the three steps are not commands anyway. So this writes the pane synchronously.
 */
import { getRuntime } from '@/lib/agent-runtime'
import { getAgentCommand } from '@/lib/agent-commands'
import { computeSessionName } from '@/types/agent'
import { readPaneVerdict } from '@/services/block-state-service'
import type { InjectResult } from '@/lib/fleet-recovery-actuator'
import type { FallbackInjection, ModelFallbackDeps } from './model-fallback-actuator'
import { parsePaneModel, type FallbackCandidate } from './model-fallback'

/** Minimal shape this module needs from an agent record. */
export interface FallbackAgentRef {
  id: string
  name?: string
  workingDirectory?: string
}

/**
 * Resolve the pane an agent's PRIMARY session occupies.
 *
 * `computeSessionName(name, 0)` — deliberately NOT `agent.session?.tmuxSessionName`. The two are
 * different fields, and an earlier draft of the block-state reader used the latter while the WRITE
 * path used the former, so a read and a write could address DIFFERENT panes. Keeping every caller
 * on `computeSessionName` is what makes read-then-write coherent.
 */
export function fallbackSessionName(agent: FallbackAgentRef): string | null {
  return agent.name ? computeSessionName(agent.name, 0) : null
}

/** Map one step to its tmux keystroke. Non-literal values are tmux KEY NAMES, not text. */
export async function sendFallbackStep(
  sessionName: string,
  injection: FallbackInjection,
): Promise<InjectResult> {
  const runtime = getRuntime()
  try {
    switch (injection.step) {
      case 'esc':
        // A key NAME, not the byte: `-l` would type the four characters "Esc"+"ape".
        await runtime.sendKeys(sessionName, 'Escape')
        return { ok: true }
      case 'command': {
        const key = injection.commandKey
        const entry = key ? getAgentCommand(key) : undefined
        if (!entry) return { ok: false, detail: `unknown command key: ${key ?? '(none)'}` }
        // literal + enter: type the text, then submit it. Without `enter` the command sits in
        // the prompt unsent, no dialog is raised, and the confirming ENTER would then submit
        // that same text a beat later — the right command at the wrong moment.
        await runtime.sendKeys(sessionName, entry.command, { literal: true, enter: true })
        return { ok: true }
      }
      case 'confirm':
        await runtime.sendKeys(sessionName, 'Enter')
        return { ok: true }
    }
  } catch (err) {
    // Report, never throw: the actuator's contract is that a failed step stops the sequence
    // cleanly. A throw here would skip its "do not confirm a failed command" guard.
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Read every agent's pane once and return those whose statusline reports a running model.
 *
 * An agent whose pane cannot be read, or whose statusline is absent, is OMITTED rather than
 * defaulted — a guessed model would either switch an agent that did not need it or skip one that
 * did. The caller gets a shorter list and an honest one.
 */
export async function collectFallbackCandidates(
  agents: readonly FallbackAgentRef[],
): Promise<{ candidates: FallbackCandidate[]; unreadable: string[] }> {
  const runtime = getRuntime()
  const candidates: FallbackCandidate[] = []
  const unreadable: string[] = []
  for (const agent of agents) {
    const sessionName = fallbackSessionName(agent)
    if (!sessionName) {
      unreadable.push(agent.id)
      continue
    }
    let pane: string
    try {
      pane = await runtime.capturePane(sessionName, 40)
    } catch {
      unreadable.push(agent.id)
      continue
    }
    const model = parsePaneModel(pane)
    if (!model) {
      unreadable.push(agent.id)
      continue
    }
    candidates.push({ agentId: agent.id, name: agent.name, model })
  }
  return { candidates, unreadable }
}

/**
 * The production deps. `fireEnabled` is the caller's — there is no default true anywhere on this
 * path, because a master switch that defaults ON is not a master switch.
 */
export function defaultModelFallbackDeps(
  fireEnabled: boolean,
  agentsById: (id: string) => FallbackAgentRef | undefined,
  now: () => number = Date.now,
): ModelFallbackDeps {
  return {
    fireEnabled,
    hidPresent: () => false, // caller overrides with the real presence probe
    now,
    inject: async (injection) => {
      const agent = agentsById(injection.agentId)
      const sessionName = agent ? fallbackSessionName(agent) : null
      if (!sessionName) return { ok: false, detail: `no session for agent ${injection.agentId}` }
      return sendFallbackStep(sessionName, injection)
    },
    verify: async (agentId) => {
      const agent = agentsById(agentId)
      if (!agent) return null
      const pane = await readPaneVerdict(agent.name, 0, agent.workingDirectory)
      if (!pane.ok) return null
      return { blocked: pane.verdict.blocked, reason: pane.verdict.reason }
    },
    // actuationBlocked defaults to the real janitor-control gate inside the actuator.
  }
}
