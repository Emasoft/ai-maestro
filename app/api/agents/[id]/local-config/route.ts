import { NextRequest, NextResponse } from 'next/server'
import { isValidUuid } from '@/lib/validation'
import { scanAgentLocalConfig } from '@/services/agent-local-config-service'
import { requireAuth } from '@/lib/route-auth'

/**
 * GET /api/agents/[id]/local-config
 *
 * Scans the agent's project .claude/ directory and returns all locally
 * installed elements (skills, agents, hooks, rules, commands, MCP, LSP,
 * plugins, role-plugin, settings).
 *
 * Used by the AgentProfilePanel for real-time polling (3-5s interval).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // N2: this dumped any agent's full local element config (incl.
  // settings.local.json tool/MCP grants) by UUID with NO auth. Authenticate,
  // and let an agent read ONLY its own config; the system owner (web UI
  // AgentProfilePanel) may read any.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    if (auth.agentId && auth.agentId !== id) {
      return NextResponse.json({ error: 'Forbidden — you may only read your own local config' }, { status: 403 })
    }

    const result = scanAgentLocalConfig(id)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[local-config GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
