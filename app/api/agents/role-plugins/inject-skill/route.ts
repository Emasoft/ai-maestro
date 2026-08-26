import { NextRequest, NextResponse } from 'next/server'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { injectAiMaestroSkills } from '@/services/role-plugin-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'

const PLUGINS_DIR = join(homedir(), 'agents', 'role-plugins', 'plugins')

/**
 * POST /api/agents/role-plugins/inject-skill
 * Inject AI Maestro compatibility skills into an existing custom role-plugin.
 * Body: { pluginName: string }
 */
export async function POST(request: NextRequest) {
  // TRDD-DQVPODKW. This used `enforceAuth` ("any authenticated caller can call this"),
  // and injecting skills into a shared local-marketplace plugin is a fleet-wide
  // capability change: every agent using that plugin inherits the injected skills.
  // The authority is 'manage-skills' (the element pipelines' vocabulary for
  // installing/removing skills); with no target agent, authorize() grants it to
  // MANAGER and the system owner only — a plugin mutation is not team-scoped, so a
  // COS is correctly refused here.
  //
  // `authenticateFromRequest`, NOT `requireAuth`: authorize() reads
  // `auth.governanceTitle` off an AgentAuthResult, and requireAuth's shape leaves it
  // undefined — a gate built on it denies EVERYONE, MANAGER included, and every
  // denial test still passes. Same trap the sibling minting routes recorded.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const authz = authorize(auth, 'manage-skills')
  if (!authz.allowed) {
    return NextResponse.json({ error: authz.reason }, { status: 403 })
  }

  try {
    const { pluginName } = await request.json()
    if (!pluginName || typeof pluginName !== 'string') {
      return NextResponse.json({ error: 'pluginName is required' }, { status: 400 })
    }

    // Validate plugin name (no path traversal)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(pluginName)) {
      return NextResponse.json({ error: 'Invalid plugin name' }, { status: 400 })
    }

    const pluginDir = join(PLUGINS_DIR, pluginName)
    if (!existsSync(pluginDir)) {
      return NextResponse.json(
        { error: `Plugin "${pluginName}" not found in local marketplace` },
        { status: 404 }
      )
    }

    const skills = await injectAiMaestroSkills(pluginDir)
    return NextResponse.json({ success: true, pluginName, skills })
  } catch (error) {
    return NextResponse.json(
      { error: `Skill injection failed: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
