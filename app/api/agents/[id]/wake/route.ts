import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { wakeAgent } from '@/services/agents-core-service'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { getAgent } from '@/lib/agent-registry'
import { PLUGIN_COMPATIBLE_TITLES } from '@/lib/ecosystem-constants'
import type { AgentRole } from '@/types/agent'

/**
 * POST /api/agents/[id]/wake
 * Wake a hibernated agent.
 * Identity auth only — all governance checks (MANAGER/COS, team-agent gate)
 * are inside wakeAgent Gate 0.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    // Identity auth: verify caller identity, build auth context for Gate 0
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    // TRDD-c7a81642 (R9.13 extension, 2026-04-20): refuse wake when the
    // agent is marked roleMissing. A role-plugin must be assigned via
    // Profile → Config tab before the agent can be awakened. We compute
    // the list of compatible plugin options so the UI can offer them
    // directly (no registry drift — the source of truth is the TOML
    // compatibility map in ecosystem-constants.ts).
    const agent = getAgent(id)
    if (agent?.roleMissing) {
      const title = (agent.governanceTitle ?? 'autonomous') as AgentRole
      const compatibleOptions = Object.entries(PLUGIN_COMPATIBLE_TITLES)
        .filter(([, titles]) => (titles as readonly string[]).includes(title))
        .map(([plugin]) => plugin)
      return NextResponse.json({
        error: 'role_plugin_required',
        message: `Agent "${agent.label ?? agent.name}" cannot be awakened until a compatible role-plugin is assigned. Open Profile → Config tab and choose a role-plugin from the picker.`,
        profileDeepLink: `/?agent=${encodeURIComponent(id)}&tab=config`,
        compatibleOptions,
        governanceTitle: agent.governanceTitle ?? null,
      }, { status: 409 })
    }

    // Parse optional body
    let startProgram = true
    let sessionIndex = 0
    let program: string | undefined
    try {
      const body = await request.json()
      if (body.startProgram === false) {
        startProgram = false
      }
      if (typeof body.sessionIndex === 'number') {
        // SF-061: Bounds check sessionIndex to prevent out-of-range values
        if (body.sessionIndex < 0 || body.sessionIndex > 99) {
          return NextResponse.json({ error: 'Invalid sessionIndex' }, { status: 400 })
        }
        sessionIndex = body.sessionIndex
      }
      if (typeof body.program === 'string') {
        // SF-010: Do not lowercase program name -- case-sensitive filesystems need exact case
        // SF-064: Sanitize program name to prevent path traversal (strip directory components)
        program = path.basename(String(body.program))
      }
    } catch {
      // No body or invalid JSON — use defaults (CC-P1-611: removed debug logging)
    }

    // Delegate to wakeAgent — Gate 0 handles authorization internally
    const result = await wakeAgent(id, {
      startProgram,
      sessionIndex,
      program,
      authContext: buildAuthContext(auth),
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Wake POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
