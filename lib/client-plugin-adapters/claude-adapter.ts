/**
 * Claude Code Plugin Adapter
 *
 * Delegates to `claude plugin` CLI for user-scope operations,
 * and to settings.local.json manipulation for local-scope.
 *
 * This is an extraction of the existing G09 logic from
 * element-management-service.ts, preserving exact behavior.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ClientPluginAdapter, StoredPlugin, PluginAdapterOptions, PluginInstallResult, PluginUninstallResult, PluginActionResult, PluginInstallState } from './types'

const execFileAsync = promisify(execFile)
const HOME = homedir()

function resolveDir(dir: string): string {
  return dir.startsWith('~') ? dir.replace('~', HOME) : dir
}

async function loadJsonSafe(filePath: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

async function saveJsonSafe(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function buildPluginKey(name: string, marketplace?: string): string {
  return marketplace ? `${name}@${marketplace}` : name
}

const claudeAdapter: ClientPluginAdapter = {
  clientType: 'claude',
  supportsEnableDisable: true,

  async install(plugin: StoredPlugin, targetDir: string, options?: PluginAdapterOptions): Promise<PluginInstallResult> {
    const marketplace = options?.marketplace || ''
    const scope = options?.scope || 'local'

    try {
      if (scope === 'user') {
        await execFileAsync('claude', ['plugin', 'install', plugin.name, marketplace, '--scope', 'user'], { timeout: 120000 })
      } else {
        // Local scope: use claude CLI with --scope local --cwd
        const resolved = resolveDir(targetDir)
        await execFileAsync('claude', [
          'plugin', 'install', plugin.name, marketplace,
          '--scope', 'local', '--cwd', resolved
        ], { timeout: 120000 })
      }
      return { success: true, installedPaths: [] }
    } catch (err) {
      return { success: false, installedPaths: [], error: err instanceof Error ? err.message : String(err) }
    }
  },

  async uninstall(plugin: StoredPlugin, targetDir: string, options?: Pick<PluginAdapterOptions, 'scope'>): Promise<PluginUninstallResult> {
    const scope = options?.scope || 'local'
    const pluginKey = buildPluginKey(plugin.name, plugin.sourcePlugin)

    try {
      if (scope === 'user') {
        await execFileAsync('claude', ['plugin', 'uninstall', pluginKey, '--scope', 'user'], { timeout: 30000 })
      } else {
        const resolved = resolveDir(targetDir)
        await execFileAsync('claude', [
          'plugin', 'uninstall', pluginKey,
          '--scope', 'local', '--cwd', resolved
        ], { timeout: 30000 })
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async enable(plugin: StoredPlugin, targetDir: string): Promise<PluginActionResult> {
    const pluginKey = buildPluginKey(plugin.name, plugin.sourcePlugin)
    const resolved = resolveDir(targetDir)
    const localSettings = join(resolved, '.claude', 'settings.local.json')

    try {
      await mkdir(join(resolved, '.claude'), { recursive: true })
      const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
      const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
      ep[pluginKey] = true
      settings.enabledPlugins = ep
      await saveJsonSafe(localSettings, settings)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async disable(plugin: StoredPlugin, targetDir: string): Promise<PluginActionResult> {
    const pluginKey = buildPluginKey(plugin.name, plugin.sourcePlugin)
    const resolved = resolveDir(targetDir)
    const localSettings = join(resolved, '.claude', 'settings.local.json')

    try {
      await mkdir(join(resolved, '.claude'), { recursive: true })
      const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
      const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
      ep[pluginKey] = false
      settings.enabledPlugins = ep
      await saveJsonSafe(localSettings, settings)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async detectState(pluginName: string, targetDir: string, options?: Pick<PluginAdapterOptions, 'scope' | 'marketplace'>): Promise<PluginInstallState> {
    const scope = options?.scope || 'local'
    const pluginKey = buildPluginKey(pluginName, options?.marketplace)

    try {
      let settingsPath: string
      if (scope === 'user') {
        settingsPath = join(HOME, '.claude', 'settings.json')
      } else {
        const resolved = resolveDir(targetDir)
        settingsPath = join(resolved, '.claude', 'settings.local.json')
      }

      if (!existsSync(settingsPath)) {
        return { installed: false, enabled: false, method: 'native-cli' }
      }

      const settings = await loadJsonSafe(settingsPath)
      const ep = (settings.enabledPlugins || {}) as Record<string, boolean | undefined>
      const state = ep[pluginKey]

      if (state === undefined) {
        return { installed: false, enabled: false, method: 'native-cli' }
      }
      return { installed: true, enabled: state === true, method: 'native-cli' }
    } catch {
      return { installed: false, enabled: false, method: 'native-cli' }
    }
  },
}

export default claudeAdapter
