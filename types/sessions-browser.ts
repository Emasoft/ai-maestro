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

  // ---------------------------------------------------------------
  // Phase 5 metadata fields (additive — all optional for back-compat).
  // Populated lazily from the Rust `analyze_file_metadata` command on
  // first request; cached in-process keyed by (path, size, mtime).
  // Downstream consumers treat `undefined` as "not yet analyzed".
  // ---------------------------------------------------------------

  /**
   * First non-meta user message in the file, truncated to 120 chars.
   * Used by the session-divider row to preview what the session was about.
   */
  firstUserText?: string
  /**
   * True when the file's mtime is within the last 10 minutes AND no
   * explicit shutdown marker has been written. Drives the "ongoing"
   * badge on divider rows and the live-tailing decision in Phase 11.
   */
  isOngoing?: boolean
  /**
   * Count of rows with `isCompactSummary: true`. One badge per count
   * on the divider row; also signals phase boundaries for the
   * integrated context panel.
   */
  compactionCount?: number
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

// ---------------------------------------------------------------------------
// UI-side types (Phase 3 only — not wire shapes)
// ---------------------------------------------------------------------------

/** Canonical message role derived from a JSONL record. */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** Usage stats attached to assistant messages. */
export interface MessageUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/**
 * A single transcript line normalized for UI rendering. Built from the raw
 * JSONL record returned by the range route. The UI hook ignores fields it
 * does not understand — the JSONL schema is best-effort, not a strict
 * contract.
 */
export interface TranscriptLine {
  /** Index of this line in the file (0-based). */
  lineIndex: number
  /** Role of the speaker / record. */
  role: MessageRole
  /** Best-effort message body for plain-text display. Empty for tool calls. */
  text: string
  /**
   * Tool-use payload if this line is a `tool_use` / `tool_result` record.
   * The UI collapses these into a summary row.
   */
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  toolUseId?: string
  /** Usage stats present only on assistant messages that carry `usage`. */
  usage?: MessageUsage
  /** ISO timestamp if present on the record. */
  timestamp?: string
  /** Whether this line is a tool_use or tool_result record. */
  isToolEvent: boolean
  /** Raw record, kept for debugging / highlight / future expansion. */
  raw: unknown
}

/** Search match augmented with the UI's local line index alias. */
export interface HighlightedMatch {
  line: number
  byteOffset: number
  snippet: string
}

/** Convenience tuple returned by `useJsonlSession`. */
export interface SessionDataState {
  loading: boolean
  error: string | null
  lines: TranscriptLine[]
  breakdown: ContextBreakdownResponse | null
  matches: HighlightedMatch[]
  searching: boolean
  searchError: string | null
}
