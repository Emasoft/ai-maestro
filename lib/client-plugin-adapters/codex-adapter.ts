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

// LIB2-CRIT-03 fix (2026-05-06) — defence-in-depth helpers for the
// uninstall-fallback `rm -rf` paths. Two attack surfaces existed
// previously:
//   (a) `plugin.name` was interpolated into a `path.join` and then
//       `rm({recursive:true})`. `path.join` does NOT block `..`
//       segments — a `plugin.name` of `"../../etc"` resolved outside
//       the intended legacy directory and the `rm` deleted whatever
//       was there.
//   (b) `agentDir` was assumed to live under `~/agents/<name>/` per
//       the Rule-0 invariant, but no check enforced it. Stale legacy
//       `_aim-*` agents whose workdir is `~/ai-maestro/` (registry
//       drift) would have had `.codex-plugin`, `.agents`, etc.
//       wiped from the source tree.
// The two helpers below clamp those inputs:
//   - `safePluginName` rejects anything outside [A-Za-z0-9._-] and any
//     literal `..` segment.
//   - `safeAgentDir` requires the resolved path to live strictly under
//     `~/agents/`. Anything else (the project source, the user's
//     home, the codex cache) is refused.
const SAFE_PLUGIN_NAME_RE = /^[a-zA-Z0-9._-]+$/

function isSafePluginName(name: string): boolean {
  if (!name) return false
  if (!SAFE_PLUGIN_NAME_RE.test(name)) return false
  if (name === '.' || name === '..') return false
  if (name.includes('/') || name.includes('\\')) return false
  return true
}

function isAgentDirInsideAgentsRoot(absPath: string): boolean {
  const root = path.resolve(HOME, 'agents') + path.sep
  return path.resolve(absPath).startsWith(root)
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

    // LIB2-CRIT-03 (2026-05-06) — `plugin.name` is untrusted user input.
    // Refuse anything outside the safe-id regex BEFORE building the
    // legacyDir path. Without this guard, `plugin.name = "../../etc"`
    // would resolve outside the intended cache and the `rm` would
    // delete an arbitrary subtree.
    if (!isSafePluginName(plugin.name)) {
      console.warn(`[codex-adapter] Refusing legacy cleanup: unsafe plugin name "${plugin.name}"`)
    } else {
      const legacyDir = path.join(HOME, '.codex', 'plugins', 'cache', 'ai-maestro-converted', plugin.name)
      // Belt-and-braces: even after the regex check, verify the
      // resolved legacyDir is still under the legacy cache root.
      const legacyRoot = path.resolve(HOME, '.codex', 'plugins', 'cache', 'ai-maestro-converted') + path.sep
      const resolvedLegacy = path.resolve(legacyDir) + path.sep
      if (!resolvedLegacy.startsWith(legacyRoot)) {
        console.warn(`[codex-adapter] Refusing legacy cleanup: resolved path escapes cache root: ${legacyDir}`)
      } else if (existsSync(legacyDir)) {
        try { await rm(legacyDir, { recursive: true }) } catch { /* best effort */ }
      }
    }

    // LIB2-CRIT-03 (2026-05-06) — `agentDir` is untrusted relative to
    // Rule-0. Per CLAUDE.md every agent dir MUST live under ~/agents/<name>/.
    // Refuse the bulk-cleanup if it doesn't, so a stale `_aim-*` registry
    // entry pointing at `~/ai-maestro/` cannot have its `.codex-plugin`
    // / `.agents` folders wiped from the project source tree.
    const agentDir = resolveAgentDir(targetDir)
    if (!isAgentDirInsideAgentsRoot(agentDir)) {
      console.warn(`[codex-adapter] Refusing bulk uninstall: agentDir "${agentDir}" is not under ~/agents/`)
      return { success: true }
    }
    const candidates = ['.codex-plugin', '.agents', '.codex/installed-plugins']
    for (const rel of candidates) {
      const abs = path.join(agentDir, rel)
      // Final defence: re-resolve and confirm the abs path is still
      // inside agentDir (path.join could in theory be subverted by a
      // user-controlled `targetDir` containing `..` segments).
      const insideAgentDir = path.resolve(abs).startsWith(path.resolve(agentDir) + path.sep)
      if (!insideAgentDir) continue
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
