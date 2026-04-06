import { NextRequest, NextResponse } from 'next/server'
import { getAgentById, updateAgentById } from '@/services/agents-core-service'
import type { UpdateAgentRequest } from '@/types/agent'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

/**
 * GET /api/agents/[id]
 * Get a specific agent by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const result = getAgentById(id)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Agents GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/[id]
 * Update an agent
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    // Identity auth only — authorization is handled by each Change* function
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    let body: UpdateAgentRequest
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // Pass full auth context — each Change* function decides its own authorization
    const result = await updateAgentById(id, body, auth.agentId || null, buildAuthContext(auth))
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Agents PATCH] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id]
 * Delete an agent. Soft-delete by default (preserves data, marks as deleted).
 * Pass ?hard=true for permanent deletion (creates backup first).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    // Identity auth only — DeleteAgent has its own Gate 0 for authorization
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const hardParam = request.nextUrl.searchParams.get('hard')?.toLowerCase()
    const hard = hardParam === 'true' || hardParam === '1' || hardParam === 'yes'
    const deleteFolderParam = request.nextUrl.searchParams.get('deleteFolder')?.toLowerCase()
    const deleteFolder = deleteFolderParam === 'true' || deleteFolderParam === '1' || deleteFolderParam === 'yes'

    // Delegate to the all-in-one pipeline
    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent(id, {
      authContext: buildAuthContext(auth),
      hard,
      deleteFolder,
    })

    if (!result.success) {
      const status = result.error?.includes('not found') ? 404
        : result.error?.includes('already deleted') ? 410
        : 403
      return NextResponse.json({ error: result.error }, { status })
    }
    return NextResponse.json({ success: true, hard: result.hard })
  } catch (error) {
    console.error('[Agents DELETE] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
