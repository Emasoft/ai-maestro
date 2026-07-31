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
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { withLock } from '@/lib/file-lock'
import { assertAdapterContext } from './adapter-context'
import type { ClientPluginAdapter, StoredPlugin, PluginAdapterOptions, PluginInstallResult, PluginUninstallResult, PluginActionResult, PluginInstallState } from './types'

const execFileAsync = promisify(execFile)
const HOME = homedir()

function resolveDir(dir: string): string {
  return dir.startsWith('~') ? dir.replace('~', HOME) : dir
}

// FROM `lib/json-io.ts` (TRDD-CS25TA6W). The copy that used to live here had no `existsSync`, so
// ENOENT and a parse failure were the same answer by construction. This module is in
// `ChangePlugin`'s OWN call path, so its unguarded copy bypassed the service's guard one layer down
// on every adapter install — the urgent one of the three.
import { loadJsonSafe, saveJsonSafe } from '@/lib/json-io'


/**
 * LIB2-MAJ-04: Lock key for settings.local.json mutations. The same key MUST be
 * used by every caller that mutates settings.local.json on the same agent dir to
 * prevent enable/disable race conditions. The lock is keyed on the resolved
 * absolute path so different agents serialize independently.
 */
function settingsLockKey(localSettings: string): string {
  return `claude-adapter:settings.local:${localSettings}`
}

function buildPluginKey(name: string, marketplace?: string): string {
  return marketplace ? `${name}@${marketplace}` : name
}

const claudeAdapter: ClientPluginAdapter = {
  clientType: 'claude',
  supportsEnableDisable: true,

  async install(plugin: StoredPlugin, targetDir: string, options?: PluginAdapterOptions): Promise<PluginInstallResult> {
    assertAdapterContext('claudeAdapter.install')
    const marketplace = options?.marketplace || ''
    const scope = options?.scope || 'local'

    try {
      if (scope === 'user') {
        await execFileAsync('claude', ['plugin', 'install', plugin.name, marketplace, '--scope', 'user'], { timeout: 120000 })
      } else {
        // Local scope: the CLI has NO --cwd flag. `--scope local` means "the
        // project dir this process is running in", so the directory is passed
        // as the SPAWN cwd, never as an argument.
        //
        // It was `--cwd <dir>` until 2026-07-30 (TRDD-RCL2HC9Y), and that is
        // the worst shape a bug can take: `claude` prints
        // `error: unknown option '--cwd'` and EXITS 0, so execFileAsync
        // resolves and this returns {success:true} having run NOTHING. Every
        // local install/uninstall through this adapter was a silent no-op —
        // which is why callers grew "belt-and-braces" direct settings writes
        // to compensate. Verified live: with the flag the command never runs;
        // without it, from the same cwd, the install lands and the CLI writes
        // both settings.local.json and its own installed_plugins.json row.
        const resolved = resolveDir(targetDir)
        await execFileAsync('claude', [
          'plugin', 'install', plugin.name, marketplace,
          '--scope', 'local'
        ], { timeout: 120000, cwd: resolved })
      }
      return { success: true, installedPaths: [] }
    } catch (err) {
      return { success: false, installedPaths: [], error: err instanceof Error ? err.message : String(err) }
    }
  },

  async uninstall(plugin: StoredPlugin, targetDir: string, options?: Pick<PluginAdapterOptions, 'scope'>): Promise<PluginUninstallResult> {
    assertAdapterContext('claudeAdapter.uninstall')
    const scope = options?.scope || 'local'
    const pluginKey = buildPluginKey(plugin.name, plugin.sourcePlugin)

    try {
      if (scope === 'user') {
        await execFileAsync('claude', ['plugin', 'uninstall', pluginKey, '--scope', 'user'], { timeout: 30000 })
      } else {
        // Same as install: cwd is a SPAWN option, not an argument. See the
        // comment there for why the old `--cwd` form failed open (exit 0).
        // `-y` because --prune's confirmation prompt is required when stdout
        // is not a TTY, which it never is here.
        const resolved = resolveDir(targetDir)
        await execFileAsync('claude', [
          'plugin', 'uninstall', pluginKey,
          '--scope', 'local', '-y'
        ], { timeout: 30000, cwd: resolved })
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async enable(plugin: StoredPlugin, targetDir: string): Promise<PluginActionResult> {
    assertAdapterContext('claudeAdapter.enable')
    const pluginKey = buildPluginKey(plugin.name, plugin.sourcePlugin)
    const resolved = resolveDir(targetDir)
    const localSettings = join(resolved, '.claude', 'settings.local.json')

    try {
      // LIB2-MAJ-04: read-modify-write sequence MUST be serialized; otherwise
      // two parallel enable/disable callers race-clobber the JSON file.
      return await withLock(settingsLockKey(localSettings), async () => {
        await mkdir(join(resolved, '.claude'), { recursive: true })
        const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
        const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
        ep[pluginKey] = true
        settings.enabledPlugins = ep
        await saveJsonSafe(localSettings, settings)
        return { success: true } as PluginActionResult
      })
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async disable(plugin: StoredPlugin, targetDir: string): Promise<PluginActionResult> {
    assertAdapterContext('claudeAdapter.disable')
    const pluginKey = buildPluginKey(plugin.name, plugin.sourcePlugin)
    const resolved = resolveDir(targetDir)
    const localSettings = join(resolved, '.claude', 'settings.local.json')

    try {
      // LIB2-MAJ-04: see enable() — same locking + atomic-write requirement.
      return await withLock(settingsLockKey(localSettings), async () => {
        await mkdir(join(resolved, '.claude'), { recursive: true })
        const settings = await loadJsonSafe(localSettings) as Record<string, Record<string, unknown>>
        const ep = (settings.enabledPlugins || {}) as Record<string, boolean>
        ep[pluginKey] = false
        settings.enabledPlugins = ep
        await saveJsonSafe(localSettings, settings)
        return { success: true } as PluginActionResult
      })
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async detectState(pluginName: string, targetDir: string, options?: Pick<PluginAdapterOptions, 'scope' | 'marketplace'>): Promise<PluginInstallState> {
    // detectState is read-only — kept exempt from the AIO guard so UI
    // status panels and CheckPluginUpdates can read installed/enabled
    // flags without entering an inAdapterContext frame. Mutations
    // (install/uninstall/enable/disable) remain guarded.
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
