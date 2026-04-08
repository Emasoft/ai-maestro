/**
 * Codex Plugin Adapter — Native plugin support for OpenAI Codex.
 *
 * Codex has a plugin system similar to Claude Code:
 * - Plugins stored in ~/.codex/plugins/cache/
 * - State tracked in ~/.codex/config.toml
 * - Skills in skills/<name>/SKILL.md format
 * - Plugin manifest at .codex-plugin/plugin.json
 *
 * For now, this adapter copies the converted plugin into the Codex
 * plugin directory and registers it in config. When Codex gains a
 * CLI for plugin management, this adapter should delegate to it.
 */

import { mkdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { homedir } from 'os'
import type {
  ClientPluginAdapter, StoredPlugin, PluginAdapterOptions,
  PluginInstallResult, PluginUninstallResult, PluginActionResult, PluginInstallState
} from './types'

const HOME = homedir()
const CODEX_PLUGINS_DIR = path.join(HOME, '.codex', 'plugins', 'cache')

const codexAdapter: ClientPluginAdapter = {
  clientType: 'codex',
  supportsEnableDisable: false,

  async install(plugin: StoredPlugin, _targetDir: string, _options?: PluginAdapterOptions): Promise<PluginInstallResult> {
    const storageDir = plugin.storageDir
    if (!existsSync(storageDir)) {
      return { success: false, installedPaths: [], error: `Stored plugin not found: ${storageDir}` }
    }

    // Copy the converted plugin to Codex plugin cache
    const destDir = path.join(CODEX_PLUGINS_DIR, 'ai-maestro-converted', plugin.name, plugin.version || 'local')
    await mkdir(destDir, { recursive: true })

    // Recursive copy
    const { createElementAdapter } = await import('./element-adapter')
    const elementAdapter = createElementAdapter('codex')
    // Reuse element adapter's install to copy files, but to the Codex cache location
    const result = await elementAdapter.install(
      { ...plugin, storageDir },
      destDir,
      _options
    )

    if (!result.success) return result

    return { success: true, installedPaths: result.installedPaths }
  },

  async uninstall(plugin: StoredPlugin, _targetDir: string): Promise<PluginUninstallResult> {
    const pluginDir = path.join(CODEX_PLUGINS_DIR, 'ai-maestro-converted', plugin.name)
    if (existsSync(pluginDir)) {
      await rm(pluginDir, { recursive: true })
    }
    return { success: true }
  },

  async enable(): Promise<PluginActionResult> {
    // Codex doesn't have enable/disable yet
    return { success: true }
  },

  async disable(): Promise<PluginActionResult> {
    return { success: true }
  },

  async detectState(pluginName: string, _targetDir: string): Promise<PluginInstallState> {
    const pluginDir = path.join(CODEX_PLUGINS_DIR, 'ai-maestro-converted', pluginName)
    if (existsSync(pluginDir)) {
      return { installed: true, enabled: true, method: 'settings-write' }
    }
    return { installed: false, enabled: false, method: 'settings-write' }
  },
}

export default codexAdapter
