/**
 * AMP Inbox Writer - Per-Agent Message Storage
 *
 * Writes messages in AMP envelope format to per-agent directories:
 *   ~/.agent-messaging/agents/<uuid>/messages/inbox/
 *   ~/.agent-messaging/agents/<uuid>/messages/sent/
 *
 * Agent directories are keyed by UUID for stability across renames.
 * A name→UUID index file provides lookup without symlinks:
 *   ~/.agent-messaging/agents/.index.json
 *
 * Each agent has its own AMP directory, which matches the AMP_DIR
 * environment variable set in their tmux session. This allows
 * amp-inbox.sh and other AMP scripts to work correctly per-agent.
 */

import { promises as fs } from 'fs'
import * as fsSync from 'fs'
import path from 'path'
import os from 'os'
import { statePath } from '@/lib/ecosystem-constants'
import type { AMPEnvelope, AMPPayload } from '@/lib/types/amp'
import { withLock } from '@/lib/file-lock'

const AMP_DIR = path.join(os.homedir(), '.agent-messaging')
const AMP_AGENTS_DIR = path.join(AMP_DIR, 'agents')
const AMP_INDEX_FILE = path.join(AMP_AGENTS_DIR, '.index.json')

// ============================================================================
// Name → UUID Index
// ============================================================================

/**
 * Read the name→UUID index from disk.
 */
function readIndex(): Record<string, string> {
  try {
    return JSON.parse(fsSync.readFileSync(AMP_INDEX_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

/**
 * Write the name→UUID index to disk atomically (write tmp + rename).
 */
function writeIndex(index: Record<string, string>): void {
  try {
    fsSync.mkdirSync(AMP_AGENTS_DIR, { recursive: true })
    const tmpFile = AMP_INDEX_FILE + '.tmp'
    fsSync.writeFileSync(tmpFile, JSON.stringify(index, null, 2))
    fsSync.renameSync(tmpFile, AMP_INDEX_FILE)
  } catch (error) {
    console.error('[AMP Index] Failed to write index:', error)
  }
}

/**
 * Update a single entry in the name→UUID index.
 * Serialized via withLock to prevent TOCTOU races on read-modify-write.
 */
export async function updateIndex(agentName: string, agentId: string): Promise<void> {
  await withLock('amp-index', () => {
    const index = readIndex()
    index[agentName] = agentId
    writeIndex(index)
  })
}

/**
 * Remove an entry from the name→UUID index.
 * Serialized via withLock to prevent TOCTOU races on read-modify-write.
 */
export async function removeFromIndex(agentName: string): Promise<void> {
  await withLock('amp-index', () => {
    const index = readIndex()
    delete index[agentName]
    writeIndex(index)
  })
}

/**
 * Rename an entry in the name→UUID index.
 * Serialized via withLock to prevent TOCTOU races on read-modify-write.
 */
export async function renameInIndex(oldName: string, newName: string, agentId: string): Promise<void> {
  await withLock('amp-index', () => {
    const index = readIndex()
    delete index[oldName]
    index[newName] = agentId
    writeIndex(index)
  })
}

/**
 * Look up a UUID from a name via the index.
 */
function lookupUUID(agentName: string): string | undefined {
  const index = readIndex()
  return index[agentName]
}

// ============================================================================
// Directory Resolution
// ============================================================================

/**
 * Get the AMP home directory for a specific agent by UUID.
 */
function getAgentAMPHomeById(agentId: string): string {
  return path.join(AMP_AGENTS_DIR, agentId)
}

/**
 * Resolve the canonical AMP home for an agent.
 * ALWAYS uses UUID. Never falls back to agent name.
 */
function resolveAgentAMPHome(agentName: string, agentId?: string): string {
  // 1. UUID provided directly
  if (agentId) {
    return getAgentAMPHomeById(agentId)
  }
  // 2. Look up UUID from index
  const indexedId = lookupUUID(agentName)
  if (indexedId) {
    return getAgentAMPHomeById(indexedId)
  }
  // 3. Last resort: look up UUID from agent registry
  const { getAgentByName, getAgentByAlias } = require('@/lib/agent-registry')
  const agent = getAgentByName(agentName) || getAgentByAlias(agentName)
  if (agent?.id) {
    return getAgentAMPHomeById(agent.id)
  }
  // No UUID found - try one more approach: look up by name on any host
  const { getAgentByNameAnyHost } = require('@/lib/agent-registry')
  const anyHostAgent = getAgentByNameAnyHost(agentName)
  if (anyHostAgent?.id) {
    return getAgentAMPHomeById(anyHostAgent.id)
  }
  // Absolutely no UUID found - reject instead of creating orphaned directories
  throw new Error(`[AMP Inbox Writer] No UUID found for agent "${agentName}" - cannot create directory without UUID`)
}

/**
 * Sanitize an address for use as a directory name.
 * Matches the logic in amp-helper.sh: sanitize_address_for_path()
 */
function sanitizeAddressForPath(address: string): string {
  return address.replace(/[@.]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
}

/**
 * Extract agent name from an AMP address.
 * e.g., "backend-architect@rnd23blocks.aimaestro.local" -> "backend-architect"
 */
function extractAgentName(address: string): string {
  const atIndex = address.indexOf('@')
  if (atIndex === -1) return address
  return address.substring(0, atIndex)
}

// ============================================================================
// Auto-Migration
// ============================================================================

/**
 * Auto-migrate a legacy name-keyed directory to UUID-keyed.
 * If a name dir exists and UUID dir doesn't, rename it.
 * No symlinks — just updates the index.
 */
async function autoMigrateToUUID(agentName: string, agentId: string): Promise<boolean> {
  const nameDir = path.join(AMP_AGENTS_DIR, agentName)
  const uuidDir = path.join(AMP_AGENTS_DIR, agentId)

  try {
    // Only migrate if: name dir exists as real dir, UUID dir doesn't exist
    if (!fsSync.existsSync(nameDir) || fsSync.existsSync(uuidDir)) {
      return false
    }
    // Don't migrate if nameDir is actually a UUID already
    if (nameDir === uuidDir) return false

    // Rename name dir → uuid dir
    await fs.rename(nameDir, uuidDir)

    // Update config.json with agent.id
    const configPath = path.join(uuidDir, 'config.json')
    try {
      const configData = JSON.parse(await fs.readFile(configPath, 'utf-8'))
      configData.agent = configData.agent || {}
      configData.agent.id = agentId
      await fs.writeFile(configPath, JSON.stringify(configData, null, 2))
    } catch {
      // Best-effort
    }

    // Update the index
    await updateIndex(agentName, agentId)

    console.log(`[AMP Inbox Writer] Auto-migrated ${agentName} -> ${agentId}`)
    return true
  } catch (error) {
    console.error(`[AMP Inbox Writer] Auto-migration failed for ${agentName}:`, error)
    return false
  }
}

// ============================================================================
// Init
// ============================================================================

/**
 * Initialize the per-agent AMP directory structure.
 * Creates dirs and copies config/keys from the machine-level AMP dir if available.
 *
 * When agentId is provided, uses UUID-keyed directory.
 * Auto-migrates legacy name-keyed directories to UUID on first access.
 *
 * Directory structure:
 *   ~/.agent-messaging/agents/<uuid>/
 *     config.json      (includes agent.id field)
 *     keys/
 *     messages/inbox/
 *     messages/sent/
 *     registrations/
 *   ~/.agent-messaging/agents/.index.json   (name→UUID lookup)
 */
export async function initAgentAMPHome(agentName: string, agentId?: string): Promise<string> {
  // If agentId provided, try auto-migration first
  if (agentId) {
    await autoMigrateToUUID(agentName, agentId)
  }

  // Resolve the canonical home - ALWAYS use UUID, never name
  const agentHome = resolveAgentAMPHome(agentName, agentId)
  const agentInbox = path.join(agentHome, 'messages', 'inbox')
  const agentSent = path.join(agentHome, 'messages', 'sent')
  const agentKeys = path.join(agentHome, 'keys')
  const agentRegs = path.join(agentHome, 'registrations')

  // Create directory structure
  await fs.mkdir(agentInbox, { recursive: true })
  await fs.mkdir(agentSent, { recursive: true })
  await fs.mkdir(agentKeys, { recursive: true })
  await fs.mkdir(agentRegs, { recursive: true })

  // Copy machine-level config if agent doesn't have one yet
  const agentConfig = path.join(agentHome, 'config.json')
  try {
    await fs.access(agentConfig)
    // Config exists — ensure agent.id is set if we have it
    if (agentId) {
      try {
        const existingConfig = JSON.parse(await fs.readFile(agentConfig, 'utf-8'))
        if (!existingConfig.agent?.id) {
          existingConfig.agent = existingConfig.agent || {}
          existingConfig.agent.id = agentId
          await fs.writeFile(agentConfig, JSON.stringify(existingConfig, null, 2))
        }
      } catch {
        // Best-effort
      }
    }
  } catch {
    // Agent config doesn't exist — create from machine config or defaults
    const machineConfig = path.join(AMP_DIR, 'config.json')
    try {
      const configData = JSON.parse(await fs.readFile(machineConfig, 'utf-8'))
      configData.agent = configData.agent || {}
      configData.agent.name = agentName
      if (agentId) configData.agent.id = agentId
      await fs.writeFile(agentConfig, JSON.stringify(configData, null, 2))
    } catch {
      const minimalConfig: Record<string, unknown> = {
        version: 'amp/0.1',
        agent: { name: agentName, ...(agentId ? { id: agentId } : {}) },
        created_at: new Date().toISOString()
      }
      await fs.writeFile(agentConfig, JSON.stringify(minimalConfig, null, 2))
    }
  }

  // Copy machine-level keys if agent doesn't have them yet
  let hasKeys = false
  try {
    await fs.access(path.join(agentKeys, 'private.pem'))
    hasKeys = true
  } catch {
    // Try machine-level keys first
    const machineKeys = path.join(AMP_DIR, 'keys')
    try {
      const privateKey = await fs.readFile(path.join(machineKeys, 'private.pem'))
      const publicKey = await fs.readFile(path.join(machineKeys, 'public.pem'))
      await fs.writeFile(path.join(agentKeys, 'private.pem'), privateKey, { mode: 0o600 })
      await fs.writeFile(path.join(agentKeys, 'public.pem'), publicKey, { mode: 0o644 })
      hasKeys = true
    } catch {
      // No machine keys — try server-side keys from ~/.aimaestro/agents/{id}/keys/
      if (agentId) {
        const serverKeysDir = statePath('agents', agentId, 'keys')
        try {
          const privateKey = await fs.readFile(path.join(serverKeysDir, 'private.pem'))
          const publicKey = await fs.readFile(path.join(serverKeysDir, 'public.pem'))
          await fs.writeFile(path.join(agentKeys, 'private.pem'), privateKey, { mode: 0o600 })
          await fs.writeFile(path.join(agentKeys, 'public.pem'), publicKey, { mode: 0o644 })
          hasKeys = true
          console.log(`[AMP Inbox Writer] Copied server-side keys for agent ${agentName}`)
        } catch {
          // No server-side keys either
        }
      }
    }

    // BUG-004 fix: If no keys exist anywhere, generate fresh Ed25519 keys.
    // Without keys, amp-send.sh fails with "AMP not initialized" and agents
    // cannot participate in inter-agent messaging.
    if (!hasKeys) {
      try {
        const { generateKeyPairSync } = await import('crypto')
        const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        })
        await fs.writeFile(path.join(agentKeys, 'private.pem'), privateKey, { mode: 0o600 })
        await fs.writeFile(path.join(agentKeys, 'public.pem'), publicKey, { mode: 0o644 })
        hasKeys = true
        console.log(`[AMP Inbox Writer] Generated fresh Ed25519 keys for agent ${agentName}`)

        // Also save to server-side storage so amp-keys.ts can find them
        if (agentId) {
          const serverKeysDir = statePath('agents', agentId, 'keys')
          try {
            await fs.mkdir(serverKeysDir, { recursive: true })
            await fs.writeFile(path.join(serverKeysDir, 'private.pem'), privateKey, { mode: 0o600 })
            await fs.writeFile(path.join(serverKeysDir, 'public.pem'), publicKey, { mode: 0o644 })
          } catch {
            // Non-fatal: server-side keys are optional for CLI-side messaging
          }
        }
      } catch (keyGenErr) {
        console.warn(`[AMP Inbox Writer] Failed to generate keys for ${agentName}:`, keyGenErr)
      }
    }
  }

  // BUG-004 fix: Ensure config.json has address, fingerprint, and tenant.
  // Without these fields, amp-send.sh cannot construct sender addresses or
  // sign messages, causing 403 errors on inter-agent messaging.
  if (hasKeys) {
    try {
      const configStr = await fs.readFile(agentConfig, 'utf-8')
      const config = JSON.parse(configStr)
      const agentSection = config.agent || {}
      const needsUpdate = !agentSection.address || !agentSection.fingerprint || !agentSection.tenant

      if (needsUpdate) {
        // Compute fingerprint from public key
        const { createHash, createPublicKey } = await import('crypto')
        const pubPem = await fs.readFile(path.join(agentKeys, 'public.pem'), 'utf-8')
        const pubKeyObj = createPublicKey(pubPem)
        const derBuf = pubKeyObj.export({ type: 'spki', format: 'der' })
        const fingerprint = 'SHA256:' + createHash('sha256').update(derBuf).digest('base64')

        // Resolve tenant from hosts config or fallback to 'default'
        let tenant = agentSection.tenant || 'default'
        try {
          const { getOrganization } = require('@/lib/hosts-config')
          const org = getOrganization()
          if (org) tenant = org
        } catch {
          // hosts-config not available — use default
        }

        // Build address: <name>@<tenant>.aimaestro.local
        const address = `${agentName}@${tenant}.aimaestro.local`

        config.agent = {
          ...agentSection,
          name: agentName,
          tenant,
          address,
          fingerprint,
          ...(agentId ? { id: agentId } : {}),
          createdAt: agentSection.createdAt || new Date().toISOString(),
        }
        config.version = config.version || '1.1'
        config.provider = config.provider || {
          domain: 'aimaestro.local',
          maestro_url: 'http://localhost:23000',
        }

        await fs.writeFile(agentConfig, JSON.stringify(config, null, 2))
        console.log(`[AMP Inbox Writer] Updated config for ${agentName}: address=${address}`)
      }
    } catch (configErr) {
      console.warn(`[AMP Inbox Writer] Failed to update config for ${agentName}:`, configErr)
    }
  }

  // NOTE: Machine-level registrations are NOT copied to agents.
  // Each agent gets its own registration via /api/v1/register with its own API key.
  // Copying machine-level keys caused identity contamination (wrong sender addresses).

  // Update the name→UUID index
  if (agentId) {
    await updateIndex(agentName, agentId)
  }

  return agentHome
}

// ============================================================================
// Inbox / Sent Writers
// ============================================================================

/**
 * Write a message to a specific agent's AMP inbox in envelope format.
 * Prefers UUID-based directory when recipientAgentId is provided.
 */
export async function writeToAMPInbox(
  envelope: AMPEnvelope,
  payload: AMPPayload,
  recipientAgent?: string,
  senderPublicKey?: string,
  recipientAgentId?: string
): Promise<string | null> {
  try {
    const agentName = recipientAgent || extractAgentName(envelope.to)
    if (!agentName) {
      console.error('[AMP Inbox Writer] Cannot determine recipient agent name')
      return null
    }

    // BUG-015-01 fix: ensure the per-agent AMP home is migrated/initialized
    // before writing the inbox file. Without this, when the CLI creates the
    // name-keyed dir first (via G12 amp-init.sh) and the server later receives
    // a message for that agent by UUID, `resolveAgentAMPHome(name, uuid)` would
    // return an empty UUID-keyed path and silently create a fresh (incorrect)
    // inbox there, so messages never reach the CLI's view of the inbox.
    // `initAgentAMPHome` runs `autoMigrateToUUID` which renames name → UUID.
    await initAgentAMPHome(agentName, recipientAgentId)

    const agentHome = resolveAgentAMPHome(agentName, recipientAgentId)
    const agentInboxDir = path.join(agentHome, 'messages', 'inbox')
    const senderDir = sanitizeAddressForPath(envelope.from)
    const inboxSenderDir = path.join(agentInboxDir, senderDir)

    await fs.mkdir(inboxSenderDir, { recursive: true })

    // BUG-015-02 fix: preserve the attachments array on the payload so the
    // recipient sees the same metadata the sender stamped. The previous code
    // dropped .attachments silently, so `amp-download.sh` saw zero attachments.
    const payloadWithAttachments = payload as AMPPayload & {
      attachments?: Array<Record<string, unknown>>
    }
    const attachments = Array.isArray(payloadWithAttachments.attachments)
      ? payloadWithAttachments.attachments
      : []

    const ampMessage = {
      envelope: {
        version: envelope.version || 'amp/0.1',
        id: envelope.id,
        from: envelope.from,
        to: envelope.to,
        subject: envelope.subject,
        priority: envelope.priority || 'normal',
        timestamp: envelope.timestamp,
        thread_id: envelope.thread_id || envelope.in_reply_to || envelope.id,
        in_reply_to: envelope.in_reply_to || null,
        expires_at: envelope.expires_at || null,
        signature: envelope.signature || null
      },
      payload: {
        type: payload.type,
        message: payload.message,
        context: payload.context || null,
        ...(attachments.length > 0 ? { attachments } : {})
      },
      metadata: {
        status: 'unread',
        queued_at: envelope.timestamp,
        delivery_attempts: 1
      },
      local: {
        received_at: new Date().toISOString(),
        delivery_method: 'local',
        status: 'unread'
      },
      ...(senderPublicKey ? { sender_public_key: senderPublicKey } : {})
    }

    const filePath = path.join(inboxSenderDir, `${envelope.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(ampMessage, null, 2))

    // BUG-015-02 fix: copy attachment blobs from the sender's attachments dir
    // to the recipient's attachments dir. Without this, the recipient has the
    // metadata but no file, and `amp-download.sh` silently fails with
    // "No download URL or API credentials available" (spec-wise it falls
    // through to the HTTP path which 404s because we don't implement the
    // `/api/v1/attachments/*` routes).
    //
    // Only runs for local delivery with attachments that have no external
    // URL — URL-backed attachments are downloaded on demand, not copied.
    if (attachments.length > 0) {
      const senderName = extractAgentName(envelope.from)
      if (senderName) {
        try {
          const senderHome = resolveAgentAMPHome(senderName)
          const senderAttachmentsDir = path.join(senderHome, 'attachments')
          const recipientAttachmentsDir = path.join(agentHome, 'attachments')
          await fs.mkdir(recipientAttachmentsDir, { recursive: true })
          for (const att of attachments) {
            const attId = typeof att.id === 'string' ? att.id : ''
            const filename = typeof att.filename === 'string' ? att.filename : ''
            const hasUrl = typeof att.url === 'string' && att.url.length > 0
            if (!attId || !filename || hasUrl) continue
            const srcDir = path.join(senderAttachmentsDir, attId)
            const srcFile = path.join(srcDir, filename)
            const dstDir = path.join(recipientAttachmentsDir, attId)
            const dstFile = path.join(dstDir, filename)
            try {
              await fs.access(srcFile)
            } catch {
              console.warn(`[AMP Inbox Writer] Attachment source missing: ${srcFile}`)
              continue
            }
            await fs.mkdir(dstDir, { recursive: true })
            await fs.copyFile(srcFile, dstFile)
            await fs.chmod(dstFile, 0o600)
          }
        } catch (attErr) {
          console.warn(`[AMP Inbox Writer] Attachment copy failed for ${envelope.id}:`, attErr)
        }
      }
    }

    console.log(`[AMP Inbox Writer] Wrote ${envelope.id} to ${agentName}'s inbox`)
    return filePath
  } catch (error) {
    console.error(`[AMP Inbox Writer] Failed to write to AMP inbox:`, error)
    return null
  }
}

/**
 * Write a message to a specific agent's AMP sent folder.
 */
export async function writeToAMPSent(
  envelope: AMPEnvelope,
  payload: AMPPayload,
  senderAgent?: string,
  senderAgentId?: string
): Promise<string | null> {
  try {
    const agentName = senderAgent || extractAgentName(envelope.from)
    if (!agentName) {
      console.error('[AMP Inbox Writer] Cannot determine sender agent name')
      return null
    }

    // BUG-015-01 fix: same auto-migration as writeToAMPInbox — ensure the
    // UUID-keyed home is materialized from the name-keyed one when needed.
    await initAgentAMPHome(agentName, senderAgentId)

    const agentHome = resolveAgentAMPHome(agentName, senderAgentId)
    const agentSentDir = path.join(agentHome, 'messages', 'sent')
    const recipientDir = sanitizeAddressForPath(envelope.to)
    const sentRecipientDir = path.join(agentSentDir, recipientDir)

    await fs.mkdir(sentRecipientDir, { recursive: true })

    // BUG-015-02 fix: preserve attachments on the sent copy as well.
    const payloadWithAttachmentsSent = payload as AMPPayload & {
      attachments?: Array<Record<string, unknown>>
    }
    const attachmentsSent = Array.isArray(payloadWithAttachmentsSent.attachments)
      ? payloadWithAttachmentsSent.attachments
      : []

    const ampMessage = {
      envelope: {
        version: envelope.version || 'amp/0.1',
        id: envelope.id,
        from: envelope.from,
        to: envelope.to,
        subject: envelope.subject,
        priority: envelope.priority || 'normal',
        timestamp: envelope.timestamp,
        thread_id: envelope.thread_id || envelope.in_reply_to || envelope.id,
        in_reply_to: envelope.in_reply_to || null,
        expires_at: envelope.expires_at || null,
        signature: envelope.signature || null
      },
      payload: {
        type: payload.type,
        message: payload.message,
        context: payload.context || null,
        ...(attachmentsSent.length > 0 ? { attachments: attachmentsSent } : {})
      },
      local: {
        sent_at: new Date().toISOString()
      }
    }

    const filePath = path.join(sentRecipientDir, `${envelope.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(ampMessage, null, 2))

    return filePath
  } catch (error) {
    console.error(`[AMP Inbox Writer] Failed to write to AMP sent:`, error)
    return null
  }
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Check if AMP is initialized on this machine.
 */
export async function isAMPInitialized(): Promise<boolean> {
  try {
    await fs.access(path.join(AMP_DIR, 'config.json'))
    return true
  } catch {
    try {
      await fs.access(AMP_AGENTS_DIR)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Get the AMP_DIR path for an agent's tmux session environment.
 * When agentId is provided, returns the UUID-based path (stable across renames).
 */
export function getAgentAMPDir(agentName: string, agentId?: string): string {
  // ALWAYS resolve to UUID - never return name-based path
  return resolveAgentAMPHome(agentName, agentId)
}
