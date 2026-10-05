/**
 * Agent Transfer API
 *
 * POST /api/agents/[id]/transfer — Transfer agent to another AI Maestro instance
 *
 * Thin wrapper — business logic in services/agents-transfer-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { transferAgent } from '@/services/agents-transfer-service'
import { isValidUuid } from '@/lib/validation'
import { requireAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { internalError } from '@/lib/error-response'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  // API2-MAJ-18: agent transfer is destructive — the agent leaves this
  // host and lives on the remote instance. Require sudo so a stolen
  // session cookie can't relocate the agent.
  const sudoErr = requireSudoToken(request, 'POST', '/api/agents/[id]/transfer')
  if (sudoErr) return sudoErr

  try {
    const { id } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    // The service destructures the body and throws on null (a 500 today); reject non-objects here.
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }
    // An unknown mode used to behave silently as a copy. An ABSENT mode stays allowed.
    if (body.mode !== undefined && body.mode !== 'move' && body.mode !== 'clone') {
      return NextResponse.json({ error: "mode must be 'move' or 'clone'" }, { status: 400 })
    }
    // Owner ruling: agents may only soft-delete. Move mode hard-removes the local agent
    // (fs.rmSync, no cemetery copy), so only the system owner (no agentId) may use it.
    // The service acts on `mode === 'move'` only, so that is the exact condition to refuse.
    // As read on 2026-10-05, transferAgent's own export fetch sends no credential and the export
    // route answers 401 to that, so the service currently fails before importing or deleting;
    // this check becomes load-bearing once those calls carry a credential.
    if (auth.agentId && body.mode === 'move') {
      return NextResponse.json(
        {
          error: 'move_reserved_to_owner',
          message: 'Moving an agent off this host removes it locally with no cemetery copy; only the system owner may do it.',
        },
        { status: 403 }
      )
    }
    const result = await transferAgent(id, body)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    return internalError(error, 'agents-transfer')
  }
}
