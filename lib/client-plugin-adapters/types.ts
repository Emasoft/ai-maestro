/**
 * Client Plugin Adapter — Abstract interface for per-client plugin operations.
 *
 * Each adapter knows how to install, uninstall, enable, disable, and detect
 * the state of a "plugin" for its specific AI coding client.
 *
 * For clients without native plugin support (Gemini, OpenCode, Kiro),
 * the adapter simulates plugins by managing individual elements.
 */

import type { ClientType } from '@/lib/client-capabilities'
import type { ProviderId } from '@/lib/converter/types'

/** Installation state of a plugin for a specific client */
export interface PluginInstallState {
  installed: boolean
  enabled: boolean
  /** How the plugin was installed */
  method: 'native-cli' | 'settings-write' | 'element-simulation'
  /** Paths of installed elements (for element-simulation tracking) */
  installedPaths?: string[]
  /** Plugin version if available */
  version?: string
}

/** A plugin stored in ~/agents/custom-plugins/<client>/<name>/ */
export interface StoredPlugin {
  /** Plugin name (kebab-case) */
  name: string
  /** Target client type */
  clientType: ClientType
  /** Absolute path to storage directory */
  storageDir: string
  /** Converter provider ID for this client */
  providerId: ProviderId
  /** Original source plugin name (if converted from another format) */
  sourcePlugin?: string
  /** Original source client type */
  sourceClient?: ClientType
  /** Plugin version */
  version?: string
}

/** Options for install/uninstall operations */
export interface PluginAdapterOptions {
  /** Installation scope */
  scope: 'user' | 'local'
  /** Marketplace name (for native CLI installs) */
  marketplace?: string
  /** Force overwrite existing */
  force?: boolean
}

/** Result of an install operation */
export interface PluginInstallResult {
  success: boolean
  /** Paths of files written (for tracking/uninstall) */
  installedPaths: string[]
  error?: string
}

/** Result of an uninstall operation */
export interface PluginUninstallResult {
  success: boolean
  /** Paths of files removed */
  removedPaths?: string[]
  error?: string
}

/** Simple success/error result */
export interface PluginActionResult {
  success: boolean
  error?: string
}

/**
 * Abstract adapter interface for per-client plugin operations.
 *
 * Implementations:
 * - claude-adapter: Delegates to `claude plugin` CLI + settings.json
 * - codex-adapter: Uses Codex plugin system + config.toml
 * - element-adapter: Simulates plugins by installing individual elements
 */
export interface ClientPluginAdapter {
  /** Which client this adapter handles */
  clientType: ClientType

  /** Whether this client supports enable/disable (vs only install/uninstall) */
  supportsEnableDisable: boolean

  /** Install a plugin's elements into the client's config locations */
  install(
    plugin: StoredPlugin,
    targetDir: string,
    options?: PluginAdapterOptions
  ): Promise<PluginInstallResult>

  /** Uninstall/remove a plugin's elements */
  uninstall(
    plugin: StoredPlugin,
    targetDir: string,
    options?: Pick<PluginAdapterOptions, 'scope'>
  ): Promise<PluginUninstallResult>

  /** Enable a disabled plugin (no-op if not supported) */
  enable(
    plugin: StoredPlugin,
    targetDir: string
  ): Promise<PluginActionResult>

  /** Disable a plugin without removing (no-op if not supported) */
  disable(
    plugin: StoredPlugin,
    targetDir: string
  ): Promise<PluginActionResult>

  /** Detect current installation state */
  detectState(
    pluginName: string,
    targetDir: string,
    options?: Pick<PluginAdapterOptions, 'scope' | 'marketplace'>
  ): Promise<PluginInstallState>
}
