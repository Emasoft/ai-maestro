/**
 * AMP v1 Agent Self-Management Endpoint
 *
 * GET    /api/v1/agents/me
 * PATCH  /api/v1/agents/me
 * DELETE /api/v1/agents/me
 *
 * Thin wrapper - business logic in services/amp-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAgentSelf, updateAgentSelf } from '@/services/amp-service'
import { authenticateRequest } from '@/lib/amp-auth'
import { DeleteAgent } from '@/services/element-management-service'
import type { AMPError } from '@/lib/types/amp'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    const result = getAgentSelf(authHeader)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (err) {
    console.error('[AMP /v1/agents/me] GET error:', err)
    return NextResponse.json({ error: 'internal_error', message: 'Internal server error' } as AMPError, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')

    let body: { alias?: string; delivery?: Record<string, unknown>; metadata?: Record<string, unknown> }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({
        error: 'invalid_request',
        message: 'Invalid JSON body'
      } as AMPError, { status: 400 })
    }

    const result = await updateAgentSelf(authHeader, body)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (err) {
    console.error('[AMP /v1/agents/me] PATCH error:', err)
    return NextResponse.json({ error: 'internal_error', message: 'Internal server error' } as AMPError, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    // Inline the AMP auth + DeleteAgent pipeline (replaces deprecated deleteAgentSelf wrapper)
    const ampAuth = authenticateRequest(authHeader)
    if (!ampAuth.authenticated) {
      return NextResponse.json(
        { error: ampAuth.error || 'unauthorized', message: ampAuth.message || 'Authentication required' } as AMPError,
        { status: 401 }
      )
    }
    const delResult = await DeleteAgent(ampAuth.agentId!, {
      authContext: { agentId: ampAuth.agentId!, isSystemOwner: false },
      hard: true,
    })
    if (!delResult.success) {
      return NextResponse.json(
        { error: 'forbidden' as const, message: delResult.error || 'Deletion denied' } as AMPError,
        { status: 403 }
      )
    }
    return NextResponse.json({
      deregistered: true,
      address: ampAuth.address,
      deregistered_at: new Date().toISOString(),
    }, { status: 200 })
  } catch (err) {
    console.error('[AMP /v1/agents/me] DELETE error:', err)
    return NextResponse.json({ error: 'internal_error', message: 'Internal server error' } as AMPError, { status: 500 })
  }
}
