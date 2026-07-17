/**
 * Shared tmux session-restart machinery (TRDD-4P1M8I18 Phase 1).
 *
 * The stop→poll→relaunch sequence AND the SECURITY-CRITICAL relaunch-command
 * construction (the CC-GOV-001/002 allowlists, persona-name sanitization, and
 * the `--name` injection) live here as ONE implementation, so the two restart
 * surfaces cannot drift:
 *   - POST /api/sessions/[id]/restart  — human / other-agent, sudo-gated
 *   - POST /api/sessions/me/restart    — agent self-only-by-construction (Phase 2)
 *
 * WHY a single source of truth: a divergent re-implementation of the programArgs
 * allowlist or the persona-name sanitizer in the second route would be an
 * injection hole (a label containing `"`/`$`/backtick could break out of the
 * quoted `--name` argument the receiving shell parses). Extracting them here
 * means the second surface reuses the exact validated construction — it CANNOT
 * accidentally build a laxer command.
 *
 * This module does NO auth, RBAC, sudo, or manager-gate — those are the caller
 * route's responsibility and differ per surface (that is the whole point of the
 * split). It is handed ALREADY-authorized inputs and performs the mechanical
 * restart. The exec seams are injectable so the poll loop is unit-testable with
 * no real tmux (0-IMPACT), matching the oauth-rotator / continuity-status pattern.
 */

import { looksLikeAbandonPrompt } from '@/lib/session-safe-state'

/**
 * Execute a command with an args array (NO shell) to prevent injection.
 * CC-GOV-001: never pass a user-derived value through shell interpolation.
 */
function execCommandArgs(bin: string, args: string[]): string {
  const { execFileSync } = require('child_process')
  return (execFileSync(bin, args, { timeout: 5000, encoding: 'utf8' }) as string).trim()
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Query tmux for the process currently running in the session's pane. */
function realPaneCommand(sessionName: string): string | null {
  try {
    return (
      execCommandArgs('tmux', ['display-message', '-p', '-t', sessionName, '#{pane_current_command}']) || null
    )
  } catch {
    return null
  }
}

/** Capture the visible pane text (used to detect the abandon-confirmation dialog). */
function realCapturePane(sessionName: string): string {
  return execCommandArgs('tmux', ['capture-pane', '-t', sessionName, '-p'])
}

/** Shell process names that indicate the AI program has exited and the pane is
 *  back at a shell prompt (ready to accept a new launch command). */
export const SHELL_COMMANDS: ReadonlySet<string> = new Set([
  'zsh', 'bash', 'sh', 'fish', '-zsh', '-bash',
])

// The programArgs allowlist (CC-GOV-002). Allowed: alphanumeric, spaces, hyphens,
// underscores, dots, slashes, equals, colons, commas, at-signs, double-quotes,
// tildes. An empty string is valid (no extra args). This is the SINGLE definition
// of the allowlist — both restart surfaces validate against it.
const PROGRAM_ARGS_ALLOWLIST = /^[a-zA-Z0-9 \-_./=:,@"~]+$/
// The persona-name allowlist for the `--name "…"` argument (API-MAJ-03). Even
// though tmux `send-keys -l` is literal-mode, the receiving shell parses the
// argument when Enter is pressed, so a permissive label MUST be stripped to
// chars that cannot break the quoting: alphanumerics, space, underscore, hyphen, dot.
const PERSONA_NAME_STRIP = /[^a-zA-Z0-9 _.\-]/g

/** True when programArgs is safe to inject (empty, or allowlist-clean). CC-GOV-002. */
export function isValidProgramArgs(programArgs: string): boolean {
  return programArgs === '' || PROGRAM_ARGS_ALLOWLIST.test(programArgs)
}

/** Sanitize a persona display name to the `--name` allowlist; empty result falls
 *  back to `fallback` (itself constrained by tmux's session-name regex). API-MAJ-03. */
export function sanitizePersonaName(raw: string, fallback: string): string {
  return raw.replace(PERSONA_NAME_STRIP, '').trim() || fallback
}

/** Resolve a display program name (e.g. "Claude Code") to the actual CLI binary. */
export function resolveRestartBin(program: string): string {
  const lower = program.toLowerCase()
  if (lower.includes('claude')) return 'claude'
  if (lower.includes('codex')) return 'codex'
  if (lower.includes('aider')) return 'aider'
  if (lower.includes('gemini')) return 'gemini'
  // CC-GOV-002: warn on fallback — may indicate unexpected input.
  console.warn(`[session-restart] resolveRestartBin: unrecognized program "${program}", falling back to "claude"`)
  return 'claude'
}

/**
 * Build the relaunch command string, guaranteeing `--name "<persona>"` is present.
 * `programArgs` MUST already be allowlist-validated (isValidProgramArgs) and
 * `personaName` MUST already be sanitized (sanitizePersonaName) — the caller does
 * both before building, exactly as the original inline code did. Inserts `--name`
 * before a ` -- ` raw-prompt divider when present, else appends it.
 */
export function buildRelaunchCommand(bin: string, programArgs: string, personaName: string): string {
  let finalArgs = programArgs
  if (!finalArgs.includes('--name ')) {
    const dividerIdx = finalArgs.indexOf(' -- ')
    if (dividerIdx !== -1) {
      finalArgs = finalArgs.slice(0, dividerIdx) + ` --name "${personaName}"` + finalArgs.slice(dividerIdx)
    } else {
      finalArgs = `${finalArgs} --name "${personaName}"`.trim()
    }
  }
  return `${bin} ${finalArgs}`.trim()
}

export type RestartOutcome =
  | { status: 'ok'; command: string }
  | { status: 'timeout' }
  | { status: 'error'; detail: string }

/** Injectable exec seams so the poll loop is unit-testable with no real tmux. */
export interface RestartSequenceDeps {
  exec?: (bin: string, args: string[]) => string
  sleep?: (ms: number) => Promise<void>
  paneCommand?: (sessionName: string) => string | null
  capturePane?: (sessionName: string) => string
}

// Poll timing — the exact constants the inline route used (behavior-preserving).
const MAX_WAIT_MS = 15000
const POLL_INTERVAL_MS = 500
const SHELL_SETTLE_MS = 1000
const ABANDON_PROBE_AFTER_MS = 5000

/**
 * The mechanical stop→poll→relaunch sequence for a VALIDATED session name and a
 * pre-built relaunch `command`. Steps (faithful to the original inline flow):
 *   1. C-c (clear partial input) → `/exit` (literal) → Enter — graceful shutdown.
 *   2. Poll pane command every 500ms up to 15s; exit when it becomes a shell
 *      (or the session is gone). At the half-timeout, probe ONCE for the
 *      abandon-confirmation dialog and confirm it if visible.
 *   3. Wait 1s for shell readiness.
 *   4. Send the relaunch command literally, then Enter.
 * Returns a discriminated outcome the route maps to HTTP; never throws (exec
 * failures are caught and surfaced as { status: 'error' }).
 */
export async function runRestartSequence(
  sessionName: string,
  command: string,
  deps: RestartSequenceDeps = {},
): Promise<RestartOutcome> {
  const exec = deps.exec ?? execCommandArgs
  const sleep = deps.sleep ?? realSleep
  const paneCommand = deps.paneCommand ?? realPaneCommand
  const capturePane = deps.capturePane ?? realCapturePane

  try {
    // Step 1 — graceful shutdown. Ctrl+D does NOT exit Claude Code; only /exit does.
    exec('tmux', ['send-keys', '-t', sessionName, 'C-c'])
    exec('tmux', ['send-keys', '-t', sessionName, '-l', '/exit'])
    exec('tmux', ['send-keys', '-t', sessionName, 'Enter'])

    // Step 2 — poll until the pane is a shell (program exited).
    let elapsed = 0
    let exited = false
    let abandonPromptHandled = false
    while (elapsed < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS)
      elapsed += POLL_INTERVAL_MS
      const paneCmd = paneCommand(sessionName)
      if (!paneCmd || SHELL_COMMANDS.has(paneCmd)) {
        exited = true
        break
      }
      // TRDD-O8NCNRWO: /exit can land on the abandon-confirmation dialog when
      // background subagents are running and the pre-gate counter was stale-low.
      // At half-timeout, probe ONCE and confirm the dialog (its default = confirm
      // exit). Only a DETECTED dialog gets a keystroke — never blind keys.
      if (!abandonPromptHandled && elapsed >= ABANDON_PROBE_AFTER_MS) {
        abandonPromptHandled = true
        try {
          const paneTail = capturePane(sessionName).split('\n').slice(-12).join('\n')
          if (looksLikeAbandonPrompt(paneTail)) {
            console.warn('[session-restart] abandon-confirmation dialog detected after /exit — confirming')
            exec('tmux', ['send-keys', '-t', sessionName, 'Enter'])
          }
        } catch {
          // capture failure is non-fatal — the poll loop keeps its own timeout.
        }
      }
    }

    if (!exited) return { status: 'timeout' }

    // Step 3 — brief pause for shell readiness (rc files, prompt rendering).
    await sleep(SHELL_SETTLE_MS)

    // Step 4 — relaunch.
    exec('tmux', ['send-keys', '-t', sessionName, '-l', command])
    exec('tmux', ['send-keys', '-t', sessionName, 'Enter'])

    return { status: 'ok', command }
  } catch (error: unknown) {
    // API-MIN-03: do NOT surface raw exec error text (leaks socket paths, absolute
    // layout). The caller logs `detail` server-side and returns a generic message.
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'error', detail }
  }
}
