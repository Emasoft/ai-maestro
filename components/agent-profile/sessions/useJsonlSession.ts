'use client'

/**
 * useJsonlSession — data hook for the Sessions tab (Phase 3, TRDD-d46b42e9 §6).
 *
 * Responsibilities:
 *   1. List sessions for an agent (GET /api/sessions-browser/agents/:id/sessions)
 *   2. Load transcript lines in paged chunks (POST /:sid/range)
 *   3. Load context breakdown for a session (GET /:sid/context-breakdown)
 *   4. Run incremental search (POST /:sid/search)
 *   5. Sync the selected session id into the URL query (?tab=sessions&sid=<uuid>)
 *
 * All fetches use the user's aim_session cookie (same-origin, include by default).
 * The hook intentionally does NOT open any new API surface — every call maps to
 * a Phase 2 route.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ContextBreakdownResponse,
  HighlightedMatch,
  MessageRole,
  MessageUsage,
  RangeResponse,
  SearchResponse,
  SessionSummary,
  SessionsListResponse,
  TranscriptLine,
} from '@/types/sessions-browser'

const DEFAULT_PAGE_SIZE = 500

/**
 * Live-tail poll interval (ms). Only used when the session is ONGOING and the
 * user has turned `followTail` ON — a closed historical session never polls
 * (audit C1: a 2 s unconditional interval on a read-only browser was a
 * no-polling-rule violation). 2 s is the "feels live" cadence; it is the
 * ceiling of how stale a followed, actively-written session can look.
 */
const LIVE_TAIL_INTERVAL_MS = 2000

/**
 * Consecutive transient tail failures tolerated before the loop surfaces the
 * error and stops. Transient = retryable (network blip, a brief
 * session_not_found while the file rotates). Terminal errors
 * (`binary_missing`) stop immediately regardless of this count.
 */
const TAIL_MAX_TRANSIENT_FAILURES = 5

/**
 * Classify a tail `fetchRange` error as terminal (stop the loop, surface it)
 * vs transient (retry next tick). The error messages are the `*_failed:<status>:<detail>`
 * strings thrown by `fetchRange` → `safeErrorDetail`. `binary_missing` (the
 * Rust reader binary is gone) can never recover by retrying, so it is terminal.
 */
function isTerminalTailError(message: string): boolean {
  return message.includes('binary_missing')
}

// ---------------------------------------------------------------------------
// Normalization — raw JSONL line → TranscriptLine
// ---------------------------------------------------------------------------

interface RawRecord {
  type?: string
  role?: string
  message?: {
    role?: string
    content?: unknown
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  timestamp?: string
  content?: unknown
  text?: string
  tool_use_id?: string
  name?: string
  input?: unknown
  tool_result?: unknown
}

/**
 * Top-level `type` values that Claude Code emits at session start (or
 * mid-session) which carry NO user-visible message body — they exist only as
 * structural / telemetry / hook / tool-plumbing markers.
 *
 * Rendering them as "SYSTEM (empty)" rows clutters the transcript and
 * confuses the user (the screenshot 2026-05-06 21:24 showed five of
 * these stacked beneath the only real assistant message). They are
 * filtered out at line-build time in `normalizeLine` — the function
 * returns null for these records, and the caller skips null entries.
 *
 * IMPORTANT: lineIndex remains the raw JSONL line offset (not a
 * post-filter index), so server-side range fetches keep working with
 * the original line numbers. Only the rendered transcript is filtered.
 *
 * Classification (per IN-1 schema-evolution audit, Claude Code 2.1.142+):
 *   - RENDER: `user`, `assistant` (real messages) — never in this Set.
 *   - DEDICATED-EVENT (future): the error envelopes (`error`,
 *     `authentication_error`, `overloaded_error`) and `compact_boundary`
 *     (a `system` subtype, already caught by the empty-text heuristic below)
 *     carry signal worth a dedicated event row. Until that render phase
 *     exists, HIDING them is strictly better than emitting an empty bubble,
 *     so they live here with a note. Promote them out of this Set when the
 *     dedicated-event channel lands.
 *   - HIDE: everything else below — structural noise (attachments, file
 *     snapshots), hook telemetry (`hook_*`), task/queue/mode plumbing,
 *     tool-discovery deltas, skill/agent listings. The RECENT 35 MB sample
 *     had 12,356 `attachment` + 9,701 `hook_success` + 4,062 `queue-operation`
 *     records — without this Set they all paint empty rows.
 */
const HIDDEN_RECORD_TYPES = new Set([
  // --- pre-existing structural markers ---
  'last-prompt',
  'custom-title',
  'agent-name',
  'permission-mode',
  'file-history-snapshot',
  'attachment',
  // Legacy / hyphen-cased stream markers (kept for older sessions).
  'queued-prompt',
  'compact-summary-anchor',
  // --- hook family (replaced OLD progress/agent_progress/hook_progress) ---
  'hook_success',
  'hook_additional_context',
  'hook_non_blocking_error',
  'hook_cancelled',
  // --- task / queue / mode plumbing ---
  'queue-operation',
  'queued_command',
  'task_reminder',
  'task_status',
  'mode',
  // --- tool / skill / agent discovery plumbing (no message body) ---
  'tool_reference',
  'skill_listing',
  'invoked_skills',
  'deferred_tools_delta',
  'mcp_instructions_delta',
  'command_permissions',
  'compact_file_reference',
  // --- file-edit side records (the diff/content lives in tool_result) ---
  'file',
  'create',
  'update',
  'edited_text_file',
  // --- telemetry / housekeeping ---
  'date_change',
  'diagnostics',
  // --- error envelopes (DEDICATED-EVENT candidates — see note above) ---
  'error',
  'authentication_error',
  'overloaded_error',
])

function extractRole(raw: RawRecord): MessageRole {
  const r =
    (raw.role as string | undefined) ||
    (raw.message?.role as string | undefined) ||
    (raw.type as string | undefined)
  if (r === 'user') return 'user'
  if (r === 'assistant') return 'assistant'
  if (r === 'tool_use' || r === 'tool_result' || r === 'tool') return 'tool'
  return 'system'
}

/** Return true if the record is a metadata marker that should NOT render. */
function isMetadataOnlyRecord(raw: RawRecord): boolean {
  const t = raw.type
  if (typeof t !== 'string') return false
  if (HIDDEN_RECORD_TYPES.has(t)) return true

  // `type: 'system'` records cover both genuine system messages (which
  // carry text content the user wants to see) AND internal Claude Code
  // telemetry events (hooks fired, turn duration, message counts) which
  // have NO message body. Keep the former; hide the latter.
  //
  // Heuristic: a system record without any string/array content is
  // telemetry. We look at top-level `content`, `text`, and
  // `message.content` — if none of them yield a non-empty string after
  // the same flattening logic `extractText` performs, the record is
  // metadata-only. Cheap to check; precise enough for the real shapes
  // we've seen in production sessions (subtype=hook, subtype=compact,
  // subtype=duration emissions all match).
  if (t === 'system') {
    const text = extractText(raw)
    if (text.trim().length === 0) return true
  }
  return false
}

function extractText(raw: RawRecord): string {
  // Claude Code JSONL "content" is typically a string OR an array of
  // {type,text} blocks. We flatten both.
  //
  // IMPORTANT: only plain text/visible blocks land here. `thinking` and
  // `redacted_thinking` blocks are reasoning, NOT message body — they are
  // pulled out separately by `extractThinking` so the render layer can show
  // them collapsed instead of inlining reasoning into the bubble text. We
  // skip them here by checking `b.type` (a bare `b.text` on a thinking block
  // would otherwise be empty anyway, but being explicit prevents a future
  // thinking-block shape change from leaking reasoning into the text body).
  const content: unknown = raw.message?.content ?? raw.content ?? raw.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block)
      } else if (block && typeof block === 'object') {
        const b = block as { type?: string; text?: string }
        if (b.type === 'thinking' || b.type === 'redacted_thinking') continue
        if (typeof b.text === 'string') parts.push(b.text)
      }
    }
    return parts.join('\n\n')
  }
  return ''
}

/**
 * Pull reasoning out of `thinking` / `redacted_thinking` content blocks.
 *
 * Claude Code 2.1.x extended-thinking records the chain-of-thought in a
 * `{type:'thinking', thinking:'<reasoning>', signature:'<base64>'}` block —
 * the reasoning text is in the `thinking` FIELD, not `text`, so `extractText`
 * would silently drop it. `redacted_thinking` blocks carry no readable field
 * at all (the reasoning is server-side redacted); we count them so the render
 * layer can show a "[redacted reasoning ×N]" marker rather than losing the
 * signal that reasoning happened.
 *
 * Returns the concatenated thinking text (empty string if none) and the count
 * of redacted blocks. Pure flattening over the same content array `extractText`
 * walks; tool_use blocks are ignored here (handled by `extractToolInfo`).
 */
function extractThinking(raw: RawRecord): { thinkingText: string; redactedCount: number } {
  const content: unknown = raw.message?.content ?? raw.content
  if (!Array.isArray(content)) return { thinkingText: '', redactedCount: 0 }
  const parts: string[] = []
  let redactedCount = 0
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: string; thinking?: string }
    if (b.type === 'thinking') {
      if (typeof b.thinking === 'string' && b.thinking.length > 0) parts.push(b.thinking)
    } else if (b.type === 'redacted_thinking') {
      redactedCount += 1
    }
  }
  return { thinkingText: parts.join('\n\n'), redactedCount }
}

function extractUsage(raw: RawRecord): MessageUsage | undefined {
  const u = raw.message?.usage ?? raw.usage
  if (!u) return undefined
  // Require at least one numeric field to avoid false-positive badges.
  const hasAny =
    typeof u.input_tokens === 'number' ||
    typeof u.output_tokens === 'number' ||
    typeof u.cache_read_input_tokens === 'number' ||
    typeof u.cache_creation_input_tokens === 'number'
  if (!hasAny) return undefined
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
  }
}

function extractToolInfo(raw: RawRecord): {
  isToolEvent: boolean
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  toolUseId?: string
} {
  // Pattern A: top-level `type: tool_use | tool_result` records.
  if (raw.type === 'tool_use') {
    return {
      isToolEvent: true,
      toolName: raw.name,
      toolInput: raw.input,
      toolUseId: raw.tool_use_id,
    }
  }
  if (raw.type === 'tool_result') {
    return {
      isToolEvent: true,
      toolResult: raw.tool_result ?? raw.content,
      toolUseId: raw.tool_use_id,
    }
  }
  // Pattern B: content-array containing tool_use blocks inside an assistant
  // message. We flag the whole record as a tool-event so the UI can render
  // an expandable summary row.
  const content: unknown = raw.message?.content ?? raw.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as { type?: string; name?: string; input?: unknown; id?: string }
        if (b.type === 'tool_use') {
          return {
            isToolEvent: true,
            toolName: b.name,
            toolInput: b.input,
            toolUseId: b.id,
          }
        }
      }
    }
  }
  return { isToolEvent: false }
}

/**
 * Parse an ISO-8601 timestamp string into epoch milliseconds.
 * Returns `null` when the input is absent or unparseable (NEVER NaN) so the
 * caller can apply the carry-forward fallback deterministically.
 */
function parseTsMs(timestamp: string | undefined): number | null {
  if (typeof timestamp !== 'string' || timestamp.length === 0) return null
  const ms = Date.parse(timestamp)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Convert a raw JSONL record into a renderable TranscriptLine.
 *
 * Returns `null` for metadata-only records (custom-title, agent-name,
 * etc.) so they're filtered out of the transcript at build time.
 * Callers MUST treat null as "skip this line" — the lineIndex passed in
 * is preserved on real records so the server-side range numbering
 * stays consistent (the filter is purely a render-side cull).
 *
 * `prevTsMs` is the epoch-ms of the previous RENDERED line (or 0 at the start
 * of the file). When this record has no parseable `timestamp` we carry that
 * value forward so `tsMs` is always a finite, monotonic-ish number for Phase 5
 * (timeline ruler). `normalizeLines` threads this for the common batch case;
 * direct callers may pass 0.
 */
export function normalizeLine(
  raw: unknown,
  lineIndex: number,
  prevTsMs = 0,
): TranscriptLine | null {
  const r = (raw ?? {}) as RawRecord
  if (isMetadataOnlyRecord(r)) return null
  const role = extractRole(r)
  const { isToolEvent, toolName, toolInput, toolResult, toolUseId } = extractToolInfo(r)
  const { thinkingText, redactedCount } = extractThinking(r)
  const timestamp = typeof r.timestamp === 'string' ? r.timestamp : undefined
  const parsed = parseTsMs(timestamp)
  return {
    lineIndex,
    role,
    text: extractText(r),
    usage: extractUsage(r),
    timestamp,
    // Carry the previous line's tsMs forward when this record lacks a
    // timestamp — never NaN, never undefined (Phase 5 sorts/spaces on it).
    tsMs: parsed ?? prevTsMs,
    thinkingText: thinkingText.length > 0 ? thinkingText : undefined,
    redactedThinkingCount: redactedCount > 0 ? redactedCount : undefined,
    toolName,
    toolInput,
    toolResult,
    toolUseId,
    isToolEvent,
    raw,
  }
}

/**
 * Normalize a batch of raw records into rendered TranscriptLines, threading
 * the `tsMs` carry-forward across the batch and dropping metadata-only rows.
 *
 * @param rawLines  raw JSONL objects from a range fetch (in file order)
 * @param fromOffset absolute file offset of `rawLines[0]` (the cursor base)
 * @param seedTsMs  tsMs of the line immediately BEFORE this batch (0 for the
 *                  first page; the last rendered line's tsMs for appended pages)
 *
 * Centralises the map+filter that the initial-load / loadMore / live-tail
 * paths used to duplicate inline (single source of truth for normalization),
 * and is what makes the carry-forward correct ACROSS page boundaries — a row
 * with no timestamp inherits the prior page's last tsMs, not 0.
 */
export function normalizeLines(
  rawLines: unknown[],
  fromOffset: number,
  seedTsMs = 0,
): TranscriptLine[] {
  const out: TranscriptLine[] = []
  let prevTsMs = seedTsMs
  for (let i = 0; i < rawLines.length; i++) {
    const line = normalizeLine(rawLines[i], fromOffset + i, prevTsMs)
    if (line === null) continue
    prevTsMs = line.tsMs
    out.push(line)
  }
  return out
}

/**
 * Map a RAW JSONL line offset (`TranscriptLine.lineIndex`) to its position
 * in the rendered/filtered `lines` array.
 *
 * WHY this exists (audit C4): `lineIndex` is the absolute file offset, but
 * `normalizeLine` drops metadata-only records (see `HIDDEN_RECORD_TYPES`),
 * so the rendered `lines` array is SHORTER than the file and its positions
 * no longer equal the file offsets. Any consumer that indexes a
 * position-keyed array (e.g. ChatTranscript's `offsets[]` for scroll-to-match)
 * with a raw `lineIndex` lands on the wrong row — or, when
 * `lineIndex >= lines.length`, silently nowhere. Translate the offset HERE,
 * once, before indexing.
 *
 * Behaviour:
 *   - Exact match on `lineIndex` → that array position.
 *   - No exact match (the target offset belongs to a FILTERED-out record, or
 *     is past the loaded window) → the position of the nearest loaded line
 *     whose `lineIndex <= target` (so a match inside a filtered block scrolls
 *     to the visible row just before it, never off the top of the list).
 *   - No loaded line at-or-before the target (target precedes every loaded
 *     line) → `0`.
 *   - Empty `lines` → `-1` (caller treats as "cannot scroll"; mirrors
 *     `findIndex`'s not-found sentinel so a bounds-check `pos < 0` works).
 *
 * `lines` is assumed sorted ascending by `lineIndex` (it always is —
 * `normalizeLine` is fed sequential offsets and results are appended in
 * order). Pure + side-effect-free so it is unit-testable in isolation; the
 * unit test seeds a session whose leading records are filtered metadata and
 * asserts a match maps to the correct array position.
 */
export function lineIndexToArrayPos(lines: TranscriptLine[], lineIndex: number): number {
  if (lines.length === 0) return -1
  // Binary search for the greatest array position whose lineIndex <= target.
  // (Linear `findIndex` would be O(n) per jump on a 10k-line transcript;
  // the array is sorted so a binary search keeps scroll-to-match O(log n).)
  let lo = 0
  let hi = lines.length - 1
  // If the target precedes the first loaded line, there is nothing at-or-before it.
  if (lineIndex < lines[0].lineIndex) return 0
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const midIdx = lines[mid].lineIndex
    if (midIdx === lineIndex) return mid
    if (midIdx < lineIndex) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

/** Sum usage across all assistant messages. Returned for the sticky header. */
export function sumUsage(lines: TranscriptLine[]): MessageUsage {
  const out: MessageUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }
  for (const line of lines) {
    if (line.usage) {
      out.inputTokens += line.usage.inputTokens
      out.outputTokens += line.usage.outputTokens
      out.cacheReadTokens += line.usage.cacheReadTokens
      out.cacheCreationTokens += line.usage.cacheCreationTokens
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// API wrappers — one per Phase 2 route
// ---------------------------------------------------------------------------

async function fetchSessionsList(agentId: string, signal?: AbortSignal): Promise<SessionsListResponse> {
  const res = await fetch(`/api/sessions-browser/agents/${encodeURIComponent(agentId)}/sessions`, {
    method: 'GET',
    credentials: 'include',
    signal,
  })
  if (!res.ok) {
    const detail = await safeErrorDetail(res)
    throw new Error(`list_failed:${res.status}${detail ? `:${detail}` : ''}`)
  }
  return (await res.json()) as SessionsListResponse
}

// Build a query-string suffix that includes the absolute path when known.
// The route handlers prefer `?path=` over the in-memory sid→path cache —
// see app/api/sessions-browser/sessions/[sid]/range/route.ts. SCEN-027
// BUG-001 (2026-04-26) showed the in-memory map is unreliable across
// Next.js worker processes; carrying the path explicitly is the fix.
function pathQuery(path?: string | null): string {
  return path ? `?path=${encodeURIComponent(path)}` : ''
}

async function fetchRange(
  sid: string,
  fromLine: number,
  toLine: number,
  path: string | undefined,
  signal?: AbortSignal,
): Promise<RangeResponse> {
  const res = await fetch(
    `/api/sessions-browser/sessions/${encodeURIComponent(sid)}/range${pathQuery(path)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromLine, toLine }),
      signal,
    },
  )
  if (!res.ok) {
    const detail = await safeErrorDetail(res)
    throw new Error(`range_failed:${res.status}${detail ? `:${detail}` : ''}`)
  }
  return (await res.json()) as RangeResponse
}

async function fetchContextBreakdown(
  sid: string,
  path: string | undefined,
  atIndex: number | null,
  signal?: AbortSignal,
): Promise<ContextBreakdownResponse> {
  // Compose query string with both `?path=` (cross-worker safety,
  // see range/route.ts comment) and the optional `?atIndex=N` cursor
  // that pins the breakdown to a captured `/context` snapshot at or
  // before that JSONL line index.
  const qs = new URLSearchParams()
  if (path) qs.set('path', path)
  if (atIndex !== null) qs.set('atIndex', String(atIndex))
  const queryString = qs.toString()
  const url = `/api/sessions-browser/sessions/${encodeURIComponent(sid)}/context-breakdown${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url, { method: 'GET', credentials: 'include', signal })
  if (!res.ok) {
    const detail = await safeErrorDetail(res)
    throw new Error(`context_failed:${res.status}${detail ? `:${detail}` : ''}`)
  }
  return (await res.json()) as ContextBreakdownResponse
}

async function fetchSearch(
  sid: string,
  query: string,
  path: string | undefined,
  opts: { caseInsensitive?: boolean; limit?: number; kind?: 'substring' | 'regex' } = {},
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const res = await fetch(
    `/api/sessions-browser/sessions/${encodeURIComponent(sid)}/search${pathQuery(path)}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        caseInsensitive: opts.caseInsensitive ?? true,
        limit: opts.limit ?? 500,
        kind: opts.kind ?? 'substring',
      }),
      signal,
    },
  )
  if (!res.ok) {
    const detail = await safeErrorDetail(res)
    throw new Error(`search_failed:${res.status}${detail ? `:${detail}` : ''}`)
  }
  return (await res.json()) as SearchResponse
}

async function safeErrorDetail(res: Response): Promise<string | null> {
  try {
    const body = await res.json()
    if (body && typeof body === 'object') {
      const b = body as { error?: string; detail?: string }
      return b.error ?? b.detail ?? null
    }
  } catch {
    /* ignore */
  }
  return null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseJsonlSessionOptions {
  /** Agent id — when null, the hook is inert. */
  agentId: string | null
  /** Page size for paginated range reads. Default 500. */
  pageSize?: number
  /**
   * When true, the selected session id is mirrored into the URL query
   * (`?tab=sessions&sid=<uuid>`) via `history.replaceState`. Defaults to true.
   */
  syncUrl?: boolean
}

export interface UseJsonlSessionApi {
  // Sessions list
  sessions: SessionSummary[]
  projectDir: string | null
  listLoading: boolean
  listError: string | null
  refreshList: () => void

  // Active session
  selectedSessionId: string | null
  selectSession: (sid: string | null) => void

  // Transcript
  lines: TranscriptLine[]
  totalLines: number | null
  transcriptLoading: boolean
  transcriptError: string | null
  loadMore: () => void
  /**
   * Whether the selected session is still being written (mtime within the
   * last ~10 min, no shutdown marker). Derived from `SessionSummary.isOngoing`.
   * Only an ongoing session is eligible for live-tailing; a closed historical
   * transcript never polls. `false` when unknown or closed.
   */
  isOngoing: boolean
  /**
   * User "follow tail" toggle. DEFAULTS OFF — a read-only history browser must
   * not poll unless the user explicitly opts in AND the session is ongoing.
   * When both `followTail` and `isOngoing` are true, the hook polls the .jsonl
   * for appended lines; otherwise it never sets up an interval (audit C1).
   */
  followTail: boolean
  setFollowTail: (on: boolean) => void
  /**
   * Set when a live-tail poll hits a TERMINAL backend failure
   * (binary_missing, or repeated session_not_found) — the loop stops and
   * surfaces this instead of silently looking "live" forever (audit: tail
   * fail-fast). Transient errors are retried on the next tick and do NOT set
   * this. `null` when tailing is healthy or off.
   */
  tailError: string | null

  // Context breakdown
  breakdown: ContextBreakdownResponse | null
  breakdownLoading: boolean
  breakdownError: string | null
  /**
   * 0-based JSONL line index the right panel is pinned to. The
   * breakdown shows the latest captured `/context` snapshot AT OR
   * BEFORE this index. `null` = pinned to "latest" (most recent
   * snapshot in the file).
   */
  pinnedLineIndex: number | null
  /** Pin the breakdown panel to the snapshot at-or-before `lineIndex`. */
  pinBreakdownTo: (lineIndex: number | null) => void

  // Search
  query: string
  setQuery: (q: string) => void
  matches: HighlightedMatch[]
  matchIndex: number | null
  setMatchIndex: (i: number | null) => void
  searching: boolean
  searchError: string | null
  prevMatch: () => void
  nextMatch: () => void
  clearSearch: () => void
}

/**
 * Read the current URL's `sid` query parameter. Returns null on server.
 */
function readUrlSid(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab !== 'sessions') return null
    const sid = params.get('sid')
    return sid && sid.length > 0 ? sid : null
  } catch {
    return null
  }
}

/**
 * Mirror the selected sid back into the URL. Uses replaceState so the user's
 * back-button history does not fill up with every selection.
 */
function writeUrlSid(sid: string | null) {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (sid) {
      url.searchParams.set('tab', 'sessions')
      url.searchParams.set('sid', sid)
    } else {
      // keep tab=sessions but drop sid
      url.searchParams.delete('sid')
    }
    window.history.replaceState({}, '', url.toString())
  } catch {
    /* ignore — URL mutation is best-effort */
  }
}

export function useJsonlSession(options: UseJsonlSessionOptions): UseJsonlSessionApi {
  const { agentId, pageSize = DEFAULT_PAGE_SIZE, syncUrl = true } = options

  // Sessions list ---------------------------------------------------------
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [listReloadTick, setListReloadTick] = useState(0)

  useEffect(() => {
    if (!agentId) {
      setSessions([])
      setProjectDir(null)
      setListError(null)
      return
    }
    const ctrl = new AbortController()
    setListLoading(true)
    setListError(null)
    fetchSessionsList(agentId, ctrl.signal)
      .then(r => {
        setSessions(r.sessions)
        setProjectDir(r.projectDir)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setListError((err as Error).message)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setListLoading(false)
      })
    return () => ctrl.abort()
  }, [agentId, listReloadTick])

  const refreshList = useCallback(() => {
    setListReloadTick(t => t + 1)
  }, [])

  // Selected session ------------------------------------------------------
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => readUrlSid())

  // If the URL carries a sid on mount that's not yet in the sessions list,
  // we keep it — the transcript loader uses the id verbatim (the server
  // validates it). When the list finally arrives, we don't clobber the
  // user's selection.

  // Sync URL when selection changes. Guarded by syncUrl flag.
  useEffect(() => {
    if (!syncUrl) return
    writeUrlSid(selectedSessionId)
  }, [selectedSessionId, syncUrl])

  const selectSession = useCallback((sid: string | null) => {
    setSelectedSessionId(sid)
  }, [])

  // Transcript ------------------------------------------------------------
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [totalLines, setTotalLines] = useState<number | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const nextFromRef = useRef<number>(0)
  // SINGLE abortable handle for the CURRENT range read (initial-load,
  // loadMore, OR live-tail). Every range read registers here and clears it in
  // its own `finally` — but only if it still owns the slot
  // (`inFlightRef.current === ctrl`), so a later read that clobbered the slot
  // is never wrongly nulled (audit MAJOR: loadMore used to leak its controller).
  const inFlightRef = useRef<AbortController | null>(null)
  // tsMs of the last RENDERED line, so an appended page's carry-forward seeds
  // from the true previous tsMs (not 0) across page boundaries. Kept in a ref
  // because the append paths read it synchronously inside async callbacks.
  const lastTsMsRef = useRef<number>(0)
  // TRUE end-of-file flag — set ONLY when a range read returns fewer than
  // `pageSize` raw rows. This is the authoritative EOF signal; `totalLines`
  // (which may be seeded from the lazy `messageCount` hint) is a DISPLAY value
  // and must NOT be used to short-circuit `loadMore` — `messageCount` counts
  // messages, not raw JSONL lines, so it can be < the real line count and
  // would otherwise wedge `loadMore` before the file's tail is loaded (a real
  // risk now that live-tail no longer backfills by default).
  const endReachedRef = useRef<boolean>(false)
  // Mirror of selectedSessionId read synchronously AFTER an await to reject a
  // stale append into a newly-selected session (audit C3: cross-session
  // contamination). A closure-captured `reqSid` is compared against this.
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId)
  useEffect(() => { selectedSessionIdRef.current = selectedSessionId }, [selectedSessionId])

  // Follow-tail toggle — DEFAULTS OFF (audit C1: no unconditional polling on a
  // read-only history browser). Only an ONGOING session that the user has
  // opted into following is live-tailed. Reset to OFF on every session switch
  // so following one session never silently follows the next.
  const [followTail, setFollowTail] = useState(false)
  const [tailError, setTailError] = useState<string | null>(null)
  useEffect(() => {
    setFollowTail(false)
    setTailError(null)
  }, [selectedSessionId])

  // Stable ref to the latest sessions array so polling / live-tail effects
  // can look up `summary.path` without putting `sessions` in their dep
  // arrays. Putting `sessions` in deps causes the transcript-reset and
  // breakdown-reset effects to fire every poll (because `setSessions`
  // creates a new array reference even when content is unchanged), which
  // wipes `lines` and re-loads page 0 every 2 s — the UI becomes
  // unreadable. Reading via a ref keeps the path resolution correct
  // without coupling these effects to the polling interval.
  const sessionsRef = useRef(sessions)
  useEffect(() => { sessionsRef.current = sessions }, [sessions])

  // Memoize the resolved absolute path for the selected session. This is
  // stable across poll-tick re-renders (the path doesn't change once the
  // file exists), so effects keyed on it don't fire on every list refresh —
  // but they DO fire exactly once when the URL-direct-selected session's
  // summary finally arrives, fixing the "load before list" race that
  // produced `range_failed:404:session_not_found` at initial mount.
  const selectedSessionPath = useMemo(() => {
    if (!selectedSessionId) return undefined
    return sessions.find(s => s.id === selectedSessionId)?.path
  }, [sessions, selectedSessionId])

  // Whether the selected session is still being written. Derived from the
  // session summary's `isOngoing` flag (mtime within ~10 min, no shutdown
  // marker — see SessionSummary). `false` when unknown or closed. Gates
  // live-tailing: a closed historical transcript is NEVER polled (audit C1).
  const isOngoing = useMemo(() => {
    if (!selectedSessionId) return false
    return sessions.find(s => s.id === selectedSessionId)?.isOngoing === true
  }, [sessions, selectedSessionId])

  // Reset + load first page whenever the selected sid changes.
  useEffect(() => {
    if (inFlightRef.current) {
      inFlightRef.current.abort()
      inFlightRef.current = null
    }
    setLines([])
    setTotalLines(null)
    setTranscriptError(null)
    nextFromRef.current = 0
    lastTsMsRef.current = 0
    endReachedRef.current = false

    if (!selectedSessionId) return

    // If the sessions list hasn't resolved yet, defer the initial fetch
    // until the path is known. Without `?path=` the API can't resolve the
    // sid across Next.js dev workers (per-process `sidToPath` cache), so
    // firing the request now would 404 and leave a permanent
    // `range_failed:404:session_not_found` error in the UI even though
    // the session is perfectly loadable.
    //
    // The exception: `listLoading === false` AND `selectedSessionPath`
    // still undefined means the session genuinely is not in the list
    // (deleted, or the user passed a stale URL sid) — let the request go
    // through so the user sees a real error instead of a stuck spinner.
    if (selectedSessionPath === undefined && listLoading) return

    // Resolve the session's line count if known from the list. We read
    // via the ref so a list-refresh (size/mtime tick) does NOT fire this
    // effect again — fixing the "transcript clears every 2 s" bug.
    const summary = sessionsRef.current.find(s => s.id === selectedSessionId)
    const hintedCount = summary?.messageCount ?? null
    setTotalLines(hintedCount)
    const sessionPath = selectedSessionPath

    const ctrl = new AbortController()
    inFlightRef.current = ctrl
    setTranscriptLoading(true)

    fetchRange(selectedSessionId, 0, pageSize - 1, sessionPath, ctrl.signal)
      .then(r => {
        if (ctrl.signal.aborted) return
        // normalizeLines drops metadata-only records (custom-title,
        // attachment, etc.) from the rendered list. The server-side cursor
        // (`nextFromRef`) advances by the RAW count so subsequent range
        // requests pick up where this one left off. Seed tsMs carry-forward
        // from 0 (start of file).
        const normalized = normalizeLines(r.lines, 0, 0)
        setLines(normalized)
        nextFromRef.current = r.lines.length
        if (normalized.length > 0) lastTsMsRef.current = normalized[normalized.length - 1].tsMs
        // If the server returned fewer than pageSize lines, the file ends here.
        if (r.lines.length < pageSize) {
          endReachedRef.current = true
          setTotalLines(prev => (prev === null ? r.lines.length : prev))
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setTranscriptError((err as Error).message)
      })
      .finally(() => {
        // Clear the in-flight slot only if we still own it (a session switch
        // may have replaced it with a newer controller already).
        if (inFlightRef.current === ctrl) inFlightRef.current = null
        if (!ctrl.signal.aborted) setTranscriptLoading(false)
      })

    return () => {
      ctrl.abort()
    }
    // selectedSessionPath + listLoading are in deps so the effect re-fires
    // exactly once when a URL-direct selection's summary arrives — without
    // them, the initial load races the sessions list and 404s against the
    // per-worker sidToPath cache.
  }, [selectedSessionId, pageSize, selectedSessionPath, listLoading])

  /**
   * Read ONE page starting at the current cursor (`nextFromRef`) and append
   * the visible rows. Shared by `loadMore` (user scroll) AND the live-tail
   * tick — routing both through this single function with one `inFlightRef`
   * guard is what eliminates the loadMore-vs-tail race (audit C2: both used to
   * capture the same `from`, fetch the same range, append duplicates, and
   * advance the cursor once) and the cross-session contamination (audit C3:
   * a stale resolve appending into a newly-selected session).
   *
   * Returns `true` iff visible rows were appended (the tail uses this to
   * decide whether to refresh the breakdown). Throws to its caller on fetch
   * failure (the tail catches+classifies; loadMore surfaces into transcriptError).
   *
   * @param isTail  true when called from the poll tick (suppresses the
   *                user-facing loading spinner so an idle poll stays calm).
   */
  const appendRange = useCallback(
    async (isTail: boolean): Promise<boolean> => {
      const sid = selectedSessionId
      if (!sid) return false
      // Single-flight: if ANY range read (initial-load, loadMore, or a prior
      // tail) is in flight, skip. This is the mutual exclusion that prevents
      // the duplicate-append / cursor-corruption race.
      if (inFlightRef.current) return false

      // End-of-file short-circuit for loadMore ONLY, keyed on the AUTHORITATIVE
      // EOF flag (a prior short page), never on the messageCount-seeded
      // `totalLines`. The tail must ALWAYS re-probe — that is how it discovers
      // the file grew (a `<pageSize` read at EOF, then more bytes later).
      if (!isTail && endReachedRef.current) return false

      const from = nextFromRef.current
      const summary = sessionsRef.current.find(s => s.id === sid)
      const sessionPath = summary?.path

      const ctrl = new AbortController()
      inFlightRef.current = ctrl
      if (!isTail) setTranscriptLoading(true)
      try {
        const r = await fetchRange(sid, from, from + pageSize - 1, sessionPath, ctrl.signal)
        // Reject a resolve that lost the race to a session switch: either this
        // controller was aborted, or the active session changed under us.
        if (ctrl.signal.aborted || selectedSessionIdRef.current !== sid) return false
        if (r.lines.length === 0) {
          // No bytes at the cursor. For loadMore that's EOF; for a tail it just
          // means the file hasn't grown — mark EOF either way (a later tail
          // read that returns rows clears it again below).
          endReachedRef.current = true
          setTotalLines(prev => (prev === null ? from : prev))
          return false
        }
        const normalized = normalizeLines(r.lines, from, lastTsMsRef.current)
        if (normalized.length > 0) {
          setLines(prev => [...prev, ...normalized])
          lastTsMsRef.current = normalized[normalized.length - 1].tsMs
        }
        // Cursor advances by RAW count (metadata rows were filtered out of the
        // rendered list but DO occupy file offsets).
        nextFromRef.current = from + r.lines.length
        if (r.lines.length < pageSize) {
          // Short page → end of file reached. (A subsequent tail read may grow
          // past this if the ongoing session appends more.)
          endReachedRef.current = true
          setTotalLines(prev =>
            prev === null ? from + r.lines.length : Math.max(prev, from + r.lines.length),
          )
        } else {
          // A full page means there is more to read — clear any stale EOF so the
          // next loadMore continues, and bump totalLines for the virtualizer.
          endReachedRef.current = false
          setTotalLines(prev => (prev === null ? null : Math.max(prev, from + r.lines.length)))
        }
        return normalized.length > 0
      } catch (err: unknown) {
        // An abort is NOT a real failure: a session switch (or this effect's
        // own teardown) aborted the controller. Swallow it as a clean no-op so
        // it never surfaces as `transcriptError`/`tailError`. Re-throw genuine
        // fetch failures so loadMore surfaces them and the tail classifies them.
        if (ctrl.signal.aborted) return false
        throw err
      } finally {
        // Only clear the slot if we still own it (a session switch may already
        // have installed a newer controller — never null someone else's).
        if (inFlightRef.current === ctrl) inFlightRef.current = null
        if (!isTail && !ctrl.signal.aborted) setTranscriptLoading(false)
      }
    },
    // `totalLines` is intentionally NOT a dep — `appendRange` no longer reads
    // it (EOF is keyed on `endReachedRef`), so depending on it would needlessly
    // re-create the callback (and tear down the tail effect) on every count bump.
    [selectedSessionId, pageSize],
  )

  const loadMore = useCallback(() => {
    void appendRange(false).catch((err: unknown) => {
      // appendRange only throws on a fetch failure; surface it like before.
      setTranscriptError((err as Error).message)
    })
  }, [appendRange])

  // Context breakdown ----------------------------------------------------
  const [breakdown, setBreakdown] = useState<ContextBreakdownResponse | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownError, setBreakdownError] = useState<string | null>(null)
  const [breakdownReloadTick, setBreakdownReloadTick] = useState(0)
  /**
   * Pinned line-index cursor for the breakdown panel. `null` means
   * "show the latest snapshot in the file". When the user clicks a
   * transcript bubble the panel pins to that bubble's `lineIndex` so
   * the right panel reflects what Claude saw at THAT message instead
   * of always showing the most recent one. Reset to `null` whenever
   * the selected session changes.
   */
  const [pinnedLineIndex, setPinnedLineIndex] = useState<number | null>(null)
  const pinBreakdownTo = useCallback((lineIndex: number | null) => {
    setPinnedLineIndex(lineIndex)
  }, [])

  // Reset breakdown ONLY when the selected session changes. Live-tail
  // re-fetches keep the previous breakdown visible while the new one
  // loads (avoids the "context panel goes empty for ~500 ms every 2 s"
  // flicker the user reported).
  useEffect(() => {
    setBreakdown(null)
    setBreakdownError(null)
    setPinnedLineIndex(null)
  }, [selectedSessionId])

  useEffect(() => {
    if (!selectedSessionId) return
    // Same load-before-list guard as the transcript initial-load effect:
    // defer until either the path is resolved or the list has finished
    // loading. Otherwise the breakdown 404s against the per-worker
    // sidToPath cache and surfaces a transient error in the panel.
    if (selectedSessionPath === undefined && listLoading) return
    const sessionPath = selectedSessionPath
    const ctrl = new AbortController()
    setBreakdownLoading(true)
    fetchContextBreakdown(selectedSessionId, sessionPath, pinnedLineIndex, ctrl.signal)
      .then(r => {
        if (ctrl.signal.aborted) return
        setBreakdown(r)
        setBreakdownError(null)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setBreakdownError((err as Error).message)
        // Keep the previously-loaded breakdown visible if a poll-tick
        // re-fetch fails — a transient error should NOT blank the panel.
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBreakdownLoading(false)
      })
    return () => ctrl.abort()
    // selectedSessionPath + listLoading are in deps so the effect re-fires
    // exactly once when a URL-direct selection's summary arrives — see the
    // transcript initial-load effect for the same race fix. Also re-fires
    // when the user pins the panel to a different transcript message so
    // the displayed snapshot follows their selection.
  }, [selectedSessionId, breakdownReloadTick, selectedSessionPath, listLoading, pinnedLineIndex])

  // Live-tail polling -----------------------------------------------------
  // GATED: the interval is set up ONLY when the session is ONGOING and the
  // user has turned `followTail` ON (audit C1 — a closed historical transcript
  // is never polled, and even an ongoing one is not polled until the user opts
  // in). When the gate is closed, this effect installs nothing and the hook
  // does zero background work.
  //
  // Each tick delegates to `appendRange(true)`, which carries the single-flight
  // guard (C2) and the cross-session reject (C3). On a genuine append, the
  // breakdown is refreshed (new lines → new token totals).
  //
  // We do NOT call refreshList() here — the server-side reader self-invalidates
  // its cache on every open(), so the range fetch sees fresh bytes; a list
  // re-fetch would churn the `sessions` reference and wipe scroll state.
  //
  // Polling pauses when document.visibilityState is hidden and resumes on
  // visibilitychange so a foregrounded tab gets fresh content immediately.
  //
  // Errors are CLASSIFIED, not swallowed (audit: tail fail-fast):
  //   - terminal (binary_missing) → surface into `tailError`, stop the loop.
  //   - transient → retry next tick; after TAIL_MAX_TRANSIENT_FAILURES
  //     consecutive failures, surface and stop (don't poll a broken backend
  //     forever every 2 s).
  useEffect(() => {
    // The gate. A genuinely-live, followed session still updates; everything
    // else installs no interval at all.
    if (!selectedSessionId) return
    if (!isOngoing || !followTail) return

    let cancelled = false
    let consecutiveFailures = 0
    let intervalId: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      cancelled = true
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    const tick = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const appended = await appendRange(true)
        if (cancelled) return
        consecutiveFailures = 0
        // New visible lines arrived → token totals changed → refresh breakdown.
        if (appended) setBreakdownReloadTick(t => t + 1)
      } catch (err: unknown) {
        if (cancelled) return
        const message = (err as Error).message
        if (isTerminalTailError(message)) {
          setTailError(message)
          stop()
          return
        }
        consecutiveFailures += 1
        if (consecutiveFailures >= TAIL_MAX_TRANSIENT_FAILURES) {
          setTailError(message)
          stop()
        }
        // else: transient — let the next tick retry.
      }
    }

    intervalId = setInterval(tick, LIVE_TAIL_INTERVAL_MS)

    const onVisChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void tick()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisChange)
    }

    return () => {
      stop()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisChange)
      }
    }
  }, [selectedSessionId, isOngoing, followTail, appendRange])

  // Search ---------------------------------------------------------------
  const [query, setQueryRaw] = useState('')
  const [matches, setMatches] = useState<HighlightedMatch[]>([])
  const [matchIndex, setMatchIndex] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchCtrlRef = useRef<AbortController | null>(null)

  // Debounce 250 ms per acceptance criterion #5.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (searchCtrlRef.current) {
      searchCtrlRef.current.abort()
      searchCtrlRef.current = null
    }
    if (!selectedSessionId || query.trim() === '') {
      setMatches([])
      setMatchIndex(null)
      setSearching(false)
      setSearchError(null)
      return
    }
    searchTimerRef.current = setTimeout(() => {
      const summary = sessionsRef.current.find(s => s.id === selectedSessionId)
      const sessionPath = summary?.path
      const ctrl = new AbortController()
      searchCtrlRef.current = ctrl
      setSearching(true)
      setSearchError(null)
      fetchSearch(selectedSessionId, query, sessionPath, { caseInsensitive: true, limit: 500 }, ctrl.signal)
        .then(r => {
          if (ctrl.signal.aborted) return
          setMatches(r.matches)
          setMatchIndex(r.matches.length > 0 ? 0 : null)
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return
          setSearchError((err as Error).message)
          setMatches([])
          setMatchIndex(null)
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false)
        })
    }, 250)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [selectedSessionId, query])

  const setQuery = useCallback((q: string) => setQueryRaw(q), [])

  const nextMatch = useCallback(() => {
    setMatchIndex(prev => {
      if (matches.length === 0) return null
      if (prev === null) return 0
      return (prev + 1) % matches.length
    })
  }, [matches.length])

  const prevMatch = useCallback(() => {
    setMatchIndex(prev => {
      if (matches.length === 0) return null
      if (prev === null) return matches.length - 1
      return (prev - 1 + matches.length) % matches.length
    })
  }, [matches.length])

  const clearSearch = useCallback(() => {
    setQueryRaw('')
    setMatches([])
    setMatchIndex(null)
    setSearchError(null)
  }, [])

  return useMemo<UseJsonlSessionApi>(() => ({
    sessions,
    projectDir,
    listLoading,
    listError,
    refreshList,

    selectedSessionId,
    selectSession,

    lines,
    totalLines,
    transcriptLoading,
    transcriptError,
    loadMore,
    isOngoing,
    followTail,
    setFollowTail,
    tailError,

    breakdown,
    breakdownLoading,
    breakdownError,
    pinnedLineIndex,
    pinBreakdownTo,

    query,
    setQuery,
    matches,
    matchIndex,
    setMatchIndex,
    searching,
    searchError,
    prevMatch,
    nextMatch,
    clearSearch,
  }), [
    sessions,
    projectDir,
    listLoading,
    listError,
    refreshList,
    selectedSessionId,
    selectSession,
    lines,
    totalLines,
    transcriptLoading,
    transcriptError,
    loadMore,
    isOngoing,
    followTail,
    setFollowTail,
    tailError,
    breakdown,
    breakdownLoading,
    breakdownError,
    pinnedLineIndex,
    pinBreakdownTo,
    query,
    setQuery,
    matches,
    matchIndex,
    searching,
    searchError,
    prevMatch,
    nextMatch,
    clearSearch,
  ])
}
