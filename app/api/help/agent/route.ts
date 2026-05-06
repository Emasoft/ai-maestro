/**
 * Help Agent API
 *
 * POST /api/help/agent - Create or return existing AI Maestro assistant agent
 * DELETE /api/help/agent - Kill the assistant agent and clean up
 * GET /api/help/agent - Check assistant agent status
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  createAssistantAgent,
  getAssistantStatus,
} from '@/services/help-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { getAgentByName } from '@/lib/agent-registry'
import { DeleteAgent } from '@/services/element-management-service'

/**
 * POST - Create or return existing assistant agent
 *
 * API2-MAJ-12: full handler-level auth (not just middleware) — POST is
 * side-effecting (spawns tmux, allocates resources, may burn API quota).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 })
    }

    const result = await createAssistantAgent()

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[HelpAgent] POST error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE - Kill assistant agent and clean up
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: 401 })
    }
    // Inline the assistant deletion (replaces deprecated deleteAssistantAgent wrapper)
    const assistant = getAgentByName('_aim-assistant')
    if (!assistant) {
      // Already gone -- idempotent success
      return NextResponse.json({ success: true })
    }
    const delResult = await DeleteAgent(assistant.id, {
      authContext: buildAuthContext(auth),
    })
    if (!delResult.success) {
      return NextResponse.json(
        { success: false, error: delResult.error || 'Failed to delete assistant' },
        { status: 500 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[HelpAgent] DELETE error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET - Check assistant agent status
 *
 * API2-MAJ-12: full handler-level auth so a stale or revoked token is
 * caught here, not just by middleware structural cred-presence checks.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status || 401 })
    }

    const result = await getAssistantStatus()

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[HelpAgent] GET error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
