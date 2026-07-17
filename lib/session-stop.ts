/**
 * Shared tmux session-STOP machinery (TRDD-OPNDCKVA).
 *
 * The client-aware graceful-exit sequence lives here as ONE implementation so the
 * two serving surfaces cannot drift:
 *   - POST /api/sessions/[id]/stop         — FULL Next.js app route
 *   - the headless router's /stop handler  — services/headless-router.ts
 *
 * This is the exit-only twin of lib/session-restart.ts (which additionally polls
 * and relaunches). It mirrors that module's discipline: no shell (execFileSync),
 * injectable exec/sleep seams so the sequence is unit-testable with no real tmux
 * (0-IMPACT), and NO auth/RBAC/sudo/subagent-gate — those are the caller route's
 * responsibility and differ per surface. It is handed an ALREADY-authorized,
 * ALREADY-validated (CC-GOV-001) session name.
 *
 * WHY a single source of truth: the headless copy had drifted into a raw
 * `execSync("tmux send-keys -t \"${name}\"…")` (shell interpolation), was not
 * codex-aware, and leaked raw exec errors. Extracting the sequence here means the
 * headless handler reuses the exact validated, no-shell construction — it CANNOT
 * accidentally rebuild a laxer or less-capable exit.
 */

export type StopOutcome =
  | { status: 'ok' }
  | { status: 'error'; detail: string }

/** Injectable seams so the exit sequence is unit-testable with no real tmux/timers. */
export interface StopSequenceDeps {
  exec?: (bin: string, args: string[]) => void
  sleep?: (ms: number) => Promise<void>
}

/**
 * Execute a command with an args array (NO shell) to prevent injection.
 * CC-GOV-001: never pass a user-derived value through shell interpolation.
 */
function realExec(bin: string, args: string[]): void {
  const { execFileSync } = require('child_process')
  execFileSync(bin, args, { timeout: 5000, stdio: 'ignore' })
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Codex terminates on TWO consecutive Ctrl+C; a brief pause lets its TUI redraw
// and register two distinct signals rather than one held key. This replaces the
// app route's blocking `execFileSync('sleep', ['0.4'])` subprocess with an
// injectable async seam (behavior-equivalent, testable, one fewer child process).
const CODEX_CTRLC_GAP_MS = 400

/**
 * Send the client-aware graceful-exit sequence to a VALIDATED tmux session name.
 *   - `codex` → C-c, (pause), C-c   — Codex exits on a double Ctrl+C; `/exit`
 *     would be typed as a regular message inside its interactive prompt.
 *   - else (claude / gemini / opencode / kiro) → C-c, `-l /exit`, Enter — Ctrl+D
 *     does NOT exit Claude Code; only `/exit` does. `-l` sends literal text.
 *
 * The codex branch matches the program name after case-normalization + trim; any
 * non-codex program falls through to the Claude sequence, exactly as the inline
 * code did. The registry stores canonical lowercased program names ('claude',
 * 'codex', …), so in practice this is the app route's original `=== 'codex'`
 * decision plus trivial-whitespace robustness (never a real divergence). Never
 * throws — exec failures are caught and surfaced as { status: 'error' } so the
 * caller maps them to a generic HTTP 500 (API-MIN-03: raw exec text leaks socket
 * paths / absolute layout).
 */
export async function runStopSequence(
  sessionName: string,
  program: string,
  deps: StopSequenceDeps = {},
): Promise<StopOutcome> {
  const exec = deps.exec ?? realExec
  const sleep = deps.sleep ?? realSleep
  try {
    if (program.toLowerCase().trim() === 'codex') {
      exec('tmux', ['send-keys', '-t', sessionName, 'C-c'])
      await sleep(CODEX_CTRLC_GAP_MS)
      exec('tmux', ['send-keys', '-t', sessionName, 'C-c'])
    } else {
      exec('tmux', ['send-keys', '-t', sessionName, 'C-c'])
      exec('tmux', ['send-keys', '-t', sessionName, '-l', '/exit'])
      exec('tmux', ['send-keys', '-t', sessionName, 'Enter'])
    }
    return { status: 'ok' }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return { status: 'error', detail }
  }
}
