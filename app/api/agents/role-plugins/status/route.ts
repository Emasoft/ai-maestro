/**
 * Role Plugin Status API
 *
 * GET /api/agents/role-plugins/status
 *
 * Lists all agents and their installed role-plugins. Only role-plugins
 * are indexed — normal plugins are excluded (too many to scan).
 *
 * Query parameters:
 *   ?filter=<string>    — Filter by agent name or plugin name (case-insensitive substring match)
 *   ?plugin=<name>      — Find all agents that have a specific role-plugin installed
 *   ?scope=local|user   — Filter by install scope (default: both)
 *   ?agentId=<uuid>     — Show role-plugins for a specific agent only
 *
 * Response:
 *   {
 *     agents: [{
 *       agentId, name, label, governanceTitle,
 *       rolePlugin: { name, marketplace, enabled, scope, pluginKey } | null,
 *       warnings: string[]  // e.g. "role-plugin at user scope"
 *     }],
 *     summary: { total, withPlugin, withoutPlugin, userScopeWarnings }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadAgents } from '@/lib/agent-registry'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { PREDEFINED_ROLE_PLUGINS } from '@/services/element-management-service'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const dynamic = 'force-dynamic'

interface AgentRolePluginInfo {
  agentId: string
  name: string
  label: string | null
  governanceTitle: string | null
  workingDirectory: string | null
  rolePlugin: {
    name: string
    marketplace: string
    enabled: boolean
    scope: 'local' | 'user'
    pluginKey: string
  } | null
  warnings: string[]
}

const HOME = homedir()
const ROLE_PLUGIN_NAMES = new Set(Object.keys(PREDEFINED_ROLE_PLUGINS))

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Scan a settings file for role-plugin entries.
 * Returns array of { name, marketplace, enabled, pluginKey }.
 */
function findRolePluginsInSettings(
  settingsPath: string,
): Array<{ name: string; marketplace: string; enabled: boolean; pluginKey: string }> {
  const data = readJsonSafe(settingsPath)
  if (!data) return []

  const ep = data.enabledPlugins as Record<string, boolean> | undefined
  if (!ep || typeof ep !== 'object') return []

  const results: Array<{ name: string; marketplace: string; enabled: boolean; pluginKey: string }> = []

  for (const [key, enabled] of Object.entries(ep)) {
    // Key format: pluginName@marketplace
    const atIndex = key.indexOf('@')
    if (atIndex === -1) continue
    const pluginName = key.substring(0, atIndex)

    if (ROLE_PLUGIN_NAMES.has(pluginName)) {
      results.push({
        name: pluginName,
        marketplace: key.substring(atIndex + 1),
        enabled: !!enabled,
        pluginKey: key,
      })
    }
  }

  return results
}

export async function GET(req: NextRequest) {
  // Authentication gate. The /api/* middleware only does a STRUCTURAL
  // credential-shape check and explicitly defers cryptographic verification
  // to the handler — a forged-but-well-formed `aim_session` cookie passes
  // middleware. This endpoint enumerates EVERY agent's name, governanceTitle,
  // absolute workingDirectory, and role-plugin install state, so it MUST
  // verify identity before responding (project invariant: routes derive
  // caller identity from authenticateFromRequest(); siblings like
  // app/api/agents/route.ts GET already do this). Without it, an attacker
  // with a fake cookie could enumerate the agent roster + leak local paths.
  const auth = authenticateFromRequest(req)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    const filterParam = req.nextUrl.searchParams.get('filter')
    const pluginParam = req.nextUrl.searchParams.get('plugin')
    const scopeParam = req.nextUrl.searchParams.get('scope') as 'local' | 'user' | null
    const agentIdParam = req.nextUrl.searchParams.get('agentId')

    // Use safe case-insensitive string match instead of user-controlled regex (ReDoS prevention)
    const filterLower = filterParam ? filterParam.toLowerCase() : null

    // 1. Scan user-scope settings for role-plugins (should be empty — flag if found)
    const userSettingsPath = join(HOME, '.claude', 'settings.json')
    const userScopePlugins = findRolePluginsInSettings(userSettingsPath)

    // 2. Load all agents and scan their local settings
    const agents = loadAgents()
    const results: AgentRolePluginInfo[] = []

    for (const agent of agents) {
      // Filter by agentId if specified
      if (agentIdParam && agent.id !== agentIdParam) continue

      const warnings: string[] = []
      let rolePlugin: AgentRolePluginInfo['rolePlugin'] = null

      // Check local-scope role-plugins
      const workDir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
      if (workDir) {
        const localSettingsPath = join(workDir, '.claude', 'settings.local.json')
        const localPlugins = findRolePluginsInSettings(localSettingsPath)

        if (localPlugins.length > 1) {
          warnings.push(`Multiple role-plugins installed (${localPlugins.map(p => p.name).join(', ')}) — only one should exist`)
        }

        if (localPlugins.length > 0) {
          const lp = localPlugins[0]
          rolePlugin = { ...lp, scope: 'local' }
        }
      }

      // Check if this agent has a user-scope role-plugin (should never happen)
      for (const up of userScopePlugins) {
        warnings.push(`SECURITY: Role-plugin "${up.name}" found at USER scope in settings.json — must be local scope only`)
        // If no local plugin, show the user-scope one
        if (!rolePlugin) {
          rolePlugin = { ...up, scope: 'user' }
        }
      }

      // Check governance title consistency
      const expectedPlugin = agent.governanceTitle
        ? PREDEFINED_ROLE_PLUGINS[
            // Map title → expected plugin name from the TITLE_PLUGIN_MAP
            ({ manager: 'ai-maestro-assistant-manager-agent',
               'chief-of-staff': 'ai-maestro-chief-of-staff',
               orchestrator: 'ai-maestro-orchestrator-agent',
               architect: 'ai-maestro-architect-agent',
               integrator: 'ai-maestro-integrator-agent',
               maintainer: 'ai-maestro-maintainer-agent',
            } as Record<string, string>)[agent.governanceTitle] || ''
          ]
        : null

      if (expectedPlugin && !rolePlugin) {
        warnings.push(`Title is ${(agent.governanceTitle || '').toUpperCase()} but no role-plugin installed`)
      }
      if (rolePlugin && !expectedPlugin && agent.governanceTitle !== 'member' && agent.governanceTitle !== 'autonomous') {
        warnings.push(`Has role-plugin "${rolePlugin.name}" but title "${agent.governanceTitle}" doesn't require one`)
      }

      const info: AgentRolePluginInfo = {
        agentId: agent.id,
        name: agent.name,
        label: agent.label || null,
        governanceTitle: agent.governanceTitle || null,
        workingDirectory: workDir || null,
        rolePlugin,
        warnings,
      }

      // Apply filters — safe string match (no user-controlled regex)
      if (filterLower) {
        const searchStr = `${agent.name} ${agent.label || ''} ${rolePlugin?.name || ''}`.toLowerCase()
        if (!searchStr.includes(filterLower)) continue
      }
      if (pluginParam && rolePlugin?.name !== pluginParam) continue
      if (scopeParam && rolePlugin?.scope !== scopeParam) continue

      results.push(info)
    }

    // Summary stats
    const summary = {
      total: results.length,
      withPlugin: results.filter(r => r.rolePlugin !== null).length,
      withoutPlugin: results.filter(r => r.rolePlugin === null).length,
      userScopeWarnings: userScopePlugins.length,
      inconsistencies: results.filter(r => r.warnings.length > 0).length,
    }

    return NextResponse.json({ agents: results, summary })
  } catch (error) {
    // API2-MIN-01: don't leak error.message to client; logged below
    console.error('[role-plugins/status] Failed:', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'role-plugins-status' },
      { status: 500 },
    )
  }
}
