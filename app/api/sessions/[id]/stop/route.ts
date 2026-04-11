/**
 * POST /api/sessions/[id]/stop
 *
 * Gracefully stop the AI program running inside a tmux session.
 *
 * Sends Ctrl+C (clear any partial input) then `/exit` as literal text.
 * Chrome testing confirmed: Ctrl+D does NOT exit Claude Code — only /exit works.
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

  try {
    const { execFileSync } = require('child_process')
    // Ctrl+C clears any partial input, then /exit as literal text exits Claude Code
    // Note: Ctrl+D does NOT exit Claude Code. Only /exit works.
    // The -l flag sends literal text (not key names), Enter is a key name so sent separately.
    // CC-GOV-001: Use execFileSync (no shell) to prevent injection even with validated names.
    execFileSync('tmux', ['send-keys', '-t', sessionName, 'C-c'], { timeout: 5000, stdio: 'ignore' })
    execFileSync('tmux', ['send-keys', '-t', sessionName, '-l', '/exit'], { timeout: 5000, stdio: 'ignore' })
    execFileSync('tmux', ['send-keys', '-t', sessionName, 'Enter'], { timeout: 5000, stdio: 'ignore' })
    return NextResponse.json({ success: true, sessionName })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
