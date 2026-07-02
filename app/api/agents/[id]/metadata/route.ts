import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agent-registry'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'
import { ChangeMetadata } from '@/services/element-management-service'

/**
 * GET /api/agents/[id]/metadata
 * Get agent metadata (custom key-value pairs).
 * Reads are not gated through an AIO — only mutations are.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const agent = getAgent(agentId)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    return NextResponse.json({ metadata: agent.metadata || {} })
  } catch (error) {
    console.error('Failed to get agent metadata:', error)
    return NextResponse.json({ error: 'Failed to get agent metadata' }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/[id]/metadata
 * Update agent metadata (merges with existing metadata).
 * Dispatches through ChangeMetadata AIO — auth, validation, ledger emit
 * all live there.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    let metadata: Record<string, unknown>
    try {
      metadata = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await ChangeMetadata(agentId, metadata, buildAuthContext(auth), { mode: 'merge' })
    if (!result.success) {
      const status = /not found/i.test(result.error || '') ? 404
        : /forbidden|authoris|authoriz/i.test(result.error || '') ? 403
        : 400
      return NextResponse.json({ error: result.error || 'Failed to update metadata' }, { status })
    }

    const updated = getAgent(agentId)
    return NextResponse.json({ metadata: updated?.metadata || {} })
  } catch (error) {
    console.error('Failed to update agent metadata:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id]/metadata
 * Clear all agent metadata.
 * Dispatches through ChangeMetadata in 'clear' mode — the AIO walks the
 * existing keys and nulls each so updateAgent's spread-merge wipes them.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const result = await ChangeMetadata(agentId, {}, buildAuthContext(auth), { mode: 'clear' })
    if (!result.success) {
      const status = /not found/i.test(result.error || '') ? 404
        : /forbidden|authoris|authoriz/i.test(result.error || '') ? 403
        : 400
      return NextResponse.json({ error: result.error || 'Failed to clear metadata' }, { status })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to clear agent metadata:', error)
    return NextResponse.json({ error: 'Failed to clear metadata' }, { status: 500 })
  }
}
