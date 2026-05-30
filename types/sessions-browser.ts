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
  /**
   * Tokens contributed by enabled skills (Phase 6 addition). Older
   * clients may receive 0 from servers that pre-date local tokenization.
   */
  skills: number
  messages: number
  /**
   * Reserved buffer Claude Code holds back for auto-compaction (~33k).
   * Phase 6 addition; older clients may receive 0.
   */
  autocompactBuffer: number
  freeSpace: number
  cacheRead: number
  total: number
  modelContextLimit: number
  approximate: boolean
  modelId: string | null
  /**
   * Always 'heuristic' as of the JSONL-primary refactor — the
   * captured `/context` snapshot is now exposed under
   * `recordedSnapshot` for side-by-side comparison instead of being
   * used as a silent fallback. Old clients keyed UI off this field;
   * the union still allows 'recorded' for wire backwards compat.
   */
  source?: 'recorded' | 'heuristic'
  /** Deprecated. Use `recordedSnapshot.capturedAtLineIndex`. */
  capturedAtLineIndex?: number | null
  /** Deprecated. Use `recordedSnapshot.capturedAtTimestamp`. */
  capturedAtTimestamp?: string | null
  /**
   * Captured `/context` slash-command snapshot at-or-before the
   * cursor, when one exists in the session. The UI renders these
   * numbers as a comparison overlay next to the heuristic primary
   * numbers so drift between Claude's BPE tokenizer and our
   * char/4 heuristic is visible.
   */
  recordedSnapshot?: RecordedContextSnapshotWire | null
  /**
   * Per-bucket element listings for the drill-down sub-page in the
   * Context panel. Always present once the Phase B server lands;
   * remains optional on the wire so clients pinned to older servers
   * keep working.
   */
  elements?: ContextElementsWire
}

export interface RecordedContextSnapshotWire {
  systemPrompt: number
  customAgents: number
  memory: number
  skills: number
  messages: number
  autocompactBuffer: number
  freeSpace: number
  total: number
  modelContextLimit: number
  modelId: string | null
  capturedAtLineIndex: number
  capturedAtTimestamp: string | null
}

export interface BucketElementWire {
  name: string
  tokens: number
  scope: 'user' | 'project' | 'plugin' | 'builtin'
  detail?: string
  /** Phase C provenance — see service docstring. */
  status?: 'normal' | 'approx' | 'missing'
}

export interface MessageElementsWire {
  tokens: number
  userCount: number
  assistantCount: number
}

export interface ConstantBucketWire {
  tokens: number
  note: string
}

export interface ContextElementsWire {
  systemPrompt: ConstantBucketWire
  systemTools: ConstantBucketWire
  mcpTools: ConstantBucketWire
  customAgents: BucketElementWire[]
  memory: BucketElementWire[]
  skills: BucketElementWire[]
  messages: MessageElementsWire
  autocompactBuffer: ConstantBucketWire
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
  /**
   * Optional split of `cacheCreationTokens` into the 5-minute ephemeral
   * write tier, when the raw record carries the nested
   * `usage.cache_creation.ephemeral_5m_input_tokens` field (Claude Code
   * 2.1.x). Additive — `cacheCreationTokens` remains the authoritative
   * total; this is just the 5m portion for UI drill-down. Absent on records
   * that only report the flat `cache_creation_input_tokens`.
   */
  cacheCreation5mTokens?: number
  /**
   * Optional split of `cacheCreationTokens` into the 1-hour ephemeral write
   * tier (`usage.cache_creation.ephemeral_1h_input_tokens`). Additive; see
   * {@link MessageUsage.cacheCreation5mTokens}. Pricing-wise the cost module
   * still bills the whole `cacheCreationTokens` at the 5m write rate — this
   * field exists for display only, not for a separate price calculation.
   */
  cacheCreation1hTokens?: number
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
  /**
   * Epoch milliseconds derived from `timestamp` (or carried forward from
   * the previous line when this record has no timestamp). Always a finite
   * number — `normalizeLine` guarantees it via `0` / carry-forward fallback
   * so Phase 5 (timeline + chronological ruler) can sort/space rows without
   * re-parsing ISO strings per render. Never NaN, never undefined.
   */
  tsMs: number
  /** Whether this line is a tool_use or tool_result record. */
  isToolEvent: boolean
  /**
   * Reasoning text extracted from `thinking` content blocks (Claude Code
   * 2.1.x extended-thinking feature — the reasoning lives in `block.thinking`,
   * NOT `block.text`). Present only when the assistant turn carried at least
   * one `thinking` block. The render layer shows this collapsed by default.
   * `redacted_thinking` blocks contribute a short placeholder marker instead
   * (see `redactedThinkingCount`).
   */
  thinkingText?: string
  /**
   * Number of `redacted_thinking` content blocks on this record. These carry
   * no readable field (the reasoning is server-side-redacted), so the render
   * layer shows a "[redacted reasoning ×N]" marker rather than dropping the
   * signal entirely. `0` / absent means none.
   */
  redactedThinkingCount?: number
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

// ---------------------------------------------------------------------------
// Phase 6 — cross-file timeline types (additive; existing shapes untouched)
// ---------------------------------------------------------------------------

/**
 * Classification of where a constituent .jsonl file came from.
 * Drives lane assignment and divider-row labelling in later phases.
 */
export type TimelineFileKind =
  | 'main'
  | 'subagent'
  | 'worktree-main'
  | 'worktree-subagent'

/**
 * Description of one file that participates in a timeline. Returned by
 * `resolveTimelineSources` and carried through to the manifest response.
 */
export interface TimelineFile {
  /** Absolute path to the `.jsonl` file. */
  absPath: string
  /** Session UUID derived from the filename (no extension). */
  sessionId: string
  /** Where this file came from (main-thread, subagent, worktree). */
  kind: TimelineFileKind
  /** Opaque lane id passed to the Rust reader (e.g. `main`, `subagent:<slug>`). */
  laneId: string
  /** For subagent files, the parent session's id. `null` for main-thread files. */
  parentSessionId: string | null
  /** Agent id from the first-line `agentId`, when present (subagents only). */
  agentId: string | null
  /** Slug from the first-line `slug`, when present (subagents only). */
  slug: string | null
  /** File size in bytes. */
  size: number
  /** ISO-8601 mtime — used for cache invalidation. */
  lastModified: string
}

/** Enumerated constituent files for an agent's timeline. */
export interface ResolvedTimelineSources {
  /** Main-thread `.jsonl`s under `~/.claude/projects/<agent-slug>/`. */
  mainFiles: TimelineFile[]
  /** Files in sibling `--claude-worktrees-*` project dirs. */
  worktreeFiles: TimelineFile[]
  /**
   * In-session subagent files (`<sid>/subagents/*.jsonl`). Zero in v0 of
   * this resolver — the enumeration walks the main project dir only; a
   * deeper walk is introduced when the subagent-file layout lands.
   */
  subagentFiles: TimelineFile[]
  /**
   * Every `~/.claude/projects/` subdirectory that contributed at least one
   * file — surfaced so the UI can show the set of workdirs feeding a lane.
   */
  projectDirs: string[]
}

/**
 * Manifest returned by `GET /api/sessions-browser/agents/:id/timeline`.
 * Mirrors the Rust-side `open_timeline` manifest, plus a `files` field
 * exposed for client-side rendering of divider rows and lane strips.
 */
export interface TimelineManifest {
  timelineId: string
  agentId: string
  /**
   * Ordered list of files that the Rust reader opened (sorted by first
   * timestamp ASC by the reader itself — we echo that order here).
   */
  files: TimelineFile[]
  /** Sum of every file's line count. */
  totalLines: number
  /** Resolved agent project directories that contributed files. */
  projectDirs: string[]
  /** ISO-8601 timestamp when the manifest was generated. */
  generatedAt: string
  /** Per-lane summary echoed from the Rust manifest. */
  lanes: TimelineLaneSummary[]
}

/** Per-lane summary — shape mirrors the Rust response. */
export interface TimelineLaneSummary {
  laneId: string
  fileIndexes: number[]
  firstTimestampIso: string
  lastTimestampIso: string
  lineCount: number
}

/** One row returned by the range API. Mirrors the Rust reader row. */
export interface VirtualRow {
  sessionId: string
  laneId: string
  fileIndex: number
  localLineIndex: number
  globalLineIndex: number
  raw: unknown
}

/** One match returned by the timeline search API. */
export interface TimelineSearchMatch {
  globalLineIndex: number
  laneId: string
  sessionId: string
  fileIndex: number
  localLineIndex: number
  byteOffset: number
  snippet: string
}

/** Context-at response shape, echoed by the integrated context API. */
export interface TimelineContextResult {
  anchorGlobalLine: number | null
  cumulative: TimelineBuckets
  exactAtCursor: TimelineBuckets
  phaseHistory: TimelinePhaseEntry[]
}

/** Categorical buckets — mirrors TimelineBuckets in the reader protocol. */
export interface TimelineBuckets {
  systemPrompt: number
  systemTools: number
  mcpTools: number
  customAgents: number
  memory: number
  messages: number
  cacheRead: number
  total: number
  freeSpace: number
  modelContextLimit: number
  approximate: boolean
  modelId: string | null
}

/** One phase in the phase-history split on isCompactSummary markers. */
export interface TimelinePhaseEntry {
  phaseId: number
  pre: number
  peak: number
  post: number | null
}
