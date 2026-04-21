/**
 * Types for the JSONL Session Browser feature (TRDD-d46b42e9).
 *
 * These describe the server-side API response shapes.
 * UI-side types extend these in later phases.
 */

/** A `.jsonl` session file discovered under the agent's project dir. */
export interface SessionSummary {
  /** Absolute path to the `.jsonl` file. */
  path: string
  /** File size in bytes. */
  size: number
  /**
   * Message count. `null` until the session is first opened — the count
   * requires a full index build on the Rust side, so we populate lazily.
   */
  messageCount: number | null
  /** ISO-8601 UTC string of the file's mtime. */
  lastModified: string
  /**
   * Suggested display name (usually `<session-uuid>.jsonl` → `<session-uuid>`).
   */
  displayName: string
  /**
   * Canonical id used for subsequent requests. Equal to `displayName`
   * unless the filename is non-standard.
   */
  id: string
}

export interface SessionsListResponse {
  /** Resolved `~/.claude/projects/<slug>` directory, if the agent has one. */
  projectDir: string | null
  sessions: SessionSummary[]
}

export interface RangeRequest {
  fromLine: number
  toLine: number
}

export interface RangeResponse {
  sessionId: string
  fromLine: number
  toLine: number
  lines: unknown[]
}

export interface SearchRequestBody {
  query: string
  kind?: 'substring' | 'regex'
  caseInsensitive?: boolean
  limit?: number
}

export interface SearchMatch {
  line: number
  byteOffset: number
  snippet: string
}

export interface SearchResponse {
  sessionId: string
  matches: SearchMatch[]
}

export interface ContextBreakdownResponse {
  sessionId: string
  systemPrompt: number
  systemTools: number
  mcpTools: number
  customAgents: number
  memory: number
  messages: number
  freeSpace: number
  cacheRead: number
  total: number
  modelContextLimit: number
  approximate: boolean
  modelId: string | null
}
