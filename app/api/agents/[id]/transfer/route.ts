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
import { enforceAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { internalError } from '@/lib/error-response'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

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
    const result = await transferAgent(id, body)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    return internalError(error, 'agents-transfer')
  }
}
