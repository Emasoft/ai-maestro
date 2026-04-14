/**
 * Codex Plugin Adapter — Native plugin support for OpenAI Codex.
 *
 * Codex plugin files live directly INSIDE the agent's working directory:
 *   <agentDir>/.codex-plugin/plugin.json       (manifest)
 *   <agentDir>/.agents/skills/<name>/SKILL.md  (skill content)
 *   <agentDir>/.codex/installed-plugins/<name>.json  (install manifest — for clean uninstall)
 *
 * The adapter delegates the file copy + tracking-manifest work to the element
 * adapter and passes the agent directory as the target. Do NOT install to
 * `~/.codex/plugins/cache/` — that is the user-global codex cache which is
 * unrelated to ai-maestro agent-local plugin installs and causes R18.1 /
 * scanAgentLocalConfig to miss the install.
 *
 * Previously this adapter wrote to ~/.codex/plugins/cache/ai-maestro-converted/
 * (ignoring targetDir), which on ChangeClient claude→codex left the agent's
 * .claude/ dir empty and scanAgentLocalConfig returned zero plugins.
 * Fixed in SCEN-016 debugging session.
 */

import { rm } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { homedir } from 'os'
import type {
  ClientPluginAdapter, StoredPlugin, PluginAdapterOptions,
  PluginInstallResult, PluginUninstallResult, PluginActionResult, PluginInstallState
} from './types'

const HOME = homedir()

function resolveAgentDir(targetDir: string): string {
  return targetDir.startsWith('~') ? targetDir.replace('~', HOME) : targetDir
}

const codexAdapter: ClientPluginAdapter = {
  clientType: 'codex',
  supportsEnableDisable: false,

  async install(plugin: StoredPlugin, targetDir: string, options?: PluginAdapterOptions): Promise<PluginInstallResult> {
    const storageDir = plugin.storageDir
    if (!existsSync(storageDir)) {
      return { success: false, installedPaths: [], error: `Stored plugin not found: ${storageDir}` }
    }

    // Delegate to the element adapter. `targetDir` IS the agent working directory.
    // The element adapter will recursively copy plugin files into targetDir and
    // write a tracking manifest at targetDir/.codex/installed-plugins/<name>.json.
    const { createElementAdapter } = await import('./element-adapter')
    const elementAdapter = createElementAdapter('codex')
    const result = await elementAdapter.install(
      { ...plugin, storageDir },
      targetDir,
      options
    )
    if (!result.success) return result
    return { success: true, installedPaths: result.installedPaths }
  },

  async uninstall(plugin: StoredPlugin, targetDir: string, options?: PluginAdapterOptions): Promise<PluginUninstallResult> {
    // Prefer the element adapter's manifest-driven uninstall — it knows exactly
    // which files were installed and cleans them up. Fall back to bulk removal
    // if the manifest is missing (e.g. legacy install from the pre-fix adapter).
    const { createElementAdapter } = await import('./element-adapter')
    const elementAdapter = createElementAdapter('codex')
    const elementResult = await elementAdapter.uninstall(plugin, targetDir, options)
    if (elementResult.success) return elementResult

    // Legacy cleanup: pre-fix installs lived in ~/.codex/plugins/cache/ai-maestro-converted/
    const legacyDir = path.join(HOME, '.codex', 'plugins', 'cache', 'ai-maestro-converted', plugin.name)
    if (existsSync(legacyDir)) {
      try { await rm(legacyDir, { recursive: true }) } catch { /* best effort */ }
    }

    // And wipe any partial .codex-plugin / .agents / .codex dirs that the
    // element adapter couldn't clean up due to the missing manifest.
    const agentDir = resolveAgentDir(targetDir)
    const candidates = ['.codex-plugin', '.agents', '.codex/installed-plugins']
    for (const rel of candidates) {
      const abs = path.join(agentDir, rel)
      if (existsSync(abs)) {
        try { await rm(abs, { recursive: true }) } catch { /* best effort */ }
      }
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

  async detectState(pluginName: string, targetDir: string): Promise<PluginInstallState> {
    // Prefer the element adapter's manifest-driven detection.
    const { createElementAdapter } = await import('./element-adapter')
    const elementAdapter = createElementAdapter('codex')
    return elementAdapter.detectState(pluginName, targetDir)
  },
}

export default codexAdapter
