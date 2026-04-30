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

    // SCEN-013 PROP-P0-002 FIX (013.05): refuse wake when the core plugin
    // (ai-maestro-plugin / R17) is missing. Same shape as R9.13 above so
    // the UI can render a single "core dependency missing" alert. PG02 in
    // InstallElement sets corePluginMissing=true after every failed install
    // attempt (and clears it on success), so this check covers all paths
    // through which the registry can drift out of sync with reality.
    if (agent?.corePluginMissing) {
      return NextResponse.json({
        error: 'role_missing_core',
        message: `Agent "${agent.label ?? agent.name}" cannot be awakened: the core ai-maestro-plugin is missing or disabled. ` +
          `Without this plugin, the agent has no hooks, no state detection, and no messaging — it cannot function. ` +
          `The wake endpoint will retry installation automatically; if it keeps failing, install manually via Profile → Config → Plugins.`,
        profileDeepLink: `/?agent=${encodeURIComponent(id)}&tab=config`,
      }, { status: 400 })
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
      // SCEN-013 013.05: expand the role_missing_core sentinel from
      // wakeAgent's R17 gate into the same rich JSON body the route-level
      // pre-check above produces, so callers see one consistent shape
      // regardless of whether the violation was detected before or after
      // the InstallElement attempt.
      if (result.error === 'role_missing_core') {
        const a = getAgent(id)
        return NextResponse.json({
          error: 'role_missing_core',
          message: `Agent "${a?.label ?? a?.name ?? id}" cannot be awakened: automatic install of the core ai-maestro-plugin failed. ` +
            `Without this plugin, the agent has no hooks, no state detection, and no messaging — it cannot function. ` +
            `Open Profile → Config → Plugins and install ai-maestro-plugin manually, or check pm2 logs for the underlying install error.`,
          profileDeepLink: `/?agent=${encodeURIComponent(id)}&tab=config`,
        }, { status: result.status })
      }
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Wake POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
