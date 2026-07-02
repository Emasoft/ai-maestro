/**
 * Shared helpers for enumerating plugin install state across every target
 * on the host (user-scope + every agent's local-scope).
 *
 * Originally a private function inside services/auto-update-service.ts.
 * Promoted here so the plugin-scoped AIOs (UninstallPlugin, InstallPlugin,
 * UpdatePlugin, CheckPluginUpdates) can share the same enumeration logic
 * without re-implementing it. R21.4 (one way to do one thing) — every
 * cross-target plugin operation reads the install matrix through this
 * single helper module.
 *
 * IMPORTANT: these helpers are READ-ONLY (R21.2 helpers-must-be-pure).
 * They return install-state snapshots and never write. All mutations go
 * through `ChangePlugin` (per-target) called by the higher-level AIOs.
 */

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

/** A plugin install location on the host. One row per (plugin, target). */
export interface PluginInstall {
  /** Bare plugin name (e.g. `ai-maestro-plugin`, NOT `ai-maestro-plugin@ai-maestro-plugins`). */
  name: string
  /** The marketplace this install came from. */
  marketplace: string
  /** Where the plugin lives. `user` = ~/.claude/settings.json's enabledPlugins;
   *  `local` = `<agentDir>/.claude/settings.local.json`'s enabledPlugins. */
  scope: 'user' | 'local'
  /** Required when scope='local' — absolute path to the agent's working dir. */
  agentDir?: string
  /** Required when scope='local' — the registry agent ID owning this install.
   *  Used by the AIOs to call ChangePlugin with the right authContext target. */
  agentId?: string
  /** Optional — when scope='local' AND the agent has an online tmux session,
   *  this is its session name. Used by the auto-update scheduler to queue
   *  a restart of the right session after the plugin is updated/uninstalled. */
  sessionName?: string
}

/** Resolve a `~`-prefixed path against the user's home dir. */
function resolveHome(p: string): string {
  return p.startsWith('~') ? p.replace(/^~/, os.homedir()) : p
}

/** Read the user-scope settings file's enabledPlugins map. Each entry's
 *  key is the plugin's `name@marketplace` stamp; the value is enabled-bool.
 *  We return ALL entries — enabled OR disabled — because the AIOs need to
 *  know about every install location, not just the active ones. */
export async function listUserScopePluginInstalls(): Promise<PluginInstall[]> {
  const file = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    const text = await fs.readFile(file, 'utf8')
    const json = JSON.parse(text) as { enabledPlugins?: Record<string, boolean> }
    const enabled = json.enabledPlugins || {}
    const out: PluginInstall[] = []
    for (const key of Object.keys(enabled)) {
      const at = key.lastIndexOf('@')
      if (at <= 0) continue
      out.push({
        name: key.substring(0, at),
        marketplace: key.substring(at + 1),
        scope: 'user',
      })
    }
    return out
  } catch {
    return []
  }
}

/** Walk the agent registry. For every non-deleted agent with a working
 *  directory, read its .claude/settings.local.json and emit one PluginInstall
 *  per enabledPlugins entry. Missing/malformed files are skipped silently
 *  (an agent that hasn't installed any local-scope plugin simply contributes
 *  zero entries). */
export async function listAgentLocalScopePluginInstalls(): Promise<PluginInstall[]> {
  // Lazy-imported so this module stays usable in test contexts that don't
  // boot the registry layer.
  const { loadAgents } = await import('@/lib/agent-registry')
  const { computeSessionName } = await import('@/types/agent')
  const all = loadAgents()
  const out: PluginInstall[] = []
  for (const a of all) {
    if (a.deletedAt) continue
    const wd = a.workingDirectory
    if (!wd) continue
    const settingsFile = path.join(resolveHome(wd), '.claude', 'settings.local.json')
    try {
      const text = await fs.readFile(settingsFile, 'utf8')
      const json = JSON.parse(text) as { enabledPlugins?: Record<string, boolean> }
      const enabled = json.enabledPlugins || {}
      const onlineSession = a.sessions?.find(s => s.status === 'online')
      const sessionName = onlineSession ? computeSessionName(a.name || '', onlineSession.index) : undefined
      for (const key of Object.keys(enabled)) {
        const at = key.lastIndexOf('@')
        if (at <= 0) continue
        out.push({
          name: key.substring(0, at),
          marketplace: key.substring(at + 1),
          scope: 'local',
          agentDir: wd,
          agentId: a.id,
          sessionName,
        })
      }
    } catch {
      // Missing or malformed settings.local.json — skip silently.
    }
  }
  return out
}

/** Concatenate user-scope + agent-local-scope installs. The most common
 *  call shape for plugin-scoped AIOs ("operate on this plugin everywhere
 *  it's installed"). */
export async function listAllPluginInstalls(): Promise<PluginInstall[]> {
  const [u, l] = await Promise.all([
    listUserScopePluginInstalls(),
    listAgentLocalScopePluginInstalls(),
  ])
  return [...u, ...l]
}

/** Filter the install list down to one specific plugin (matched by both
 *  name AND marketplace — the same plugin name in two marketplaces is
 *  treated as two distinct plugins, matching how the rest of the codebase
 *  keys on `name@marketplace`). */
export async function listInstallsOf(name: string, marketplace: string): Promise<PluginInstall[]> {
  const all = await listAllPluginInstalls()
  return all.filter(p => p.name === name && p.marketplace === marketplace)
}

/** List every plugin name + marketplace pair that lives in a specific
 *  marketplace's manifest. Reads the cached marketplace manifest at
 *  `~/.claude/plugins/marketplaces/<marketplace>/.claude-plugin/marketplace.json`
 *  (Claude convention) with a fallback to the flat `marketplace.json` form
 *  used by the local AI Maestro containers (R20.28).
 *
 *  Used by `UninstallMarketplace` to enumerate which plugins live in a
 *  marketplace before tearing it down (R21.6 cascade). */
export async function listPluginsInMarketplace(marketplace: string): Promise<Array<{ name: string }>> {
  const candidates = [
    path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', marketplace, '.claude-plugin', 'marketplace.json'),
    path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', marketplace, 'marketplace.json'),
  ]
  for (const c of candidates) {
    try {
      const text = await fs.readFile(c, 'utf8')
      const json = JSON.parse(text) as { plugins?: Array<{ name?: string }> }
      const list = (json.plugins || [])
        .filter(p => typeof p?.name === 'string' && p.name!.length > 0)
        .map(p => ({ name: p.name as string }))
      return list
    } catch {
      // Try next candidate path.
    }
  }
  return []
}
