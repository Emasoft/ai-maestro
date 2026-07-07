import { NextRequest, NextResponse } from 'next/server'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { getAgent } from '@/lib/agent-registry'
import { ensureCorePluginInstalled } from '@/services/agents-core-service'
import { detectClientType } from '@/lib/client-capabilities'

/**
 * POST /api/agents/[id]/ensure-core
 *
 * TRDD-I75EMTK0: runs the R17 core-plugin self-heal (ensureCorePluginInstalled)
 * on demand, outside the wakeAgent / createSession paths.
 *
 * WHY this route exists: the dashboard's "New Session" button
 * (AgentProfile.tsx handleNewSession) injects a launch command into an
 * ALREADY-RUNNING tmux pane — it never calls wakeAgent (that only fires when
 * no tmux session exists yet), so the R17 wake-gate never ran on this path.
 * A user whose core plugin was disabled/removed/corrupted who clicked "New
 * Session" launched a Claude/Codex instance with no ai-maestro-plugin hooks,
 * leaving AI Maestro blind to it (observed live in SCEN-012 S029). This route
 * gives that surface the same self-heal the other two launch paths already
 * have; handleNewSession awaits it BEFORE sending the launch command.
 *
 * Classified "strict" in security-registry.json: this route can trigger a
 * plugin (re)install, a privileged filesystem + registry write, so it is
 * gated the same way DELETE/PATCH agent routes are (sudo for the user,
 * AID+title for an agent caller — see lib/sudo-guard.ts STRICT_AGENT_RULES).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    // Path template MUST be the real request-path template this handler
    // serves — see the SCEN-016 op-binding note in app/api/agents/[id]/route.ts.
    const sudoErr = requireSudoToken(request, 'POST', '/api/agents/[id]/ensure-core')
    if (sudoErr) return sudoErr

    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const agent = getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const workingDirectory = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
    if (!workingDirectory) {
      return NextResponse.json({ error: 'Agent has no working directory' }, { status: 400 })
    }

    // Mirror the wakeAgent wake-gate's client refusal (TRDD-I75EMTK0): only
    // Claude and Codex have validated InstallElement adapter coverage today.
    const clientType = detectClientType(agent.program || '')
    if (clientType !== 'claude' && clientType !== 'codex') {
      return NextResponse.json(
        {
          error: `ensure-core is not yet implemented for client "${clientType}". ` +
            `Only Claude and Codex agents are supported.`,
        },
        { status: 501 }
      )
    }

    const result = await ensureCorePluginInstalled(id, workingDirectory, clientType, buildAuthContext(auth))
    if (!result.success) {
      // Mirrors the wakeAgent sentinel so the UI can reuse the same
      // "core dependency missing" alert surface for both paths.
      return NextResponse.json({ error: 'role_missing_core' }, { status: 400 })
    }

    return NextResponse.json({ success: true, installed: result.installed })
  } catch (error) {
    console.error('[Agents ensure-core POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
