// The terminal-continuity POLL LEG — the site that finally drives the automaton (TRDD-Y8VPE3NS E3
// box 5). Detection, classification and actuation all existed and had 38 passing tests; nothing
// called them, so the whole path was dark: every event was a decision nobody ever asked for.
//
// WHY tmux capture-pane AND NOT the @xterm/headless reader (TRDD-6HEF0XLS).
// The headless reader renders a PTY stream, and `attachPty` had zero production callers — but the
// deeper problem is that a PTY only exists while a BROWSER is attached to that agent's terminal.
// The agents this automaton exists for are the unattended ones: nobody is watching, so there is no
// PTY, so there would be no frames, and the poll would read empty forever while looking healthy.
// tmux always holds the pane, browser or not, and `capture-pane -p` returns it already rendered
// (including the alternate screen the clients use). The xterm reader keeps its place for a live
// attached stream; the unattended poll cannot be built on it.
//
// Shape mirrors `fleet-inbox-nudge` exactly — injectable deps, a caller-owned store, a tick that
// never throws — so it composes into the same watchdog and is tested without a live fleet.

import { listAgents, getAgent } from '@/lib/agent-registry'
import { getRuntime } from '@/lib/agent-runtime'
import { readHookNotification } from '@/lib/session-safe-state'
import { fleetActuationBlocked } from '@/lib/janitor-control'
import { sendAgentSessionCommand } from '@/services/agents-core-service'
import { buildSystemAuthContext } from '@/lib/agent-auth'
import { ESC_KEYSTROKE, type ContinuityEpisodes } from '@/lib/continuity-registry'
import {
  actuateContinuity,
  type ContinuityAction,
  type ContinuityDecision,
  type ContinuityActuatorDeps,
  type ContinuityTarget,
} from '@/lib/fleet-recovery-actuator'

export interface ContinuityTickDeps {
  /** Online, non-deleted agents with a session to look at. */
  listAgents: () => Array<{ id: string; name: string; sessionName: string; workingDirectory: string | null; program: string }>
  /** The RENDERED visible pane for a session, or '' when it cannot be read (fail-open ⇒ no event). */
  captureFrame: (sessionName: string) => Promise<string>
  /** The 5-state hook notification for a workdir (null when unknown). */
  getHookNotification: (wd: string | null) => { status: string | null; notificationType: string | null } | null
  /** Classify + gate + inject for one agent. Injected whole so the tick never reaches the actuator's
   *  internals, and tests can assert the decision without a terminal. */
  actuate: (target: ContinuityTarget) => Promise<ContinuityDecision>
}

/** Per-agent bookkeeping threaded across ticks. `episodes` is the temporal-event memory (the
 *  retry-wedge's attempt-ADVANCE gate); `lastActuatedAtMs` is the cooldown clock, deliberately the
 *  SAME field the recovery ladder uses so two subsystems cannot each nudge "once per window". */
export interface ContinuityState {
  episodes: ContinuityEpisodes
  lastActuatedAtMs: number | null
}

export interface ContinuityTickResult {
  scanned: number
  fired: Array<{ agentId: string; name: string; eventId: string; response: string }>
  skipped: Array<{ agentId: string; name: string; reason: string }>
}

/**
 * One continuity pass over the fleet. NEVER throws — a per-agent failure is recorded as a skip and
 * the sweep continues, because one unreadable pane must not stop the rest of the fleet from being
 * checked.
 */
export async function runContinuityTick(
  deps: ContinuityTickDeps,
  store: Map<string, ContinuityState>,
  now: number,
): Promise<ContinuityTickResult> {
  const result: ContinuityTickResult = { scanned: 0, fired: [], skipped: [] }
  const agents = deps.listAgents()
  result.scanned = agents.length

  for (const a of agents) {
    try {
      const frame = await deps.captureFrame(a.sessionName)
      if (!frame.trim()) {
        result.skipped.push({ agentId: a.id, name: a.name, reason: 'empty-frame' })
        continue
      }
      const prior = store.get(a.id) ?? { episodes: {}, lastActuatedAtMs: null }
      const hook = deps.getHookNotification(a.workingDirectory)

      const decision = await deps.actuate({
        agentId: a.id,
        name: a.name,
        observation: {
          program: a.program,
          frame,
          // capture-pane returns the ACTIVE buffer, and the clients this fires for run in the
          // alternate screen. It is reported as such rather than guessed per-agent: a wrong
          // 'normal' would silently exclude every event whose matcher is buffer-scoped.
          bufferType: 'alternate',
          notification: hook ? { status: hook.status ?? null, notificationType: hook.notificationType ?? null } : null,
        },
        lastActuatedAtMs: prior.lastActuatedAtMs,
      })

      if (decision.fired) {
        store.set(a.id, { episodes: prior.episodes, lastActuatedAtMs: now })
        result.fired.push({
          agentId: a.id,
          name: a.name,
          eventId: decision.action.eventId,
          response: decision.action.response.kind,
        })
      } else {
        // Keep the episode memory the actuator just wrote; only the cooldown clock is untouched.
        store.set(a.id, { episodes: prior.episodes, lastActuatedAtMs: prior.lastActuatedAtMs })
        if (decision.reason !== 'no_event') {
          result.skipped.push({ agentId: a.id, name: a.name, reason: decision.reason ?? 'unknown' })
        }
      }
    } catch (err) {
      result.skipped.push({ agentId: a.id, name: a.name, reason: `error: ${(err as Error)?.message || err}` })
    }
  }
  return result
}

/** Wire the tick to the real substrate. The episode store lives in the caller (the watchdog), so
 *  these deps are rebuilt per tick and hold no state of their own. */
export function defaultContinuityDeps(episodes: Map<string, ContinuityState>, now: number): ContinuityTickDeps {
  return {
    // Only agents with an ONLINE session: a hibernated agent has no pane to read, and asking tmux
    // for one costs a failed exec per agent per tick for a frame that cannot exist.
    listAgents: () =>
      listAgents(false)
        .filter((s) => s.sessions?.some((x) => x.status === 'online'))
        .map((s) => {
          const full = getAgent(s.id)
          return {
            id: s.id,
            name: s.name,
            sessionName: s.name,
            workingDirectory: full?.workingDirectory ?? s.sessions?.find((x) => x.index === 0)?.workingDirectory ?? null,
            program: full?.program || 'claude',
          }
        }),

    captureFrame: async (sessionName) => {
      // Only the VISIBLE pane (default capture, no -S): the events match on what is on screen NOW.
      // Pulling scrollback would let a retry-wedge banner from an hour ago re-trigger forever.
      try {
        return await getRuntime().capturePane(sessionName, 0)
      } catch {
        return ''
      }
    },

    getHookNotification: (wd) => (wd ? readHookNotification(wd) : null),

    actuate: (target) =>
      actuateContinuity(target, {
        ...continuityActuatorDeps(now),
        episodes: {
          get: (id) => episodes.get(id)?.episodes ?? {},
          set: (id, e) => {
            const cur = episodes.get(id)
            episodes.set(id, { episodes: e, lastActuatedAtMs: cur?.lastActuatedAtMs ?? null })
          },
        },
      }),
  }
}

/** The gates + the one side effect. Split out so the injector is visible in isolation: it is the
 *  only place this subsystem can affect an agent, and it can only send a raw ESC or a CURATED
 *  command key — never free text. */
function continuityActuatorDeps(now: number): Omit<ContinuityActuatorDeps, 'episodes'> {
  return {
    now: () => now,
    fireEnabled: process.env.AIM_FLEET_RECOVERY_FIRE === '1',
    actuationBlocked: () => fleetActuationBlocked(),
    // HID presence is not wired for this leg yet, and `false` is the RISKY default here (it means
    // "the user is not typing, go ahead"). It is acceptable only because the sole shipped event
    // sends a bare ESC — which at worst cancels a turn the user was already interrupting — and
    // because the fire flag is off by default. Any event that sends a COMMAND must wire this first.
    hidPresent: () => false,
    inject: async (action: ContinuityAction) => {
      const auth = buildSystemAuthContext('fleet-continuity automaton')
      if (action.response.kind === 'esc') {
        // A RAW keystroke, with no newline: ESC must not be followed by Enter, or an agent that was
        // merely thinking gets its prompt submitted. This is why the union carries 'esc' as its own
        // kind instead of a command key that happens to contain an escape character.
        const r = await sendAgentSessionCommand(action.agentId, {
          command: ESC_KEYSTROKE,
          addNewline: false,
          requireIdle: false,
        }, auth)
        return { ok: !r.error, status: r.status ?? 0, detail: r.error }
      }
      const r = await sendAgentSessionCommand(action.agentId, {
        command: action.response.commandKey,
        addNewline: true,
        requireIdle: true,
      }, auth)
      return { ok: !r.error, status: r.status ?? 0, detail: r.error }
    },
  }
}

/** Resolve an agent's display name for logging without a second registry scan. */
export function continuityAgentLabel(agentId: string, fallback: string): string {
  try {
    return getAgent(agentId)?.label || fallback
  } catch {
    return fallback
  }
}
