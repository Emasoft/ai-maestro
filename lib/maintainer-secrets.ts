/**
 * MAINTAINER webhook secret storage (R19.6).
 *
 * Secrets are stored server-side only at ~/.aimaestro/maintainer-secrets.json
 * with permissions 0o600 (parent dir 0o700). The MAINTAINER agent NEVER sees
 * the secret — it verifies webhook signatures by calling
 * POST /api/maintainer/verify-signature, which performs the HMAC check
 * server-side and returns only a boolean verdict.
 *
 * Same security pattern as lib/amp-auth.ts API keys.
 */

import { randomBytes, createHmac, timingSafeEqual } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { join } from 'path'
import { getStateDir } from '@/lib/ecosystem-constants'

const SECRETS_FILE = 'maintainer-secrets.json'

interface SecretEntry {
  secret: string
  createdAt: string
}

type SecretsStore = Record<string, SecretEntry>

function getSecretsPath(): string {
  return join(getStateDir(), SECRETS_FILE)
}

function ensureParentDir(): void {
  const dir = getStateDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function readStore(): SecretsStore {
  const path = getSecretsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

function writeStore(store: SecretsStore): void {
  ensureParentDir()
  const path = getSecretsPath()
  writeFileSync(path, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
  // Belt-and-suspenders: re-chmod in case umask was permissive
  chmodSync(path, 0o600)
}

/**
 * Generate and store a new webhook secret for a MAINTAINER agent.
 * Returns the raw secret (shown to the user ONCE for GitHub webhook setup).
 */
export function mintMaintainerSecret(agentId: string): string {
  const secret = randomBytes(32).toString('hex')
  const store = readStore()
  store[agentId] = {
    secret,
    createdAt: new Date().toISOString(),
  }
  writeStore(store)
  return secret
}

/**
 * Retrieve the stored secret for an agent. Returns null if not found.
 */
export function getMaintainerSecret(agentId: string): string | null {
  const store = readStore()
  return store[agentId]?.secret ?? null
}

/**
 * Rotate (replace) the webhook secret for an agent.
 * Returns the new raw secret.
 */
export function rotateMaintainerSecret(agentId: string): string {
  const store = readStore()
  if (!store[agentId]) {
    throw new Error(`No maintainer secret found for agent ${agentId}`)
  }
  const secret = randomBytes(32).toString('hex')
  store[agentId] = {
    secret,
    createdAt: new Date().toISOString(),
  }
  writeStore(store)
  return secret
}

/**
 * Delete the webhook secret for an agent (called when MAINTAINER title is removed).
 */
export function deleteMaintainerSecret(agentId: string): void {
  const store = readStore()
  delete store[agentId]
  writeStore(store)
}

/**
 * Verify a GitHub webhook signature (HMAC-SHA256) against the stored secret.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param agentId - The MAINTAINER agent's ID
 * @param signature - The X-Hub-Signature-256 header value (e.g. "sha256=abc123...")
 * @param rawBody - The raw request body as a string
 * @returns true if the signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  agentId: string,
  signature: string,
  rawBody: string,
): boolean {
  const secret = getMaintainerSecret(agentId)
  if (!secret) return false

  // GitHub sends "sha256=<hex>", strip the prefix
  const prefix = 'sha256='
  if (!signature.startsWith(prefix)) return false
  const providedHex = signature.slice(prefix.length)

  const expectedHex = createHmac('sha256', secret)
    .update(rawBody, 'utf-8')
    .digest('hex')

  // Timing-safe comparison: both must be same length
  const providedBuf = Buffer.from(providedHex, 'hex')
  const expectedBuf = Buffer.from(expectedHex, 'hex')
  if (providedBuf.length !== expectedBuf.length) return false

  return timingSafeEqual(providedBuf, expectedBuf)
}
