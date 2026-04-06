import { NextRequest, NextResponse } from 'next/server'
import { killSessionSync } from '@/lib/agent-runtime'

/**
 * POST /api/sessions/[id]/kill
 * Kill a tmux session by name. Used to clean up orphan/dead sessions.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
