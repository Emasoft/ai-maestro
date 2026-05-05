/**
 * POST /api/sessions/[id]/stop
 *
 * Gracefully stop the AI program running inside a tmux session.
 *
 * Client-aware exit sequence (SCEN-013 fix, 2026-04-30):
 *
 * - **Claude Code**: Ctrl+C (clear partial input) then `/exit` as literal text.
 *   Chrome testing confirmed: Ctrl+D does NOT exit Claude Code — only /exit works.
 * - **Codex**: Ctrl+C twice — Codex CLI exits on a double Ctrl+C. `/exit` would
 *   be interpreted as a regular message inside Codex's interactive prompt.
 * - **Other clients (gemini, opencode, kiro)**: fall back to the Claude sequence
 *   for backward compatibility, since most CLIs accept Ctrl+C + something to
 *   confirm. Per-client refinement can land as those clients are exercised.
 *
 * The `-l` flag on tmux send-keys sends literal characters, avoiding key-name
 * interpretation that could corrupt the command.
 *
 * Fires the `SessionEnd` hook on exit.
 *
 * After this call, the tmux session remains alive (showing a shell prompt)
 * but the AI program is no longer running.
 *
 * **Response:** `{ success: true, sessionName }` on success, or HTTP 500 if
 * the tmux send-keys command fails (e.g. session not found).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { requireSudoToken } from '@/lib/sudo-guard'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // #116: Stopping a live AI session is destructive (kills the running
  // assistant) — classified "strict" in security-registry.json.
  const sudoErr = requireSudoToken(request, 'POST', '/api/sessions/[id]/stop')
  if (sudoErr) return sudoErr

  const { id: sessionName } = await params

  // CC-GOV-001: Validate session name to prevent shell injection via tmux send-keys
  if (!/^[a-zA-Z0-9_@.-]+$/.test(sessionName)) {
    return NextResponse.json({ error: 'Invalid session name' }, { status: 400 })
  }

  // Auth + RBAC
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const { getAgentBySession } = await import('@/lib/agent-registry')
  const targetAgent = getAgentBySession(sessionName)
  if (targetAgent) {
    const authz = authorize(auth, 'send-command', targetAgent.id)
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
    }
  }

  // SCEN-013 fix: choose exit sequence based on the AI client. Claude Code uses
  // /exit; Codex uses double Ctrl+C; others fall back to Claude semantics.
  const program = (targetAgent?.program || 'claude').toLowerCase()

  try {
    const { execFileSync } = require('child_process')
    // CC-GOV-001: Use execFileSync (no shell) to prevent injection even with validated names.
    if (program === 'codex') {
      // Codex exits on two consecutive Ctrl+C — first one clears partial input,
      // second one terminates the CLI. A small sleep between gives the TUI time
      // to redraw and accept the second signal.
      execFileSync('tmux', ['send-keys', '-t', sessionName, 'C-c'], { timeout: 5000, stdio: 'ignore' })
      // Wait briefly so Codex sees two distinct C-c events, not a held signal.
      execFileSync('sleep', ['0.4'], { timeout: 5000, stdio: 'ignore' })
      execFileSync('tmux', ['send-keys', '-t', sessionName, 'C-c'], { timeout: 5000, stdio: 'ignore' })
    } else {
      // Claude Code (and current fallback for gemini/opencode/kiro):
      // Ctrl+C clears any partial input, then /exit as literal text exits the CLI.
      // Note: Ctrl+D does NOT exit Claude Code. Only /exit works.
      // The -l flag sends literal text (not key names); Enter is a key name so sent separately.
      execFileSync('tmux', ['send-keys', '-t', sessionName, 'C-c'], { timeout: 5000, stdio: 'ignore' })
      execFileSync('tmux', ['send-keys', '-t', sessionName, '-l', '/exit'], { timeout: 5000, stdio: 'ignore' })
      execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter'], { timeout: 5000, stdio: 'ignore' })
    }
    return NextResponse.json({ success: true, sessionName, program })
  } catch (error: unknown) {
    // API-MIN-03 fix: do not return raw error.message to client. tmux/exec
    // errors leak internal paths (socket path, full command), OS-specific
    // text, and absolute filesystem layout. Log full detail server-side and
    // return a generic message to the client.
    const detail = error instanceof Error ? error.message : 'Unknown error'
    console.error('[Sessions stop] tmux command failed:', { detail, error })
    return NextResponse.json({ error: 'Session stop failed' }, { status: 500 })
  }
}
