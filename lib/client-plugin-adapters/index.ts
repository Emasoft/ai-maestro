/**
 * Client Plugin Adapter Registry
 *
 * Dispatches to the appropriate adapter based on client type.
 * Uses dynamic imports to avoid loading all adapter code upfront.
 */

import type { ClientType } from '@/lib/client-capabilities'
import type { ClientPluginAdapter } from './types'

/**
 * Get the plugin adapter for a given client type.
 * Returns null for unsupported clients (aider, unknown).
 */
export async function getAdapter(clientType: ClientType): Promise<ClientPluginAdapter | null> {
  switch (clientType) {
    case 'claude':
      return (await import('./claude-adapter')).default

    case 'codex':
      return (await import('./codex-adapter')).default

    case 'gemini':
    case 'opencode':
    case 'kiro':
      return (await import('./element-adapter')).createElementAdapter(clientType)

    default:
      return null
  }
}
