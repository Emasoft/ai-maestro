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
 * mid-session) which carry NO user-visible content — they exist only as
 * structural / metadata markers (custom title, agent name, permission
 * mode, attachments, file-history snapshots, last-prompt anchor).
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
 */
const HIDDEN_RECORD_TYPES = new Set([
  'last-prompt',
  'custom-title',
  'agent-name',
  'permission-mode',
  'file-history-snapshot',
  'attachment',
  // Phase 5 stream markers — emitted by Claude Code 2.x but irrelevant
  // to a chat transcript reader.
  'queued-prompt',
  'compact-summary-anchor',
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
  const content: unknown = raw.message?.content ?? raw.content ?? raw.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block)
      } else if (block && typeof block === 'object') {
        const b = block as { type?: string; text?: string }
        if (typeof b.text === 'string') parts.push(b.text)
      }
    }
    return parts.join('\n\n')
  }
  return ''
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
 * Convert a raw JSONL record into a renderable TranscriptLine.
 *
 * Returns `null` for metadata-only records (custom-title, agent-name,
 * etc.) so they're filtered out of the transcript at build time.
 * Callers MUST treat null as "skip this line" — the lineIndex passed in
 * is preserved on real records so the server-side range numbering
 * stays consistent (the filter is purely a render-side cull).
 */
export function normalizeLine(raw: unknown, lineIndex: number): TranscriptLine | null {
  const r = (raw ?? {}) as RawRecord
  if (isMetadataOnlyRecord(r)) return null
  const role = extractRole(r)
  const { isToolEvent, toolName, toolInput, toolResult, toolUseId } = extractToolInfo(r)
  return {
    lineIndex,
    role,
    text: extractText(r),
    usage: extractUsage(r),
    timestamp: typeof r.timestamp === 'string' ? r.timestamp : undefined,
    toolName,
    toolInput,
    toolResult,
    toolUseId,
    isToolEvent,
    raw,
  }
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
  signal?: AbortSignal,
): Promise<ContextBreakdownResponse> {
  const res = await fetch(
    `/api/sessions-browser/sessions/${encodeURIComponent(sid)}/context-breakdown${pathQuery(path)}`,
    { method: 'GET', credentials: 'include', signal },
  )
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

  // Context breakdown
  breakdown: ContextBreakdownResponse | null
  breakdownLoading: boolean
  breakdownError: string | null

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
  const inFlightRef = useRef<AbortController | null>(null)

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

    if (!selectedSessionId) return

    // Resolve the session's line count if known from the list. We read
    // via the ref so a list-refresh (size/mtime tick) does NOT fire this
    // effect again — fixing the "transcript clears every 2 s" bug.
    const summary = sessionsRef.current.find(s => s.id === selectedSessionId)
    const hintedCount = summary?.messageCount ?? null
    setTotalLines(hintedCount)
    const sessionPath = summary?.path

    const ctrl = new AbortController()
    inFlightRef.current = ctrl
    setTranscriptLoading(true)

    fetchRange(selectedSessionId, 0, pageSize - 1, sessionPath, ctrl.signal)
      .then(r => {
        if (ctrl.signal.aborted) return
        // normalizeLine returns null for metadata-only records (custom-title,
        // attachment, etc.) — filter them out of the rendered list. The
        // server-side cursor (`nextFromRef`) advances by the RAW count so
        // subsequent range requests pick up where this one left off.
        const normalized = r.lines
          .map((raw, i) => normalizeLine(raw, i))
          .filter((l): l is TranscriptLine => l !== null)
        setLines(normalized)
        nextFromRef.current = r.lines.length
        // If the server returned fewer than pageSize lines, the file ends here.
        if (r.lines.length < pageSize) {
          setTotalLines(prev => (prev === null ? r.lines.length : prev))
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setTranscriptError((err as Error).message)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setTranscriptLoading(false)
      })

    return () => {
      ctrl.abort()
    }
  }, [selectedSessionId, pageSize])

  const loadMore = useCallback(() => {
    if (!selectedSessionId) return
    if (transcriptLoading) return
    const from = nextFromRef.current
    // If we know we've hit end-of-file, short-circuit.
    if (totalLines !== null && from >= totalLines) return

    const summary = sessionsRef.current.find(s => s.id === selectedSessionId)
    const sessionPath = summary?.path

    const ctrl = new AbortController()
    inFlightRef.current = ctrl
    setTranscriptLoading(true)
    fetchRange(selectedSessionId, from, from + pageSize - 1, sessionPath, ctrl.signal)
      .then(r => {
        if (ctrl.signal.aborted) return
        // Filter metadata-only records — see comment on the initial-load
        // branch above. Cursor advances by raw count, list grows by visible.
        const normalized = r.lines
          .map((raw, i) => normalizeLine(raw, from + i))
          .filter((l): l is TranscriptLine => l !== null)
        if (r.lines.length === 0) {
          setTotalLines(prev => (prev === null ? from : prev))
          return
        }
        setLines(prev => [...prev, ...normalized])
        nextFromRef.current = from + r.lines.length
        if (r.lines.length < pageSize) {
          setTotalLines(from + r.lines.length)
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setTranscriptError((err as Error).message)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setTranscriptLoading(false)
      })
  }, [selectedSessionId, pageSize, transcriptLoading, totalLines])

  // Context breakdown ----------------------------------------------------
  const [breakdown, setBreakdown] = useState<ContextBreakdownResponse | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownError, setBreakdownError] = useState<string | null>(null)
  const [breakdownReloadTick, setBreakdownReloadTick] = useState(0)

  // Reset breakdown ONLY when the selected session changes. Live-tail
  // re-fetches keep the previous breakdown visible while the new one
  // loads (avoids the "context panel goes empty for ~500 ms every 2 s"
  // flicker the user reported).
  useEffect(() => {
    setBreakdown(null)
    setBreakdownError(null)
  }, [selectedSessionId])

  useEffect(() => {
    if (!selectedSessionId) return
    const summary = sessionsRef.current.find(s => s.id === selectedSessionId)
    const sessionPath = summary?.path
    const ctrl = new AbortController()
    setBreakdownLoading(true)
    fetchContextBreakdown(selectedSessionId, sessionPath, ctrl.signal)
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
  }, [selectedSessionId, breakdownReloadTick])

  // Live-tail polling -----------------------------------------------------
  // While a session is selected, poll every LIVE_TAIL_INTERVAL_MS to:
  //   1. Append any new lines beyond `nextFromRef.current` (tails the .jsonl).
  //   2. Re-fetch the context breakdown ONLY when new lines actually
  //      arrived (saves a request when the file is idle).
  //
  // We do NOT call refreshList() here. The server-side jsonl-reader.ts
  // self-invalidates its cache via statSync on every open(), so the
  // range fetch automatically sees fresh bytes — the sessions list
  // re-fetch is unnecessary AND was the cause of constant React
  // re-renders (it changed the `sessions` reference on every poll,
  // which fired transcript-reset / breakdown-reset effects → wiped
  // `lines` → reset scroll → unreadable UI).
  //
  // Polling pauses when document.visibilityState is hidden so a
  // backgrounded tab doesn't hammer the reader. Resumes immediately on
  // visibility change so foregrounding the tab gives fresh content
  // without a 2 s lag.
  const LIVE_TAIL_INTERVAL_MS = 2000
  useEffect(() => {
    if (!selectedSessionId) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const tick = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

      const summary = sessionsRef.current.find(s => s.id === selectedSessionId)
      const sessionPath = summary?.path
      const from = nextFromRef.current

      // Tail: ask for `pageSize` lines starting at the current end pointer.
      // If the file didn't grow, we get an empty array — no setState calls,
      // no re-render, no scroll-position disturbance. THIS is what makes
      // the UI calm during idle periods.
      try {
        const r = await fetchRange(selectedSessionId, from, from + pageSize - 1, sessionPath)
        if (cancelled) return
        if (r.lines.length > 0) {
          // Filter metadata-only records (see filter comment in the initial
          // load and loadMore paths). Cursor advances by raw count.
          const normalized = r.lines
            .map((raw, i) => normalizeLine(raw, from + i))
            .filter((l): l is TranscriptLine => l !== null)
          if (normalized.length > 0) {
            setLines(prev => [...prev, ...normalized])
          }
          nextFromRef.current = from + r.lines.length
          // If we now know there are more rows than the prior totalLines hint,
          // bump the count so virtualized scrollbacks can size correctly.
          setTotalLines(prev =>
            prev === null ? null : Math.max(prev, from + r.lines.length),
          )
          // New lines arrived → token totals changed → refresh breakdown.
          setBreakdownReloadTick(t => t + 1)
        }
      } catch {
        // Swallow — polling is best-effort. The next tick will try again.
      }
    }

    intervalId = setInterval(tick, LIVE_TAIL_INTERVAL_MS)

    const onVisChange = () => {
      // Resume immediately when the tab returns to foreground so the user
      // sees fresh content without waiting for the next tick boundary.
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        tick()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisChange)
    }

    return () => {
      cancelled = true
      if (intervalId !== null) clearInterval(intervalId)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisChange)
      }
    }
  }, [selectedSessionId, pageSize])

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

    breakdown,
    breakdownLoading,
    breakdownError,

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
    breakdown,
    breakdownLoading,
    breakdownError,
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
