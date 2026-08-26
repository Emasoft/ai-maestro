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

import { execFile } from 'child_process'
import { promisify } from 'util'
import { listAgents, getAgent } from '@/lib/agent-registry'
import { getRuntime } from '@/lib/agent-runtime'
import { readHookNotification } from '@/lib/session-safe-state'
import { fleetActuationBlocked } from '@/lib/janitor-control'
import { sendAgentSessionCommand } from '@/services/agents-core-service'
import { buildSystemAuthContext } from '@/lib/agent-auth'
import { getAgentCommand } from '@/lib/agent-commands'
import { ESC_KEYSTROKE, findClientEntry, normalizeProgram, type ContinuityEpisodes } from '@/lib/continuity-registry'
import {
  actuateContinuity,
  type ContinuityAction,
  type ContinuityDecision,
  type ContinuityActuatorDeps,
  type ContinuityTarget,
} from '@/lib/fleet-recovery-actuator'

const execFileAsync = promisify(execFile)

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
        // Threaded so a multi-step response (esc-then-command, TRDD-U6AS2YWB) can re-read THIS
        // pane between keystrokes. Absent, the injector refuses that kind rather than flying blind.
        sessionName: a.sessionName,
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

      // RE-READ the store: `actuate` writes the episode memory for this agent (the actuator's
      // `episodes.set` dep points at THIS map), and `prior` was captured BEFORE that write. Writing
      // `prior.episodes` back here would clobber the marker the actuator just recorded, so a
      // temporal event could never observe an advance between polls and could never fire at all —
      // silently turning the whole poll leg into a no-op that still logs like a healthy scan.
      const episodes = store.get(a.id)?.episodes ?? prior.episodes

      if (decision.fired) {
        store.set(a.id, { episodes, lastActuatedAtMs: now })
        result.fired.push({
          agentId: a.id,
          name: a.name,
          eventId: decision.action.eventId,
          response: decision.action.response.kind,
        })
      } else {
        // Keep the episode memory the actuator just wrote; only the cooldown clock is untouched.
        store.set(a.id, { episodes, lastActuatedAtMs: prior.lastActuatedAtMs })
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
      const frame = await getRuntime().capturePane(sessionName, 0)
      if (frame.trim()) return frame

      // EMPTY — but WHICH empty? `capturePane` swallows its own errors and returns '' after its
      // internal fallback (agent-runtime.ts `capturePane`, the trailing `catch { return '' }`), so a
      // session that cannot be read and a genuinely blank pane arrive here as the SAME value, and
      // both render as the benign-sounding `empty-frame` skip. That ambiguity is why this leg logged
      // 556 consecutive total failures that looked exactly like 556 quiet agents for two weeks
      // (TRDD-7UWQ92WK). So ask tmux ONE more time, directly, and let the error propagate: the tick
      // turns a throw into an `error: <what tmux said>` skip, which a human can tell apart from a
      // quiet agent at a glance. The extra exec only ever runs on the already-broken path, and the
      // shared primitive — ~10 other callers, several already defended with `.catch(() => '')` — is
      // deliberately left exactly as it is.
      await execFileAsync('tmux', ['capture-pane', '-t', sessionName, '-p'], { timeout: 3000 })
      return ''
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

/** Delay between an injected ESC and the frame re-read that decides whether the menu is gone
 *  (esc-then-command, TRDD-U6AS2YWB). Long enough for the TUI to repaint after the keystroke;
 *  short enough that maxEsc(≈5) bounds the whole flood under ~3 s. */
export const ESC_RECHECK_DELAY_MS = 400

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** The gates + the one side effect. Split out so the injector is visible in isolation: it is the
 *  only place this subsystem can affect an agent, and it can only send a raw ESC or a CURATED
 *  command key — never free text. Exported for tests: the esc-then-command loop is behavior the
 *  tick-level fakes cannot reach (they replace `actuate` whole). */
export function continuityActuatorDeps(now: number): Omit<ContinuityActuatorDeps, 'episodes'> {
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
      if (action.response.kind === 'esc-then-command') {
        // TRDD-U6AS2YWB (E4). Dismiss a blocking modal menu with bounded ESCs — re-reading the
        // FRAME between keystrokes, because "the menu is gone" is only observable on screen (the
        // foreground process stays the client TUI throughout, so waitForShellReady-style probes
        // can never answer it) — then type ONE curated command.
        //
        // FAIL DIRECTION, chosen deliberately at every branch: anything unverifiable ABORTS
        // WITHOUT SENDING THE COMMAND. A directive typed into an unknown screen state is worse
        // than a stalled agent (the stall is caught again next poll; the mistyped directive is
        // an action taken in the agent's name). So: no sessionName → refuse; event not found for
        // the re-check → refuse; matcher throws → treat as STILL PRESENT; menu survives maxEsc →
        // refuse. NOTE for event authors: the re-check evaluates the event's own matcher against
        // a fresh frame with `notification: null` AND `bufferType: 'alternate'` hardcoded, so an
        // esc-then-command event MUST match on the frame TEXT alone — a notification- or
        // bufferType-keyed matcher would read "gone" while the menu is still up.
        const { commandKey, maxEsc } = action.response
        const sessionName = action.sessionName
        if (!sessionName) {
          return { ok: false, status: 0, detail: 'esc-then-command: no sessionName to re-check the frame — refusing' }
        }
        const entry = findClientEntry(action.program)
        const event = entry?.events.find((e) => e.id === action.eventId)
        if (!entry || !event) {
          return { ok: false, status: 0, detail: `esc-then-command: event ${action.eventId} not found for re-check — refusing` }
        }
        let dismissed = false
        for (let i = 0; i < maxEsc; i++) {
          const esc = await sendAgentSessionCommand(action.agentId, {
            command: ESC_KEYSTROKE,
            addNewline: false,
            requireIdle: false,
          }, auth)
          if (esc.error) return { ok: false, status: esc.status ?? 0, detail: esc.error }
          await sleep(ESC_RECHECK_DELAY_MS)
          const frame = await getRuntime().capturePane(sessionName, 0).catch(() => '')
          let stillPresent = true
          try {
            stillPresent = event.match({ program: action.program, frame, bufferType: 'alternate', notification: null })
          } catch {
            stillPresent = true // unverifiable ⇒ assume the menu is still up ⇒ keep ESCing / abort
          }
          if (!stillPresent) { dismissed = true; break }
        }
        if (!dismissed) {
          return { ok: false, status: 0, detail: `esc-then-command: menu still present after ${maxEsc} ESC — command NOT sent` }
        }
        // FOREGROUND PRE-SEND GUARD (adversarial-review finding, and the card's own instrument
        // aimed at the case it IS right for): "menu gone from the frame" cannot distinguish
        // "dismissed" from "client DIED" — both show a frame without the menu, and requireIdle
        // is no help (`isSessionIdle` is an activity clock whose no-activity default is IDLE, so
        // a crashed pane passes it perfectly). If claude exited mid-flood, the send below would
        // type the free-text directive into a SHELL with a newline — unattended text executed at
        // a shell prompt, the exact class the curated boundary exists to prevent. So: the
        // foreground process must still BE the client program, else abort without sending. A
        // runtime without getForegroundCommand, a throw, or a mismatch all refuse.
        // MEASURED (2026-08-26), twice, because the first accept-set was wrong both times:
        //  - tmux `#{pane_current_command}` returns a BARE process name ('zsh' — no path/args);
        //  - a LIVE claude pane reported `2.1.246` — Claude Code renames its process to its
        //    VERSION string, so no static name list ('claude', aliases, 'node') can accept it,
        //    and the naive guard would have silently disabled the whole command half while the
        //    suite stayed green (the mock fed the assumed value).
        // So the guard asks the question the hazard actually poses — "did the pane fall back to
        // a SHELL?" — and stays fail-closed everywhere else: accept only the registry entry's
        // program/aliases (measured 'claude' installs) or a pure version string (the measured
        // renamed form); abort on empty (probe failed), on any known shell name, and on any
        // OTHER unknown foreground. An unknown non-shell may be a legitimate client form we have
        // not measured — it still aborts, because a lost directive costs one poll cycle and a
        // mistyped one acts in the agent's name.
        const runtime = getRuntime()
        const fg = runtime.getForegroundCommand
          ? await runtime.getForegroundCommand(sessionName).catch(() => '')
          : ''
        const fgBase = normalizeProgram(fg) ?? ''
        const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'fish', 'tcsh', 'csh', 'dash', 'ksh', 'pwsh', 'login'])
        const accepted = [entry.program, ...(entry.aliases ?? [])]
          .map((p) => normalizeProgram(p))
          .filter((p): p is string => p !== null)
        const isVersionName = /^\d+(\.\d+)+$/.test(fgBase) // the measured renamed-client shape
        const fgOk = fgBase !== '' && !SHELL_NAMES.has(fgBase) && (accepted.includes(fgBase) || isVersionName)
        if (!fgOk) {
          return {
            ok: false,
            status: 0,
            detail: `esc-then-command: foreground is '${fgBase || '(unknown)'}' (accepted: [${accepted.join(', ')}] or a version-named client) — client gone or unverifiable, command NOT sent`,
          }
        }
        const curatedDirective = getAgentCommand(commandKey)
        if (!curatedDirective) {
          return { ok: false, status: 0, detail: `unknown command key: ${commandKey}` }
        }
        const send = await sendAgentSessionCommand(action.agentId, {
          // requireIdle:true doubles as "the tool-rejection turn has settled": the directive
          // lands at a typeable prompt, never into a still-running turn.
          requireIdle: true,
          command: curatedDirective.command,
          addNewline: true,
        }, auth)
        return { ok: !send.error, status: send.status ?? 0, detail: send.error }
      }
      // RESOLVE the curated key to its literal command. `sendAgentSessionCommand` types whatever
      // string it is given straight into the pane, so passing the KEY would type `compact` instead
      // of `/compact` — a word into the prompt, not a command. The actuator already proved the key
      // exists (its `unknown_command_key` gate), so a miss here is a contract break, not user input:
      // refuse rather than type the raw key.
      const curated = getAgentCommand(action.response.commandKey)
      if (!curated) {
        return { ok: false, status: 0, detail: `unknown command key: ${action.response.commandKey}` }
      }
      const r = await sendAgentSessionCommand(action.agentId, {
        // HARDCODED true, deliberately — do NOT relax this to `curated.requiresIdle`. That field
        // says what a HUMAN-initiated send of this command needs; this injector is unattended and
        // runs with `hidPresent: () => false`, so it has no way to know a person is not mid-turn.
        // Every curated command happens to be `requiresIdle: true` today, which is exactly what
        // makes the swap look free: it would change nothing until someone adds a command with the
        // flag off, and then this gate would disappear silently, in a file nobody was editing.
        requireIdle: true,
        command: curated.command,
        addNewline: true,
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
