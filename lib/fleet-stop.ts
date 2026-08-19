// The absorbed fleet-stop lane (TRDD-9FW92242) — a port of the janitor's daemon-driven fleet
// disarm beat: `daemon.py::task_fleet_stop` + the PURE policy `lib/fleet_stop.py`
// (janitor cache 3.3.16, cadence 60 s, TRDD-ME8V2YJF).
//
// WHAT IT DOES: when the machine-wide kill-switch is set, deliver the STOP command
// (`/janitor-disarm`) to every janitor-armed session — so an ALREADY-armed fleet stops with no
// human present (sessions whose baked-in cron prompt predates the self-disarm marker never see
// `[janitor-self-disarm]` on their own).
//
// PAUSE IS GONE. The card text predates the janitor's own removal of the pause flag (owner
// directive 2026-07-31, quoted in `global_state.py::fleet_stop_flag_state`): "a stop that
// leaves the daemon alive but idle is precisely the silent-disable shape that caused the
// incident". This port carries the CURRENT semantics — `disarm` only.
//
// THE TWO POPULATIONS, TWO CHANNELS (the card's split; the daemon's own `server_owned` skip is
// the mirror image of this lane existing at all — TRDD-PZLVT2RN: harness agents receive their
// global control from the SERVER):
//   1. REGISTERED AGENTS → the authenticated command queue (`enqueueCommand`, commandKey
//      `janitor-disarm`, when:'idle') — the server's own principal, injection-proof by
//      construction (the key resolves to a compile-time literal). Delivery at idle is the
//      queue's contract; a wedged agent is the fleet-recovery lane's job, after which the
//      queue drains. Stamp on ACCEPT; a 409 (queue occupied) retries next beat unstamped.
//   2. JANITOR-ARMED NON-AGENT SESSIONS → the validated tmux channel discovered by
//      `gatherJanitorSessions` (TRDD-99LV0U4I — this lane is the "actuation lane" its
//      detect-only watchdog names). SOFT injection only (literal send-keys + Enter, no ESC):
//      the 99LV0U4I port deliberately did not carry the frozen-diagnosis ladder, and an ESC
//      into an undiagnosed session could cancel live work. A session with NO tmux pane is
//      skipped WITHOUT a stamp (the janitor's AM8JD9SG F2 delivery honesty: never stamp
//      "delivered" at a target you cannot reach).
//
// THE THREE GATES (ported verbatim from the janitor's docstring):
//   1. DEFAULT-OFF — AIM_FLEET_STOP=1 to arm (their CLAUDE_PLUGIN_OPTION_FLEET_STOP_ENABLED).
//      Unarmed the beat is DETECT-ONLY: plans are logged, nothing fires, nothing stamps,
//      nothing claims (the janitor daemon keeps the chore — CONDITIONAL_CHORES shape).
//   2. NEVER this process, the janitor daemon, a non-claude pid, or a session whose
//      transcript is ADVANCING; while the human is at the keyboard (HID within 60 s) EVERY
//      session counts user-active — the flag is held, so deferring costs nothing.
//   3. DEDUPE per (target, flag): a held flag injects each target exactly once (stamps
//      persisted in OUR state root, never the janitor's); clearing the flag forgets the
//      stamps so a re-set re-injects. Queue targets key on agentId, tmux targets on pid —
//      the janitor keyed everything on pid, but a queue target's stable identity is its
//      agentId (pids change across restarts while the agent persists).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fleetControlFlagPresent } from '@/lib/janitor-control'
import { markChoreLive, stampChoreRun, unmarkChoreLive } from '@/lib/janitor-chore-stamp'
import { statePath } from '@/lib/ecosystem-constants'

const execFileAsync = promisify(execFile)

export const FLEET_STOP_ENQUEUED_BY = 'system-fleet-stop'
export const HID_PRESENCE_WINDOW_SECONDS = 60 // same window as fleet-recovery
const DEFAULT_INTERVAL_MS = 60_000 // the janitor's cadence (daemon.py:174, 60 s)

// ── the PURE policy (fleet_stop.py, line for line where the model allows) ──────────────────────

/** Master opt-in. DEFAULT-OFF — typing into another session's pane is a powerful capability,
 *  so it ships inert. Same truthy set as the janitor's. */
export function fleetStopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.AIM_FLEET_STOP ?? '0').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

/** disarm → /janitor-disarm; anything else → null. Pause is GONE (see the header). */
export function stopCommandFor(flagState: string | null): string | null {
  return flagState === 'disarm' ? '/janitor-disarm' : null
}

/** `"disarm"` iff the machine-wide kill-switch is set, else null — read from the janitor's
 *  control plane READ-ONLY via lib/janitor-control (we never write their files). */
export function fleetStopFlagState(): 'disarm' | null {
  return fleetControlFlagPresent('kill-switch.flag') ? 'disarm' : null
}

export interface StopSession {
  /** queue = a registered agent (identity: agentId); tmux = a janitor-armed non-agent
   *  session (identity: pid, channel: tmuxPane). */
  channel: 'queue' | 'tmux'
  agentId?: string
  pid?: number
  tmuxPane?: string | null
  /** transcript advancing / live user work — never inject (gate 2). */
  userActive?: boolean
}

export interface StopPlan {
  channel: 'queue' | 'tmux'
  agentId?: string
  pid?: number
  tmuxPane?: string
  command: string
  dedupeKey: string
}

/** The stable dedupe key for one (target, flag) injection. */
export function injectionStampKey(target: StopSession, flagState: string): string {
  return target.channel === 'queue' ? `agent:${target.agentId}:${flagState}` : `pid:${target.pid}:${flagState}`
}

/** PURE. One plan per target that should be stopped and has not already been. */
export function selectStopTargets(
  sessions: readonly StopSession[],
  opts: { flagState: string | null; alreadyInjected: ReadonlySet<string>; hidPresent: boolean },
): StopPlan[] {
  const command = stopCommandFor(opts.flagState)
  if (command === null || opts.flagState === null) return []
  const plans: StopPlan[] = []
  for (const sess of sessions) {
    // THE TYPING GATE (janitor TRDD-6Q0OYYYH): human at the keyboard ⇒ EVERY session counts
    // user-active. The flag is held, so deferring costs nothing.
    if (opts.hidPresent || sess.userActive) continue
    if (sess.channel === 'queue' && !sess.agentId) continue
    if (sess.channel === 'tmux') {
      if (!sess.pid || sess.pid <= 0) continue
      // F2 delivery honesty: no pane = no channel — skip WITHOUT burning the dedupe stamp,
      // so the first beat that CAN reach the session injects for real.
      if (!sess.tmuxPane?.trim()) continue
    }
    const key = injectionStampKey(sess, opts.flagState)
    if (opts.alreadyInjected.has(key)) continue
    plans.push({
      channel: sess.channel,
      ...(sess.agentId !== undefined && { agentId: sess.agentId }),
      ...(sess.pid !== undefined && { pid: sess.pid }),
      ...(sess.channel === 'tmux' && { tmuxPane: sess.tmuxPane!.trim() }),
      command,
      dedupeKey: key,
    })
  }
  return plans
}

// ── dedupe stamps (OUR state root — requirement-3 geometry, never the janitor's dir) ───────────

export function fleetStopStampsPath(): string {
  return statePath('state', 'fleet-stop-injections.json')
}

export function readStamps(file: string = fleetStopStampsPath()): Record<string, number> {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {} // fail-open: a lost stamp re-injects once — the safe direction for an idempotent command
  }
}

function writeStamps(stamps: Record<string, number>, file: string = fleetStopStampsPath()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(stamps), 'utf8')
    fs.renameSync(tmp, file)
  } catch {
    // best-effort: a lost write re-injects once (idempotent command)
  }
}

export function clearStamps(file: string = fleetStopStampsPath()): void {
  try {
    fs.unlinkSync(file)
  } catch {
    // absent = already clear
  }
}

// ── the beat ───────────────────────────────────────────────────────────────────────────────────

export interface FleetStopDeps {
  flagState?: () => 'disarm' | null
  /** both populations, already tagged with channel + userActive (the scheduler wires the
   *  registry + gatherJanitorSessions defaults). */
  sessions?: () => Promise<StopSession[]>
  hidPresent?: () => boolean
  /** queue channel: returns true iff the enqueue was ACCEPTED (stamp), false on 409/refusal
   *  (retry next beat, no stamp). */
  enqueue?: (agentId: string, command: string) => boolean
  /** tmux channel: soft literal injection. Throws/false ⇒ no stamp. */
  sendToPane?: (pane: string, command: string) => Promise<boolean>
  stampsFile?: string
  stamp?: () => void
  log?: (msg: string) => void
  armed?: boolean
}

export interface FleetStopResult {
  flag: 'disarm' | null
  planned: number
  fired: number
}

export async function runFleetStop(deps: FleetStopDeps = {}): Promise<FleetStopResult> {
  const log = deps.log ?? ((m: string) => console.warn(m))
  const stampsFile = deps.stampsFile ?? fleetStopStampsPath()
  deps.stamp?.()
  const flag = (deps.flagState ?? fleetStopFlagState)()
  if (flag === null) {
    // No flag → forget every stamp so a FUTURE disarm re-injects each session fresh.
    clearStamps(stampsFile)
    return { flag: null, planned: 0, fired: 0 }
  }
  const sessions = await (deps.sessions ?? (async () => []))()
  const stamps = readStamps(stampsFile)
  const plans = selectStopTargets(sessions, {
    flagState: flag,
    alreadyInjected: new Set(Object.keys(stamps)),
    hidPresent: (deps.hidPresent ?? (() => false))(),
  })
  if (plans.length === 0) return { flag, planned: 0, fired: 0 }
  if (!deps.armed) {
    log(
      `[fleet-stop] kill-switch set — would deliver /janitor-disarm to ${plans.length} target(s): ` +
        plans.map((p) => p.dedupeKey).join(', ') +
        ' [detect-only: AIM_FLEET_STOP not set]',
    )
    return { flag, planned: plans.length, fired: 0 }
  }
  let fired = 0
  for (const p of plans) {
    let ok = false
    try {
      ok =
        p.channel === 'queue'
          ? (deps.enqueue ?? (() => false))(p.agentId!, p.command)
          : await (deps.sendToPane ?? (() => Promise.resolve(false)))(p.tmuxPane!, p.command)
    } catch (err) {
      log(`[fleet-stop] ${p.dedupeKey}: FAILED ${err instanceof Error ? err.message : err}`)
    }
    if (ok) {
      fired++
      stamps[p.dedupeKey] = Math.floor(Date.now() / 1000)
      log(`[fleet-stop] delivered ${p.command} → ${p.dedupeKey} (${p.channel})`)
    }
  }
  if (fired > 0) writeStamps(stamps, stampsFile)
  return { flag, planned: plans.length, fired }
}

/** Production tmux delivery: literal keys, then Enter — the same no-shell shape as
 *  agent-runtime.sendKeys, aimed at a PANE id instead of a session name. */
export async function sendStopToPane(pane: string, command: string): Promise<boolean> {
  await execFileAsync('tmux', ['send-keys', '-t', pane, '-l', command])
  await execFileAsync('tmux', ['send-keys', '-t', pane, 'Enter'])
  return true
}

// ── scheduler ──────────────────────────────────────────────────────────────────────────────────

export function startFleetStopScheduler(
  opts: { intervalMs?: number; log?: (msg: string) => void; runBeat?: () => Promise<FleetStopResult> } = {},
): (() => void) | null {
  const raw = Number(process.env.AIM_FLEET_STOP_INTERVAL_MS)
  const intervalMs = opts.intervalMs ?? (Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_INTERVAL_MS)
  if (!intervalMs || intervalMs <= 0) return null
  const armed = fleetStopEnabled()
  const log = opts.log ?? ((msg: string) => console.warn(msg))
  const runBeat =
    opts.runBeat ??
    (async () => {
      // Wired lazily so the module stays import-light for tests; every collaborator is the
      // production default the header names.
      const [{ listAgents, getAgent }, { gatherJanitorSessions, SESSION_ACTIVE_FRESH_S }, { enqueueCommand }, presence] =
        await Promise.all([
          import('@/lib/agent-registry'),
          import('@/lib/fleet-session-scan'),
          import('@/lib/command-queue'),
          import('@/lib/user-presence'),
        ])
      const agents = listAgents(false)
      // AgentSummary carries NO workingDirectory — resolve each root the way the liveness
      // watchdog does (getAgent, falling back to the index-0 session's workingDirectory).
      // A vacuous cast here would leave `roots` empty, the registry filter inert, and every
      // REGISTERED agent's pane double-targeted through the tmux channel (the caller-shape
      // trap: lessons-verification "a shared helper is correct only for its caller's shape").
      const roots = new Set(
        agents
          .map((a) => getAgent(a.id)?.workingDirectory ?? a.sessions?.find((x) => x.index === 0)?.workingDirectory)
          .filter((wd): wd is string => typeof wd === 'string' && wd.length > 0),
      )
      const janitorSessions = await gatherJanitorSessions({ isRegistryRoot: (r) => roots.has(r) })
      const sessions: StopSession[] = [
        ...agents.map((a) => ({ channel: 'queue' as const, agentId: a.id })),
        ...janitorSessions.map((s) => ({
          channel: 'tmux' as const,
          pid: s.pid,
          tmuxPane: s.tmuxPane,
          // transcript advancing = the user's live work (gate 2)
          userActive: s.transcriptAgeS !== null && s.transcriptAgeS < SESSION_ACTIVE_FRESH_S,
        })),
      ]
      return runFleetStop({
        armed,
        log,
        sessions: async () => sessions,
        hidPresent: () => {
          const p = presence.getPresence().last_user_input_epoch
          return p !== null && presence.nowEpochSeconds() - p < HID_PRESENCE_WINDOW_SECONDS
        },
        enqueue: (agentId, _command) =>
          enqueueCommand(agentId, { commandKey: 'janitor-disarm', when: 'idle', enqueuedBy: FLEET_STOP_ENQUEUED_BY })
            .ok,
        sendToPane: sendStopToPane,
        stamp: armed ? () => stampChoreRun('fleet-stop') : undefined,
      })
    })
  if (armed) markChoreLive('fleet-stop')
  const beat = () => {
    void runBeat().catch((err) => {
      log(`[fleet-stop] beat threw (non-fatal): ${err instanceof Error ? err.message : err}`)
    })
  }
  beat()
  const timer = setInterval(beat, intervalMs)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    if (armed) unmarkChoreLive('fleet-stop')
  }
}
