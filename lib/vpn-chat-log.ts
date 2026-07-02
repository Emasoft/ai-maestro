/**
 * VPN Chat Log — Append-only .jsonl log for chat messages.
 *
 * Storage: ~/.aimaestro/vpn-chat/messages-YYYY-MM-DD.jsonl
 * Each line is one JSON ChatMessage.
 * New file per day (daily rotation).
 *
 * Also manages the local blocklist at:
 *   ~/.aimaestro/vpn-chat/blocklist.json
 */

import fs from 'fs'
import path from 'path'
import type { ChatMessage } from '@/types/vpn-chat'
import type { BlocklistFile } from '@/types/vpn-chat'
import { getStateDir } from '@/lib/ecosystem-constants'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VPN_CHAT_DIRNAME = 'vpn-chat'
const BLOCKLIST_FILENAME = 'blocklist.json'

function getChatDir(stateDir?: string): string {
  const dir = stateDir ?? getStateDir()
  return path.join(dir, VPN_CHAT_DIRNAME)
}

function ensureChatDir(stateDir?: string): string {
  const chatDir = getChatDir(stateDir)
  if (!fs.existsSync(chatDir)) {
    fs.mkdirSync(chatDir, { recursive: true })
  }
  return chatDir
}

/**
 * Derive the daily .jsonl filename from an ISO timestamp.
 * Returns `messages-YYYY-MM-DD.jsonl`.
 */
function dailyFilename(isoTimestamp: string): string {
  // Extract date portion (YYYY-MM-DD) from ISO string
  const dateStr = isoTimestamp.substring(0, 10)
  return `messages-${dateStr}.jsonl`
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append a single chat message to the daily .jsonl file.
 * The file is determined by the message's timestamp date.
 * Uses append mode with 0o600 permissions.
 */
export function appendMessage(msg: ChatMessage, stateDir?: string): void {
  const chatDir = ensureChatDir(stateDir)
  const filename = dailyFilename(msg.timestamp)
  const filePath = path.join(chatDir, filename)
  const line = JSON.stringify(msg) + '\n'

  // Open in append mode; create if not exists with owner-only perms
  const fd = fs.openSync(filePath, 'a', 0o600)
  try {
    fs.writeSync(fd, line)
  } finally {
    fs.closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * List all daily .jsonl files in the chat directory, sorted chronologically.
 * Returns full paths.
 */
function listDailyFiles(stateDir?: string): string[] {
  const chatDir = getChatDir(stateDir)
  if (!fs.existsSync(chatDir)) return []
  const files = fs.readdirSync(chatDir)
    .filter(f => f.startsWith('messages-') && f.endsWith('.jsonl'))
    .sort() // lexicographic sort = chronological for YYYY-MM-DD
  return files.map(f => path.join(chatDir, f))
}

/**
 * Read all messages from a single .jsonl file.
 * Skips malformed lines (best-effort).
 */
function readMessagesFromFile(filePath: string): ChatMessage[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim().length > 0)
  const messages: ChatMessage[] = []
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line) as ChatMessage)
    } catch {
      console.warn(`[vpn-chat-log] Skipping malformed line in ${filePath}`)
    }
  }
  return messages
}

/**
 * Get recent messages with optional cursor-based pagination.
 *
 * @param limit - Maximum number of messages to return
 * @param before - If provided, only return messages with timestamp strictly < before
 * @param stateDir - Override state directory (for tests)
 * @returns Messages sorted chronologically (oldest first). When paginating
 *          (limit < total), returns the most recent `limit` messages.
 */
export function getMessages(limit: number, before?: string, stateDir?: string): ChatMessage[] {
  const files = listDailyFiles(stateDir)
  if (files.length === 0) return []

  // Read all messages from all daily files (chronological order)
  let allMessages: ChatMessage[] = []
  for (const file of files) {
    const msgs = readMessagesFromFile(file)
    allMessages.push(...msgs)
  }

  // Sort by timestamp (ascending = chronological)
  allMessages.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  // Apply before filter
  if (before) {
    allMessages = allMessages.filter(m => m.timestamp < before)
  }

  // Apply limit: return the most recent `limit` messages
  if (allMessages.length > limit) {
    allMessages = allMessages.slice(allMessages.length - limit)
  }

  return allMessages
}

/**
 * Get the total count of messages across all daily files.
 */
export function getMessageCount(stateDir?: string): number {
  const files = listDailyFiles(stateDir)
  let count = 0
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim().length > 0)
    count += lines.length
  }
  return count
}

// ---------------------------------------------------------------------------
// Blocklist
// ---------------------------------------------------------------------------

function getBlocklistPath(stateDir?: string): string {
  return path.join(getChatDir(stateDir), BLOCKLIST_FILENAME)
}

/**
 * Load the local blocklist. Returns empty array if file does not exist.
 */
export function getBlocklist(stateDir?: string): string[] {
  const filePath = getBlocklistPath(stateDir)
  if (!fs.existsSync(filePath)) return []
  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    const parsed: BlocklistFile = JSON.parse(data)
    return Array.isArray(parsed.blocked) ? parsed.blocked : []
  } catch {
    return []
  }
}

/**
 * Persist the blocklist with atomic write and 0o600 perms.
 */
function saveBlocklist(blocked: string[], stateDir?: string): void {
  const chatDir = ensureChatDir(stateDir)
  const filePath = path.join(chatDir, BLOCKLIST_FILENAME)
  const file: BlocklistFile = { blocked }
  const tmpFile = filePath + '.tmp.' + process.pid
  fs.writeFileSync(tmpFile, JSON.stringify(file, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmpFile, filePath)
}

/**
 * Block a user by their `<userName>@<hostId>` identifier.
 * Idempotent — blocking the same user twice is a no-op.
 */
export function addBlock(userId: string, stateDir?: string): void {
  const blocked = getBlocklist(stateDir)
  if (blocked.includes(userId)) return
  blocked.push(userId)
  saveBlocklist(blocked, stateDir)
}

/**
 * Unblock a user. No-op if the user is not blocked.
 */
export function removeBlock(userId: string, stateDir?: string): void {
  const blocked = getBlocklist(stateDir)
  const idx = blocked.indexOf(userId)
  if (idx < 0) return
  blocked.splice(idx, 1)
  saveBlocklist(blocked, stateDir)
}
