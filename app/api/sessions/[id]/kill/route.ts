import { NextRequest, NextResponse } from 'next/server'
import { killSessionSync } from '@/lib/agent-runtime'
import { authenticateFromRequest } from '@/lib/agent-auth'

/**
 * POST /api/sessions/[id]/kill
 * Kill a tmux session by name. Used to clean up orphan/dead sessions.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    const { id } = await params
    const sessionName = decodeURIComponent(id)

    if (!sessionName || /[;&|`$]/.test(sessionName)) {
      return NextResponse.json({ error: 'Invalid session name' }, { status: 400 })
    }

    killSessionSync(sessionName)
    return NextResponse.json({ success: true, killed: sessionName })
  } catch (error) {
    console.error('[Sessions Kill] Error:', error)
    return NextResponse.json({ error: 'Failed to kill session' }, { status: 500 })
  }
}
