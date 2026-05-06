/**
 * GET /api/sessions/[id]/pane-status
 *
 * Cheap status probe used by the dashboard's TerminalView to decide
 * whether to lock the input pane during wake/restart transitions.
 *
 * Returns:
 *   {
 *     paneCommand:    string  // e.g. "claude" / "zsh" / "" if no session
 *     programRunning: boolean // true when an AI program (claude/codex/...) is the foreground command
 *     paneCurrentPath: string // tmux's `#{pane_current_path}` (best-effort cwd)
 *   }
 *
 * Why a dedicated route. The activity WebSocket already carries
 * `idle_prompt` / `permission_prompt` notifications, but it does NOT
 * surface `programRunning` (the field that distinguishes "claude is
 * up" from "raw shell prompt"). The /api/agents poll runs every 10s
 * which is too slow for the security-sensitive transition window.
 * This route exists so the active TerminalView can poll every 1.5s
 * with cheap tmux calls (`list-panes -F #{pane_current_command}`),
 * see the program disappear/appear, and lock the pane while it is
 * a shell.
 *
 * Auth. Reads the session's pane state — no mutation. Auth required:
 * any callers with a valid `aim_session` cookie or Bearer AID_AUTH.
 * The session-name regex prevents argv injection into tmux.
 */

import { NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { getPaneCommand } from '@/services/agents-core-service'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const { id: sessionName } = await params
  if (!/^[a-zA-Z0-9_@.-]+$/.test(sessionName)) {
    return NextResponse.json({ error: 'Invalid session name' }, { status: 400 })
  }
  const status = getPaneCommand(sessionName)
  return NextResponse.json(status)
}
