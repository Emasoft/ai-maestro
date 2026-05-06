/**
 * Docker Agent Create API
 *
 * POST /api/agents/docker/create — Create agent in Docker container
 *
 * Thin wrapper — business logic in services/agents-docker-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { createDockerAgent } from '@/services/agents-docker-service'
import { enforceAuth } from '@/lib/route-auth'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    // CC-P2-008: Guard against malformed JSON body
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const result = await createDockerAgent(body)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // API2-MIN-01: log server-side, return generic error to client
    return internalError(error, 'docker-create')
  }
}
