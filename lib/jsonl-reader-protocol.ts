/**
 * NDJSON protocol shared with the `aim-jsonl-reader` Rust binary.
 *
 * Every request is one JSON line on stdin; every response is one JSON line
 * on stdout. The Rust side lives in `rust-tools/aim-jsonl-reader/` and
 * exposes these command shapes via `src/protocol.rs` and `src/main.rs`.
 *
 * Keep this file in lockstep with the Rust side — new fields must be
 * additive so older readers keep working.
 */

// ---------------------------------------------------------------------------
// Error codes (mirrors src/protocol.rs `errors`)
// ---------------------------------------------------------------------------

export const JSONL_READER_ERROR_CODES = [
  'unknown_command',
  'invalid_request',
  'session_not_found',
  'open_failed',
  'read_failed',
  'search_failed',
  'panic',
] as const

export type JsonlReaderErrorCode = (typeof JSONL_READER_ERROR_CODES)[number]

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface PingRequest {
  cmd: 'ping'
}

export interface OpenRequest {
  cmd: 'open'
  path: string
}

export interface CloseRequest {
  cmd: 'close'
  sessionId: string
}

export interface ReadRangeRequest {
  cmd: 'read_range'
  sessionId: string
  fromLine: number
  toLine: number
}

export type SearchKind = 'substring' | 'regex'

export interface SearchRequest {
  cmd: 'search'
  sessionId: string
  query: string
  kind?: SearchKind
  caseInsensitive?: boolean
  limit?: number
}

export interface ContextBreakdownRequest {
  cmd: 'context_breakdown'
  sessionId: string
}

/**
 * Phase 5 §3.8 — streaming metadata analyzer.
 *
 * NOTE: Takes a raw absolute path, NOT a sessionId. The sessions-browser
 * list calls this BEFORE opening a Rust-side session handle so it can
 * populate divider rows (first-user preview, ongoing flag, compaction
 * count) without paying for an index build. The Rust side validates
 * the path itself.
 */
export interface AnalyzeFileMetadataRequest {
  cmd: 'analyze_file_metadata'
  path: string
}

export type JsonlReaderRequest =
  | PingRequest
  | OpenRequest
  | CloseRequest
  | ReadRangeRequest
  | SearchRequest
  | ContextBreakdownRequest
  | AnalyzeFileMetadataRequest

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ErrorResponse {
  ok: false
  error: JsonlReaderErrorCode | string
  detail?: string
}

export interface PingOkResponse {
  ok: true
  version: string
}

export interface OpenOkResponse {
  ok: true
  sessionId: string
  lineCount: number
  indexed: boolean
}

export interface CloseOkResponse {
  ok: true
}

export interface ReadRangeOkResponse {
  ok: true
  lines: unknown[]
}

export interface SearchMatch {
  line: number
  byteOffset: number
  snippet: string
}

export interface SearchOkResponse {
  ok: true
  matches: SearchMatch[]
}

export interface ContextBreakdownOkResponse {
  ok: true
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

/**
 * Phase 5 §3.8 metadata analyzer response. Every field is always
 * present — additive forward-compat is handled by the DOWNSTREAM
 * consumer (adding new fields over time never breaks existing ones).
 */
export interface PhaseTokenBreakdown {
  phaseId: number
  pre: number
  peak: number
  /** `null` while the phase is open (the last phase of the file). */
  post: number | null
}

export interface AnalyzeFileMetadataOkResponse {
  ok: true
  firstUserMessagePreview: string
  isOngoing: boolean
  compactionCount: number
  phaseTokenBreakdown: PhaseTokenBreakdown[]
  shutdownToolCalls: number
  rejections: number
  requestIdDedupedAssistantTokens: number
  hasSubagentSpawns: boolean
  hasCompactSummary: boolean
}

export type JsonlReaderResponse =
  | PingOkResponse
  | OpenOkResponse
  | CloseOkResponse
  | ReadRangeOkResponse
  | SearchOkResponse
  | ContextBreakdownOkResponse
  | AnalyzeFileMetadataOkResponse
  | ErrorResponse

// Narrowing helpers
export function isErrorResponse(r: JsonlReaderResponse): r is ErrorResponse {
  return (r as ErrorResponse).ok === false
}
