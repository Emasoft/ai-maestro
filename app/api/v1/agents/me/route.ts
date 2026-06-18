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
import { z } from 'zod'
import { getAgentSelf, updateAgentSelf } from '@/services/amp-service'
import { authenticateRequest } from '@/lib/amp-auth'
import { DeleteAgent } from '@/services/element-management-service'
import type { AMPError } from '@/lib/types/amp'

// API2-MIN-14: Zod schema for the PATCH body. Replaces the previous
// untyped object cast so unexpected fields are rejected at the boundary
// rather than silently passed to updateAgentSelf.
const PatchBodySchema = z.object({
  alias: z.string().min(1).max(200).optional(),
  delivery: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict()

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

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json({
        error: 'invalid_request',
        message: 'Invalid JSON body'
      } as AMPError, { status: 400 })
    }

    // API2-MIN-14: validate body shape
    const parsed = PatchBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({
        error: 'invalid_request',
        message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      } as AMPError, { status: 400 })
    }
    const body = parsed.data

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
    // R32: this is an AGENT-ONLY route (AMP self-deregister). Agents NEVER face
    // a sudo gate — the prior `requireSudoToken` here was a direct R32
    // violation (and routing it through the agent branch would 403 the agent's
    // own self-delete via authorize()'s self-delete ban). Self-delete authority
    // is DeleteAgent's own Gate-0, which permits an AMP-authenticated agent to
    // hard self-deregister. No UI/USER path calls this route.
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
