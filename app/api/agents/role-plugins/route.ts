/**
 * Role Plugins API
 *
 * GET  /api/agents/role-plugins         — List available role plugins
 * POST /api/agents/role-plugins         — Generate a role plugin from .agent.toml
 * DELETE /api/agents/role-plugins?name= — Delete a role plugin
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { internalError } from '@/lib/error-response'
import {
  generatePluginFromToml,
  listRolePlugins,
  getPluginsForTitle,
  deleteRolePlugin,
  PREDEFINED_ROLE_PLUGINS,
  GITHUB_MARKETPLACE_NAME,
} from '@/services/role-plugin-service'
import { TITLE_PLUGIN_MAP } from '@/lib/ecosystem-constants'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Authentication gate. Per the project H24 rule every /api/* surface must be
  // authenticated, and the /api/* middleware only does a structural
  // credential-shape check (it defers real verification to the handler — a
  // forged well-formed cookie passes middleware). The POST/DELETE siblings on
  // this route already call enforceAuth; the GET was the lone unauthenticated
  // path. Adding the same guard closes that gap without changing behavior for
  // authenticated callers.
  const authErr = enforceAuth(req)
  if (authErr) return authErr

  try {
    const title = req.nextUrl.searchParams.get('title')
    const client = req.nextUrl.searchParams.get('client')
    let plugins = title ? await getPluginsForTitle(title, client || undefined) : await listRolePlugins()
    // SCEN-006 fix: when no native plugin exists for target client, fall back to the
    // Claude-native required plugin so the wizard doesn't block. ChangeTitle Gates
    // 15-16 will auto-convert at agent creation / title assignment.
    if (title && client && plugins.length === 0) {
      const defaultPlugin = TITLE_PLUGIN_MAP[title.toUpperCase()]
      if (defaultPlugin) {
        const claudeCandidates = await getPluginsForTitle(title, 'claude')
        const match = claudeCandidates.find(p => p.name === defaultPlugin) ?? claudeCandidates[0]
        if (match) {
          plugins = [match]
        } else {
          // Last-resort default descriptor (no .agent.toml resolution — the pipeline
          // still handles conversion at commit time).
          plugins = [
            {
              name: defaultPlugin,
              version: '1.0.0',
              description: `${title.toUpperCase()} — auto-assigned default (will be converted for ${client})`,
              pluginDir: '',
              source: 'marketplace',
              marketplace: GITHUB_MARKETPLACE_NAME,
              compatibleTitles: [title.toUpperCase()],
              compatibleClients: ['claude-code'],
            } as any,
          ]
        }
      }
    }
    return NextResponse.json({ plugins })
  } catch (error) {
    console.error('[role-plugins] List failed:', error)
    return NextResponse.json({ error: 'Failed to list role plugins' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // #114: Authenticate before any side effect.
  const authErr = enforceAuth(req)
  if (authErr) return authErr

  try {
    let body: { tomlContent?: string; agentDescription?: string }
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

    const result = await generatePluginFromToml(body.tomlContent, body.agentDescription)
    return NextResponse.json({
      success: true,
      pluginName: result.pluginName,
      pluginDir: result.pluginDir,
      mainAgentName: result.mainAgentName,
    })
  } catch (error) {
    return internalError(error, 'role-plugins-generate')
  }
}

export async function DELETE(req: NextRequest) {
  // #114: Authenticate before any side effect.
  const authErr = enforceAuth(req)
  if (authErr) return authErr

  // API2-MAJ-01: route is classified strict in security-registry.json but
  // was previously missing the sudo gate. Requires fresh sudo token.
  const sudoErr = requireSudoToken(req, 'DELETE', '/api/agents/role-plugins')
  if (sudoErr) return sudoErr

  const name = req.nextUrl.searchParams.get('name')
  if (!name) {
    return NextResponse.json({ error: 'name query parameter is required' }, { status: 400 })
  }

  // Guard: reject path traversal and shell metacharacters in plugin name
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: 'Invalid plugin name — only alphanumeric, hyphens, and underscores allowed' }, { status: 400 })
  }

  // Guard: prevent deletion of default marketplace role plugins
  if (Object.keys(PREDEFINED_ROLE_PLUGINS).includes(name)) {
    return NextResponse.json({ error: 'Cannot delete default marketplace role plugins' }, { status: 403 })
  }

  try {
    await deleteRolePlugin(name)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[role-plugins] Delete failed:', error)
    return NextResponse.json({ error: 'Failed to delete role plugin' }, { status: 500 })
  }
}
