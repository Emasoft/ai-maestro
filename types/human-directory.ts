/**
 * Human Directory types for VPN-wide human user discovery.
 *
 * Each AI Maestro host maintains a humans.json file keyed by
 * `<userName>@<hostId>`. Entries record display info, Tailscale IP,
 * and online status for the user roster in the VPN chatroom.
 */

export type HumanStatus = 'online' | 'offline' | 'away'

export interface HumanEntry {
  /** Unique identifier: `<userName>@<hostId>` */
  id: string
  /** Tailscale host identifier */
  hostId: string
  /** Display name shown in roster and messages */
  displayName: string
  /** Tailscale VPN IPv4 address (CGNAT range 100.64.0.0/10) */
  tailscaleIp: string
  /** ISO 8601 timestamp of last heartbeat */
  lastSeen: string
  /** Current online status */
  status: HumanStatus
  /** Optional avatar path */
  avatar?: string
  /** Optional Ed25519 public key (base64) for message signing */
  publicKey?: string
  /** ISO 8601 timestamp of entry creation */
  createdAt?: string
}

export interface HumanDirectoryFile {
  version: 1
  humans: HumanEntry[]
}

const VALID_STATUSES: ReadonlySet<string> = new Set(['online', 'offline', 'away'])

/**
 * Runtime type guard for HumanEntry.
 * Returns true only when all required fields are present and valid.
 */
export function isValidHumanEntry(value: unknown): value is HumanEntry {
  if (value === null || value === undefined || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0) return false
  if (typeof obj.hostId !== 'string' || obj.hostId.length === 0) return false
  if (typeof obj.displayName !== 'string' || obj.displayName.length === 0) return false
  if (typeof obj.tailscaleIp !== 'string' || obj.tailscaleIp.length === 0) return false
  if (typeof obj.lastSeen !== 'string' || obj.lastSeen.length === 0) return false
  if (typeof obj.status !== 'string' || !VALID_STATUSES.has(obj.status)) return false
  return true
}
