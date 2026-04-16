/**
 * Role Plugin Install API
 *
 * POST /api/agents/role-plugins/install   — Install plugin locally into agent dir
 * DELETE /api/agents/role-plugins/install  — Uninstall plugin from agent dir
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  PREDEFINED_ROLE_PLUGINS,
} from '@/services/role-plugin-service'
import { ChangePlugin } from '@/services/element-management-service'
import { requireAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Authenticate before any side effect — ChangePlugin Gate 0 will further
  // authorize the call against the agent's title + governance rules.
  const auth = requireAuth(req)
  if (!auth.ok) return auth.error

  try {
    let body: { pluginName?: string; agentDir?: string; marketplaceName?: string; rolePluginSwap?: boolean }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.pluginName || typeof body.pluginName !== 'string') {
      return NextResponse.json(
        { error: 'pluginName is required' },
        { status: 400 },
      )
    }
    if (!body.agentDir || typeof body.agentDir !== 'string') {
      return NextResponse.json(
        { error: 'agentDir is required' },
        { status: 400 },
      )
    }

    // SCEN-021 P0-001: marketplace must be explicit for any non-role plugin.
    // The old default `ai-maestro-local-roles-marketplace` was silently applied
    // to plugins hosted in OTHER marketplaces, writing a wrong stamp to
    // settings.local.json and breaking the plugin at runtime (the Claude Code
    // runtime can't find the plugin body because it's not in that marketplace's
    // cache dir). For non-role plugins the client MUST supply marketplaceName.
    // For predefined role plugins the marketplace is inferred from the
    // PREDEFINED_ROLE_PLUGINS map as before.
    const predefined = PREDEFINED_ROLE_PLUGINS[body.pluginName]
    if (!predefined && !body.marketplaceName) {
      return NextResponse.json(
        { error: 'marketplaceName is required for non-role plugins' },
        { status: 400 },
      )
    }
    const marketplace = body.marketplaceName || predefined?.marketplace || 'ai-maestro-local-roles-marketplace'

    const result = await ChangePlugin(null, {
      name: body.pluginName,
      marketplace,
      action: 'install',
      scope: 'local',
      agentDir: body.agentDir,
      rolePluginSwap: body.rolePluginSwap || false,
    }, auth.context)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[role-plugins/install] Install failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to install plugin'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  // #116: Uninstalling a role-plugin is destructive — classified "strict"
  // in security-registry.json. Require a fresh sudo token.
  const sudoErr = requireSudoToken(req, 'DELETE', '/api/agents/role-plugins/install')
  if (sudoErr) return sudoErr

  // Authenticate before any side effect
  const auth = requireAuth(req)
  if (!auth.ok) return auth.error

  try {
    let body: { pluginName?: string; agentDir?: string; marketplaceName?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.pluginName || typeof body.pluginName !== 'string') {
      return NextResponse.json(
        { error: 'pluginName is required' },
        { status: 400 },
      )
    }
    if (!body.agentDir || typeof body.agentDir !== 'string') {
      return NextResponse.json(
        { error: 'agentDir is required' },
        { status: 400 },
      )
    }

    // marketplaceName is optional — defaults to the local role-plugins marketplace
    const marketplace = body.marketplaceName || 'ai-maestro-local-roles-marketplace'

    const result = await ChangePlugin(null, {
      name: body.pluginName,
      marketplace,
      action: 'uninstall',
      scope: 'local',
      agentDir: body.agentDir,
    }, auth.context)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[role-plugins/install] Uninstall failed:', error)
    const message = error instanceof Error ? error.message : 'Failed to uninstall plugin'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
