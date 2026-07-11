/**
 * Agent Runtime Abstraction
 *
 * Consolidates ALL tmux operations behind a single TmuxRuntime class
 * implementing the AgentRuntime interface. Future runtimes (Docker, API-only,
 * direct-process) can be plugged in without touching business logic.
 *
 * Phase 4 of the service-layer refactoring.
 */

import { execFile, execFileSync as nodeExecFileSync } from 'child_process'
import { promisify } from 'util'

import { assertAuthorizedAgentWorkdir } from '@/lib/agent-workdir-policy'

// Shell-free command execution — prevents shell injection by passing args as array
const execFileAsync = promisify(execFile)

// LIB2-MAJ-14: Defence-in-depth validation for tmux session names. Even though
// `execFileAsync` prevents shell injection, tmux's target syntax `[session]:[window].[pane]`
// makes session names containing `:`, `.`, or `@` semantically dangerous —
// e.g. a name like "victim:1.0" would let a later caller using the same string
// accidentally target a different window in a DIFFERENT session ("target
// confusion"). We allow only safe identifier characters and explicitly reject
// the tmux-special separators. The agent-registry name regex elsewhere is
// `^[a-zA-Z0-9_@.-]+$` which is broader than what tmux allows safely; this
// runtime-layer check is the last line of defence.
const SAFE_SESSION_NAME = /^[a-zA-Z0-9_-]+$/

function validateSessionName(name: string, label: string = 'session name'): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`[agent-runtime] Invalid ${label}: must be a non-empty string`)
  }
  if (name.length > 200) {
    throw new Error(`[agent-runtime] Invalid ${label}: too long`)
  }
  if (!SAFE_SESSION_NAME.test(name)) {
    throw new Error(`[agent-runtime] Invalid ${label}: ${JSON.stringify(name)} — must match ${SAFE_SESSION_NAME} (no ':', '.', '@', or other tmux target separators)`)
  }
}

// ── TRDD-a1019073 coupling (interim posture — do NOT mistake for permanent) ──
// The cwd policy below is for the SHARED-UID era. It is NOT the
// controlled-execution-environment boundary: on a shared UID no cwd policy is a
// security boundary (a same-UID process can chdir anywhere the kernel allows).
// When the dedicated `aimaestro` UID + host sandbox land, this must be tightened
// IN LOCKSTEP with the OS-level enforcement (private /tmp, TMPDIR redirect,
// dedicated non-human-writable toolchain, cross-UID perms).
// See design/tasks/TRDD-…-a1019073-controlled-execution-environment.md §11.1
// (interim bridge) and §4.1 (UID separation, the load-bearing foundation).
//
// TRDD-WLWHVMKT: this used to be a hardcoded "must resolve under ~/agents/" check.
// It was one of FIVE places that each re-derived that invariant independently, and
// when TRDD-57EBNB72 widened only ONE of them (CreateAgent's G03 gates) to support
// adopting an existing project folder, this check kept throwing — so an adopted
// agent's registry entry was written and its session could then never start. The
// rule is NOT relaxed here; it is delegated to the one authority that now answers
// the question for every enforcement point (lib/agent-workdir-policy.ts), which
// authorizes an external cwd only when the REGISTRY records it as an agent's own
// working directory — i.e. a directory that already passed the creation gates.
//
// No agent name is passed: CreateAgent's G03-OVERLAP already refuses to register a
// workdir owned by another live agent, so "is a registered workdir" is equivalent to
// "is THIS agent's workdir" — and not depending on session-name parsing here avoids
// false denials on multi-session names (`<name>-1`, `<id>@<host>`).
function validateCwd(cwd: string): void {
  assertAuthorizedAgentWorkdir(cwd)
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface DiscoveredSession {
  name: string
  windows: number
  createdAt: string
  workingDirectory: string
}

export interface AgentRuntime {
  readonly type: 'tmux' | 'docker' | 'api' | 'direct'

  // Discovery
  listSessions(): Promise<DiscoveredSession[]>

  // Existence / status
  sessionExists(name: string): Promise<boolean>
  getWorkingDirectory(name: string): Promise<string>
  isInCopyMode(name: string): Promise<boolean>
  cancelCopyMode(name: string): Promise<void>

  // The process currently in the FOREGROUND of the session's pane — the shell
  // itself when it sits at a prompt, or whatever child it is running (a slow
  // `.zprofile` step, `claude`, `vim`, …). Callers use it to tell "ready for
  // keystrokes" from "busy, anything I type is eaten by that child".
  //
  // OPTIONAL on purpose: a non-tmux runtime (or a test double) may have no
  // notion of a foreground process, and every caller must degrade gracefully
  // rather than force every implementer to fake one.
  getForegroundCommand?(name: string): Promise<string>

  // Lifecycle
  //
  // env (optional): key/value pairs passed to `tmux new-session -e KEY=VAL ...`
  // so they are already set in the session environment BEFORE the first pane's
  // login shell (and anything it spawns, e.g. `claude`) starts. Using the
  // `-e` flag is the ONLY way to guarantee these vars are visible to the
  // already-running process in the initial pane; calling `setEnvironment`
  // AFTER session creation only affects future panes. Keys must match
  // `^[A-Z_][A-Z0-9_]*$` (standard env-var naming) — anything else is
  // rejected as a defense against injection from caller-controlled strings.
  createSession(name: string, cwd: string, env?: Record<string, string>): Promise<void>
  killSession(name: string): Promise<void>
  renameSession(oldName: string, newName: string): Promise<void>

  // I/O
  sendKeys(name: string, keys: string, opts?: { literal?: boolean; enter?: boolean }): Promise<void>
  capturePane(name: string, lines?: number): Promise<string>

  // Environment
  setEnvironment(name: string, key: string, value: string): Promise<void>
  unsetEnvironment(name: string, key: string): Promise<void>

  // PTY (returns spawn args for node-pty -- runtime doesn't own the PTY)
  getAttachCommand(name: string, socketPath?: string): { command: string; args: string[] }
}

// ---------------------------------------------------------------------------
// TmuxRuntime
// ---------------------------------------------------------------------------

export class TmuxRuntime implements AgentRuntime {
  readonly type = 'tmux' as const

  // -- Discovery -----------------------------------------------------------

  async listSessions(): Promise<DiscoveredSession[]> {
    try {
      // Use execFileAsync (no shell) for tmux list-sessions
      let stdout: string
      try {
        const result = await execFileAsync('tmux', ['list-sessions'])
        stdout = result.stdout
      } catch {
        // tmux not running or no sessions — return empty list
        return []
      }
      if (!stdout.trim()) return []

      const lines = stdout.trim().split('\n')
      const results: DiscoveredSession[] = []

      for (const line of lines) {
        const match = line.match(/^([^:]+):\s+(\d+)\s+windows?\s+\(created\s+(.+?)\)/)
        if (!match) continue

        const [, name, windows, createdStr] = match
        const normalizedDate = createdStr.trim().replace(/\s+/g, ' ')

        let createdAt: string
        try {
          const parsedDate = new Date(normalizedDate)
          createdAt = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString()
        } catch {
          createdAt = new Date().toISOString()
        }

        let workingDirectory = ''
        try {
          // Use execFileAsync (no shell) to prevent shell injection via session name
          const { stdout: cwdOutput } = await execFileAsync(
            'tmux', ['display-message', '-t', name, '-p', '#{pane_current_path}']
          )
          workingDirectory = cwdOutput.trim()
        } catch {
          workingDirectory = ''
        }

        results.push({
          name,
          windows: parseInt(windows, 10),
          createdAt,
          workingDirectory,
        })
      }

      return results
    } catch {
      return []
    }
  }

  // -- Existence / status --------------------------------------------------

  async sessionExists(name: string): Promise<boolean> {
    try {
      // Use execFileAsync (no shell) to prevent shell injection via session name
      await execFileAsync('tmux', ['has-session', '-t', name])
      return true
    } catch {
      return false
    }
  }

  async getWorkingDirectory(name: string): Promise<string> {
    try {
      // Use execFileAsync (no shell) to prevent shell injection via session name
      const { stdout } = await execFileAsync(
        'tmux', ['display-message', '-t', name, '-p', '#{pane_current_path}']
      )
      return stdout.trim()
    } catch {
      return ''
    }
  }

  async getForegroundCommand(name: string): Promise<string> {
    try {
      // Use execFileAsync (no shell) to prevent shell injection via session name
      const { stdout } = await execFileAsync(
        'tmux', ['display-message', '-t', name, '-p', '#{pane_current_command}'],
        { encoding: 'utf8', timeout: 3000 }
      )
      return stdout.trim()
    } catch {
      return ''
    }
  }

  async isInCopyMode(name: string): Promise<boolean> {
    try {
      // Use execFileAsync (no shell) to prevent shell injection via session name
      const { stdout } = await execFileAsync(
        'tmux', ['display-message', '-t', name, '-p', '#{pane_in_mode}']
      )
      return stdout.trim() === '1'
    } catch {
      return false
    }
  }

  async cancelCopyMode(name: string): Promise<void> {
    try {
      const inCopyMode = await this.isInCopyMode(name)
      if (inCopyMode) {
        // Use execFileAsync (no shell) to prevent shell injection via session name
        await execFileAsync('tmux', ['send-keys', '-t', name, 'q'])
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    } catch {
      // Ignore
    }
  }

  // -- Lifecycle -----------------------------------------------------------

  async createSession(name: string, cwd: string, env?: Record<string, string>): Promise<void> {
    // LIB2-MAJ-14: Validate name and cwd before invoking tmux. execFileAsync
    // already protects from shell injection, but we still need to prevent
    // tmux target-confusion (names containing ':', '.', '@') and the
    // R0-violation case where cwd is somewhere other than ~/agents/.
    validateSessionName(name, 'session name')
    validateCwd(cwd)

    // Use execFileAsync (no shell) to prevent shell injection via name/cwd.
    //
    // WT-014#1 + WT-022#1: env vars MUST be passed via `tmux new-session -e KEY=VAL`
    // so they are baked into the session environment BEFORE the first pane's
    // login shell (and anything it launches, e.g. `claude`) starts. Setting the
    // same vars via `tmux set-environment` AFTER session creation is a race: the
    // first pane's process tree is already running and inherits nothing from
    // future set-environment calls. AGENT_WORK_DIR (directory-guard sandbox
    // boundary) and AID_AUTH (agent HTTP API session secret) must be atomic.
    // AIMAESTRO_AGENT=1 — self-identification flag baked into EVERY ai-maestro
    // agent session via `-e`, so any process in the tree can tell at runtime
    // "I am inside an ai-maestro agent". Read by the janitor's
    // in_ai_maestro_agent_env() detector, and inherited for free by every child
    // the agent's `claude` spawns (hooks, detector subprocesses, a
    // heartbeat-spawned daemon) since env vars propagate to all children.
    // Injected HERE — the single launch chokepoint every path flows through
    // (create, wake, restore, help-assistant, haephestos, any future caller) —
    // so the invariant "one agent = one claude process tree, all flagged"
    // cannot be silently broken by a new caller that forgets to set it. A
    // restart reuses the SAME pane (send-keys relaunch), so the relaunched
    // `claude` inherits this from the original `-e` injection — no separate
    // handling needed. Forced on (caller env spread first, flag last) so the
    // value is always exactly "1" regardless of caller-supplied env.
    const finalEnv: Record<string, string> = { ...(env ?? {}), AIMAESTRO_AGENT: '1' }

    const args = ['new-session', '-d', '-s', name, '-c', cwd]
    for (const [key, value] of Object.entries(finalEnv)) {
      // Defense against injection from caller-controlled strings: reject any
      // key that isn't a strict POSIX environment-variable identifier. This
      // also blocks accidental CR/LF/`=` that would confuse tmux's KEY=VAL
      // parsing. Values are NOT sanitized here — execFile (no shell) passes
      // them as a single argv item to tmux, which in turn stores them as
      // opaque bytes in the session environment.
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        throw new Error(`[agent-runtime] Invalid env var name: ${key}`)
      }
      args.push('-e', `${key}=${value}`)
    }
    await execFileAsync('tmux', args)
  }

  async killSession(name: string): Promise<void> {
    // Use execFileAsync (no shell) to prevent shell injection via session name
    await execFileAsync('tmux', ['kill-session', '-t', name])
  }

  async renameSession(oldName: string, newName: string): Promise<void> {
    // LIB2-MAJ-14: Validate both names to prevent tmux target-confusion via
    // names containing ':', '.', '@'. The renameSession call would otherwise
    // accept a name like "victim:1.0" that subsequent calls would treat as
    // a different session/window/pane.
    validateSessionName(oldName, 'old session name')
    validateSessionName(newName, 'new session name')
    // Use execFileAsync (no shell) to prevent shell injection via session names
    await execFileAsync('tmux', ['rename-session', '-t', oldName, newName])
  }

  // -- I/O -----------------------------------------------------------------

  async sendKeys(
    name: string,
    keys: string,
    opts: { literal?: boolean; enter?: boolean } = {}
  ): Promise<void> {
    const { literal = false, enter = false } = opts

    if (literal) {
      // Literal mode: use -l flag so tmux treats keys as literal text
      if (enter) {
        // Two separate execFileAsync calls — execFile has no shell so \\; chaining is unavailable
        await execFileAsync('tmux', ['send-keys', '-t', name, '-l', keys])
        await execFileAsync('tmux', ['send-keys', '-t', name, 'Enter'])
      } else {
        await execFileAsync('tmux', ['send-keys', '-t', name, '-l', keys])
      }
    } else {
      // Non-literal: keys is a raw tmux key name (e.g. "C-c", "Enter", "Escape")
      // Use execFileAsync (array args, no shell) to prevent shell injection (CC-P1-501)
      const args = ['send-keys', '-t', name, keys]
      if (enter) {
        args.push('Enter')
      }
      await execFileAsync('tmux', args)
    }
  }

  async capturePane(name: string, lines: number = 2000): Promise<string> {
    try {
      // Use execFileAsync (no shell) to prevent shell injection via session name
      // Try full history capture first, fall back to visible pane on error
      const { stdout } = await execFileAsync(
        'tmux', ['capture-pane', '-t', name, '-p', '-S', `-${lines}`],
        { encoding: 'utf8', timeout: 3000 }
      )
      return stdout
    } catch {
      try {
        // Fallback: capture only visible pane content
        const { stdout } = await execFileAsync(
          'tmux', ['capture-pane', '-t', name, '-p'],
          { encoding: 'utf8', timeout: 3000 }
        )
        return stdout
      } catch {
        return ''
      }
    }
  }

  // -- Environment ---------------------------------------------------------

  async setEnvironment(name: string, key: string, value: string): Promise<void> {
    // Use execFileAsync (array args, no shell) to prevent shell injection (CC-P1-502)
    await execFileAsync('tmux', ['set-environment', '-t', name, key, value])
  }

  async unsetEnvironment(name: string, key: string): Promise<void> {
    // Use execFileAsync (array args, no shell) to prevent shell injection
    try {
      await execFileAsync('tmux', ['set-environment', '-t', name, '-r', key])
    } catch {
      // Variable may not exist — equivalent to the old 2>/dev/null || true
    }
  }

  // -- PTY -----------------------------------------------------------------

  getAttachCommand(name: string, socketPath?: string): { command: string; args: string[] } {
    if (socketPath) {
      return { command: 'tmux', args: ['-S', socketPath, 'attach-session', '-t', name] }
    }
    return { command: 'tmux', args: ['attach-session', '-t', name] }
  }
}

// ---------------------------------------------------------------------------
// Singleton + factory
// ---------------------------------------------------------------------------

let defaultRuntime: AgentRuntime = new TmuxRuntime()

export function getRuntime(): AgentRuntime {
  return defaultRuntime
}

// ---------------------------------------------------------------------------
// Shell readiness — never type into a shell that is not listening
// ---------------------------------------------------------------------------
//
// WHY (SCEN-015, 2026-07-11): both places that launch an agent's client — a
// fresh session (sessions-service) and a wake (agents-core-service) — used to
// wait a blind `setTimeout(300)` and then `sendKeys('claude')`. 300ms is not
// "the shell is ready", it is a guess, and on any machine whose `~/.zprofile`
// is slow it is the wrong guess. Worse, when a startup file READS FROM THE TTY
// (the machine this was found on runs a keychain unlock that prompts for a
// password), the typed `claude\n` is swallowed as that prompt's ANSWER. The
// client then never starts: the agent sits at a bare shell while the registry
// says `active` and the dashboard shows a green "Online" dot — so every chat
// message the user sends lands in the void, with no error surfaced anywhere.
//
// The fix is to do what a human does: wait until the shell is genuinely idle at
// a prompt. Three signals, each covering the others' blind spots:
//   1. the pane's FOREGROUND process is the shell itself — so a startup child
//      still holding the TTY (`security`, `gpg-agent`, …) is never mistaken for
//      a prompt;
//   2. the pane's last line LOOKS LIKE A PROMPT — so a shell that is merely
//      *between* two startup commands, or one that has not drawn its prompt yet
//      (a brand-new pane is BLANK, and blank trivially "stops changing" — the
//      first version of this check fell into exactly that trap), is not
//      mistaken for an idle one; and
//   3. that line STOPPED CHANGING across two consecutive samples.
// On timeout we send anyway: degrading to the old blind behavior is strictly
// better than refusing to start the agent at all. So an exotic prompt this
// regex does not recognise costs SHELL_READY_TIMEOUT_MS of patience — by which
// point the shell is certainly ready — and never a lost keystroke.
const SHELL_FOREGROUND_COMMANDS = new Set([
  'zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh',
  '-zsh', '-bash', '-sh', '-fish',
])
// A prompt ends with one of the conventional terminators, optionally followed
// by trailing spaces (tmux already strips those). Startup chatter ("Loading
// .zshrc at 21:00:41") and a password prompt ("... keychain-db:") do not match.
const SHELL_PROMPT_TAIL = /[%$#>❯➜»]\s*$/
// 45s, not 15s: a login shell that unlocks a keychain (or waits on a network
// mount, or warms a version manager) legitimately takes >15s to reach its first
// prompt. The first version of this timeout was 15s, which on the machine where
// the bug was found expired at the EXACT moment the shell finished — so it fired
// its blind fallback into the one millisecond that could still lose the
// keystroke. Waiting costs nothing (the session is already up and the user is
// not blocked); typing too early costs the whole agent.
export const SHELL_READY_TIMEOUT_MS = 45000
const SHELL_READY_POLL_MS = 400
// Consecutive unchanged samples that count as "idle" for a shell whose prompt
// this module does not recognise (~1.6s of complete silence).
const SHELL_QUIET_SAMPLES = 4

/**
 * Get the pane to a state where it will actually EXECUTE what we type.
 *
 * Waits for an idle prompt. If none appears in time, something is holding the
 * TTY — on the machine this was found on, `~/.zprofile` runs a keychain unlock
 * that prompts for a password and blocks FOREVER, so every agent pane on the
 * host sat in it and the `claude` we typed was consumed as that prompt's
 * answer. Typing the command anyway (what the old code effectively did) is the
 * one thing guaranteed to lose it. So we do what the human at the keyboard
 * does: press Ctrl-C to abort the stuck child, then wait for the shell to come
 * back and type into THAT.
 *
 * Returns true when the shell is believed ready. False means we gave up and the
 * caller should proceed anyway — a best-effort launch still beats no launch.
 */
export async function prepareShellForLaunch(
  runtime: AgentRuntime,
  sessionName: string,
  // Injectable so tests can exercise the escalation without waiting a real
  // 45s + 20s of wall clock.
  timeoutMs: number = SHELL_READY_TIMEOUT_MS,
  recoveryMs: number = SHELL_INTERRUPT_RECOVERY_MS,
): Promise<{ ready: boolean; interrupted: boolean }> {
  if (await waitForShellReady(runtime, sessionName, timeoutMs)) {
    return { ready: true, interrupted: false }
  }

  try {
    await runtime.sendKeys(sessionName, 'C-c')
  } catch {
    return { ready: false, interrupted: false }
  }

  const ready = await waitForShellReady(runtime, sessionName, recoveryMs)
  return { ready, interrupted: true }
}

const SHELL_INTERRUPT_RECOVERY_MS = 20000

export async function waitForShellReady(
  runtime: AgentRuntime,
  sessionName: string,
  timeoutMs: number = SHELL_READY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let previousPane: string | null = null
  let quietSamples = 0

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, SHELL_READY_POLL_MS))

    // Signal 1 is the load-bearing one: while a startup child (`security`, a
    // pinentry, an ssh-askpass) holds the TTY, ANY keystroke we send is that
    // child's stdin, not the shell's. A runtime that cannot report a foreground
    // process (docker/api backends, test doubles) skips it.
    let foregroundIsShell = true
    if (typeof runtime.getForegroundCommand === 'function') {
      const fg = await runtime.getForegroundCommand(sessionName).catch(() => '')
      foregroundIsShell = fg === '' || SHELL_FOREGROUND_COMMANDS.has(fg)
    }

    const pane = (await runtime.capturePane(sessionName, 5).catch(() => '')).trimEnd()
    const lines = pane.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0)
    const lastLine = lines.length > 0 ? lines[lines.length - 1] : ''

    quietSamples = pane !== '' && pane === previousPane ? quietSamples + 1 : 0
    previousPane = pane

    if (!foregroundIsShell || lastLine === '') continue

    // Strong signal: a recognisable prompt, drawn and stable.
    if (SHELL_PROMPT_TAIL.test(lastLine) && quietSamples >= 1) return true
    // Fallback for an unrecognised prompt: the shell is in front and the pane
    // has been completely silent for a while.
    if (quietSamples >= SHELL_QUIET_SAMPLES) return true
  }

  return false
}

export function setRuntime(r: AgentRuntime): void {
  defaultRuntime = r
}

// ---------------------------------------------------------------------------
// Sync helpers for lib/agent-registry.ts (uses execSync, can't be async)
// ---------------------------------------------------------------------------

export function sessionExistsSync(name: string, socketPath?: string): boolean {
  try {
    const args = socketPath
      ? ['-S', socketPath, 'has-session', '-t', name]
      : ['has-session', '-t', name]
    nodeExecFileSync('tmux', args, { timeout: 2000, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function killSessionSync(name: string): void {
  try {
    // Use nodeExecFileSync (no shell) to prevent shell injection via session name
    nodeExecFileSync('tmux', ['kill-session', '-t', name], { timeout: 2000, stdio: 'ignore' })
  } catch {
    // Session may not exist
  }
}

export function renameSessionSync(oldName: string, newName: string): void {
  // Use nodeExecFileSync (array args, no shell) to prevent shell injection (CC-P1-503)
  nodeExecFileSync('tmux', ['rename-session', '-t', oldName, newName])
}
