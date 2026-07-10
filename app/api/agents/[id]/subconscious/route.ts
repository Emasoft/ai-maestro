/**
 * Agent Subconscious API
 *
 * GET /api/agents/[id]/subconscious — Get subconscious status
 *
 * The POST verb was removed in TRDD-YEE33F3A: `triggerSubconsciousAction`
 * returned 400 for every possible input once the RAG subsystem was deleted
 * (TRDD-70a521d9), had zero callers, and existed only as compatibility for
 * clients that could not succeed anyway. See the service for the full note.
 *
 * Thin wrapper — business logic in services/agents-subconscious-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { getSubconsciousStatus } from '@/services/agents-subconscious-service'
import { isValidUuid } from '@/lib/validation'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // TRDD-YEE33F3A: this GET previously made NO auth call at all, and its
  // `getSubconsciousStatus` reached `agentRegistry.getAgent()`, which CONSTRUCTS
  // and starts an in-memory Agent for any id — and, back when the registry still
  // evicted (TRDD-QC8R79G5), shut a live one down to make room. The service
  // now reads with `getExistingAgent()`, so the primitive is gone — but the guard
  // stays: an agent may read only its own status; the system owner (the dashboard
  // indicator, the only caller) may read any.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    const { id: agentId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    if (auth.agentId && auth.agentId !== agentId) {
      return NextResponse.json(
        { success: false, error: 'Forbidden — you may only read your own subconscious status' },
        { status: 403 }
      )
    }
    const result = await getSubconsciousStatus(agentId, auth.context)
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Agent Subconscious API] Error:', error)
    return NextResponse.json(
      // API2-MIN-01: don't leak error.message to client; full error is logged above
      { success: false, error: 'internal_error', code: 'agent-subconscious' },
      { status: 500 }
    )
  }
}

