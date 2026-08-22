/**
 * Create Agent from TOML (legacy endpoint)
 *
 * POST /api/agents/create-from-toml
 *
 * Delegates to the unified createPersona service.
 * Kept for backward compatibility — prefer POST /api/agents/create-persona.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createPersona } from '@/services/role-plugin-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
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
  const auth = authenticateFromRequest(req)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const authz = authorize(auth, 'create-agent')
  if (!authz.allowed) {
    return NextResponse.json({ error: authz.reason }, { status: 403 })
  }

  try {
    let body: { tomlContent?: string; personaName?: string; agentDescription?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.tomlContent || typeof body.tomlContent !== 'string') {
      return NextResponse.json(
        { error: 'tomlContent is required and must be a string' },
        { status: 400 },
      )
    }

    if (!body.personaName || typeof body.personaName !== 'string') {
      return NextResponse.json(
        { error: 'personaName is required and must be a string' },
        { status: 400 },
      )
    }

    // Validate persona name: lowercase alphanumeric + hyphens only
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(body.personaName)) {
      return NextResponse.json(
        { error: 'personaName must be lowercase alphanumeric with hyphens (e.g. "peter-bot")' },
        { status: 400 },
      )
    }

    const result = await createPersona({
      personaName: body.personaName,
      tomlContent: body.tomlContent,
      agentDescription: body.agentDescription,
    })

    return NextResponse.json({
      success: true,
      personaName: result.personaName,
      agentDir: result.agentDir,
      pluginName: result.pluginName,
      pluginDir: result.agentDir, // backward compat
      mainAgentName: result.mainAgentName,
    })
  } catch (error) {
    console.error('[create-from-toml] Failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to create agent'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
