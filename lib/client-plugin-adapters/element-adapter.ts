/**
 * Element Adapter — Plugin simulation for clients without native plugin support.
 *
 * For Gemini, OpenCode, Kiro (and Codex as fallback): installs each element
 * individually into the client's native locations and tracks installed paths
 * in a per-agent manifest for clean uninstall.
 *
 * Tracking manifest: <agentDir>/.<client>/installed-plugins/<plugin-name>.json
 */

import { mkdir, writeFile, readFile, unlink, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { homedir } from 'os'
import type { ClientType } from '@/lib/client-capabilities'
import { clientTypeToProviderId } from '@/lib/client-capabilities'
import type {
  ClientPluginAdapter, StoredPlugin, PluginAdapterOptions,
  PluginInstallResult, PluginUninstallResult, PluginActionResult, PluginInstallState
} from './types'

/** Tracking manifest stored per-agent for clean uninstall */
interface InstalledPluginManifest {
  name: string
  clientType: string
  installedAt: string
  paths: string[]       // relative to targetDir
  sourcePlugin?: string
  version?: string
}

function resolveDir(dir: string): string {
  return dir.startsWith('~') ? dir.replace('~', homedir()) : dir
}

function manifestDir(targetDir: string, clientType: string): string {
  return path.join(resolveDir(targetDir), `.${clientType}`, 'installed-plugins')
}

function manifestPath(targetDir: string, clientType: string, pluginName: string): string {
  return path.join(manifestDir(targetDir, clientType), `${pluginName}.json`)
}

/**
 * Create an element-level plugin adapter for clients without native plugin support.
 */
export function createElementAdapter(clientType: ClientType): ClientPluginAdapter {
  return {
    clientType,
    supportsEnableDisable: false,

    async install(plugin: StoredPlugin, targetDir: string, _options?: PluginAdapterOptions): Promise<PluginInstallResult> {
      const providerId = clientTypeToProviderId(clientType)
      if (!providerId) {
        return { success: false, installedPaths: [], error: `No converter provider for ${clientType}` }
      }

      // Parse the stored plugin directory (it's already in the target client's format)
      // and write each file to the agent's working directory
      const resolved = resolveDir(targetDir)
      const storageDir = plugin.storageDir

      if (!existsSync(storageDir)) {
        return { success: false, installedPaths: [], error: `Stored plugin not found: ${storageDir}` }
      }

      const installedPaths: string[] = []

      // Recursively copy all files from the stored plugin dir to the target dir
      await copyDir(storageDir, resolved, '', installedPaths, 0)

      // Write tracking manifest
      const mDir = manifestDir(targetDir, clientType)
      await mkdir(mDir, { recursive: true })
      const manifest: InstalledPluginManifest = {
        name: plugin.name,
        clientType,
        installedAt: new Date().toISOString(),
        paths: installedPaths,
        sourcePlugin: plugin.sourcePlugin,
        version: plugin.version,
      }
      await writeFile(
        manifestPath(targetDir, clientType, plugin.name),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      )

      return { success: true, installedPaths }
    },

    async uninstall(plugin: StoredPlugin, targetDir: string): Promise<PluginUninstallResult> {
      const mPath = manifestPath(targetDir, clientType, plugin.name)
      if (!existsSync(mPath)) {
        return { success: false, error: `No tracking manifest found for ${plugin.name} — was it installed via element adapter?` }
      }

      const manifest: InstalledPluginManifest = JSON.parse(await readFile(mPath, 'utf-8'))
      const resolved = resolveDir(targetDir)
      const removedPaths: string[] = []

      // Delete each installed file
      for (const relPath of manifest.paths) {
        const fullPath = path.join(resolved, relPath)
        if (existsSync(fullPath)) {
          await unlink(fullPath)
          removedPaths.push(relPath)
        }
      }

      // Remove tracking manifest
      await unlink(mPath)

      return { success: true, removedPaths }
    },

    async enable(): Promise<PluginActionResult> {
      return { success: true } // No-op for clients without enable/disable
    },

    async disable(): Promise<PluginActionResult> {
      return { success: true } // No-op for clients without enable/disable
    },

    async detectState(pluginName: string, targetDir: string): Promise<PluginInstallState> {
      const mPath = manifestPath(targetDir, clientType, pluginName)
      if (!existsSync(mPath)) {
        return { installed: false, enabled: false, method: 'element-simulation' }
      }

      const manifest: InstalledPluginManifest = JSON.parse(await readFile(mPath, 'utf-8'))
      const resolved = resolveDir(targetDir)

      // Verify at least some paths still exist
      const existingPaths = manifest.paths.filter(p => existsSync(path.join(resolved, p)))
      const installed = existingPaths.length > 0

      return {
        installed,
        enabled: installed, // element-simulated plugins are always "enabled" when installed
        method: 'element-simulation',
        installedPaths: existingPaths,
        version: manifest.version,
      }
    },
  }
}

/**
 * Recursively copy files from src to dest, tracking installed paths.
 */
async function copyDir(
  src: string, dest: string, relPrefix: string,
  installedPaths: string[], depth: number
): Promise<void> {
  if (depth > 10) return // safety limit

  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue // skip hidden files/dirs

    const srcPath = path.join(src, entry.name)
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
    const destPath = path.join(dest, relPath)

    if (entry.isFile()) {
      await mkdir(path.dirname(destPath), { recursive: true })
      const content = await readFile(srcPath)
      await writeFile(destPath, content)
      installedPaths.push(relPath)
    } else if (entry.isDirectory()) {
      await copyDir(srcPath, dest, relPath, installedPaths, depth + 1)
    }
    // Skip symlinks for safety
  }
}
