/**
 * VPN Chat types for the global human chatroom.
 *
 * ChatMessage is the unit of the append-only .jsonl log.
 * Each message is one JSON line in a daily file:
 *   messages-YYYY-MM-DD.jsonl
 */

export type ChatMessageType = 'text' | 'system'

export interface ChatMessage {
  /** Message identifier (UUID or ULID) */
  id: string
  /** Tailscale host ID of the sender */
  senderHostId: string
  /** Display name of the sender */
  senderName: string
  /** Message body — max 4096 characters, non-empty */
  content: string
  /** ISO 8601 timestamp with millisecond precision */
  timestamp: string
  /** Message type: 'text' for user messages, 'system' for join/leave notices */
  type: ChatMessageType
  /** Optional: ID of the message being replied to */
  replyTo?: string
  /** Optional: list of `<userName>@<hostId>` mentioned in the message */
  mentions?: string[]
}

export interface ChatHistoryResponse {
  messages: ChatMessage[]
  /** True if there are older messages available */
  hasMore: boolean
  /** Cursor for fetching the next page (ISO timestamp of oldest message returned) */
  nextCursor?: string
}

export interface BlocklistFile {
  blocked: string[]
}

const MAX_CONTENT_LENGTH = 4096
const VALID_TYPES: ReadonlySet<string> = new Set(['text', 'system'])

/**
 * Runtime type guard for ChatMessage.
 * Validates all required fields, content length (1..4096), and type enum.
 */
export function isValidChatMessage(value: unknown): value is ChatMessage {
  if (value === null || value === undefined || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0) return false
  if (typeof obj.senderHostId !== 'string' || obj.senderHostId.length === 0) return false
  if (typeof obj.senderName !== 'string' || obj.senderName.length === 0) return false
  if (typeof obj.content !== 'string' || obj.content.length === 0) return false
  if (obj.content.length > MAX_CONTENT_LENGTH) return false
  if (typeof obj.timestamp !== 'string' || obj.timestamp.length === 0) return false
  if (typeof obj.type !== 'string' || !VALID_TYPES.has(obj.type)) return false
  return true
}
