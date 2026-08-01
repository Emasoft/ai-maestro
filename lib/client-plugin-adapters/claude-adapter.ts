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
// `mkdir` is deliberately NOT imported: the two sites that called it before writing
// settings.local.json now use `updateJson`, whose lock acquisition already does
// `mkdir(dirname(path), { recursive: true })` — it has to, because a fresh machine may not have
// `.claude/` yet and the lockdir could not otherwise be created.
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
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
import { loadJsonSafe, updateJson } from '@/lib/json-io'


/**
 * ⚠ RETIRED — kept only to record WHY it was not enough (TRDD-RYFP030K). Do not reintroduce it.
 *
 * LIB2-MAJ-04 serialized this module's `settings.local.json` mutations with
 * `withLock(settingsLockKey(path))`, and the intent — "the same key MUST be used by every caller
 * that mutates settings.local.json on the same agent dir" — was exactly right. The problem is that
 * every caller did NOT use it. `services/element-management-service.ts` builds the identical path
 * (`join(<agentDir>, '.claude', 'settings.local.json')`, five sites) and guards it with a
 * `mkdir`-based lock DIRECTORY at `<path>.lock`. A string key in an in-process Map and a lockdir on
 * disk share nothing, so the two modules excluded each other NOWHERE — not even inside one process.
 *
 * And `lib/file-lock.ts` is process-local by construction; its own header says it "provides NO
 * protection against PM2 cluster mode / headless + full mode / test harnesses". So the module
 * writing the file that decides which plugins an agent loads had the weakest of the three locks
 * this codebase had grown.
 *
 * Both sites now go through `updateJson`, which takes the SAME lockdir element-management-service
 * takes. That is what "one lock" has to mean: not one function each module calls, but one physical
 * object they contend for.
 */

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
      // LIB2-MAJ-04: this read-modify-write MUST be serialized, or two parallel enable/disable
      // callers race-clobber the file. It now serializes through `updateJson` — see the note on
      // `settingsLockKey` for why the old `withLock` was not enough.
      await updateJson(localSettings, s => {
        const ep = (s.enabledPlugins || {}) as Record<string, boolean>
        ep[pluginKey] = true
        s.enabledPlugins = ep
      }, { createIfMissing: true })
      return { success: true } as PluginActionResult
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
      await updateJson(localSettings, s => {
        const ep = (s.enabledPlugins || {}) as Record<string, boolean>
        ep[pluginKey] = false
        s.enabledPlugins = ep
      }, { createIfMissing: true })
      return { success: true } as PluginActionResult
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
