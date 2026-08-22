/**
 * Docker Agent Create API
 *
 * POST /api/agents/docker/create — Create agent in Docker container
 *
 * Thin wrapper — business logic in services/agents-docker-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { createDockerAgent } from '@/services/agents-docker-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // TRDD-DQVPODKW. This used `enforceAuth`, whose own docstring says it is for
  // mutations where "any authenticated caller can call this" — and this route MINTS
  // AN AGENT. TRDD-F1SL03CK closed exactly this hole on POST /api/agents and left
  // three sibling doors open; this is one of them.
  //
  // `authenticateFromRequest`, NOT `requireAuth`: authorize() reads
  // `auth.governanceTitle` off an AgentAuthResult, and requireAuth returns
  // `{ok, context, agentId}`, on which that field is undefined — so the gate would
  // deny EVERY caller including a MANAGER. My first cut did exactly that, and all
  // three denial tests passed anyway (a gate that refuses everyone refuses a MEMBER
  // too). Only the MANAGER positive control caught it. Shape matches the landed
  // app/api/agents/route.ts:61-74.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const authz = authorize(auth, 'create-agent')
  if (!authz.allowed) {
    return NextResponse.json({ error: authz.reason }, { status: 403 })
  }

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
