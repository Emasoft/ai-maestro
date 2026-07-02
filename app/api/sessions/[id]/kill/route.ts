import { NextRequest, NextResponse } from 'next/server'
import { killSessionSync } from '@/lib/agent-runtime'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

/**
 * POST /api/sessions/[id]/kill
 * Kill a tmux session by name. Used to clean up orphan/dead sessions.
 *
 * API2-MAJ-03: hard tmux kill is more destructive than `stop` (which is
 * already strict). Requires fresh sudo token via security-registry.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Sudo gate FIRST (before auth) so the modal flow is consistent with
  // other strict routes — sudo is checked before any side effect.
  const sudoErr = requireSudoToken(request, 'POST', '/api/sessions/[id]/kill')
  if (sudoErr) return sudoErr

  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    const { id } = await params
    const sessionName = decodeURIComponent(id)

    // CC-GOV-001: Positive allowlist — only safe tmux session name characters
    if (!sessionName || !/^[a-zA-Z0-9_@.-]+$/.test(sessionName)) {
      return NextResponse.json({ error: 'Invalid session name' }, { status: 400 })
    }

    killSessionSync(sessionName)
    return NextResponse.json({ success: true, killed: sessionName })
  } catch (error) {
    console.error('[Sessions Kill] Error:', error)
    return NextResponse.json({ error: 'Failed to kill session' }, { status: 500 })
  }
}
