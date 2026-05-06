/**
 * Long-lived Node wrapper around the `aim-jsonl-reader` Rust binary.
 *
 * One reader process per dashboard. Lazily spawned on first request.
 * Self-healing: if the child dies, the next call respawns it.
 *
 * Protocol: NDJSON over stdio. One JSON request per line in, one JSON
 * response per line out. Requests are serialized on a FIFO queue so
 * the line-oriented protocol doesn't interleave.
 *
 * Session lifecycle: `open()` allocates a Rust-side handle + id; callers
 * must keep using that id for subsequent `readRange` / `search` /
 * `contextBreakdown` calls. Idle sessions (no touches for 30 min) are
 * auto-closed via `{"cmd":"close"}`.
 *
 * See TRDD-d46b42e9 §5 and Rust side `rust-tools/aim-jsonl-reader/src/`.
 */

import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import path from 'path'
import { EventEmitter } from 'events'

import type {
  JsonlReaderRequest,
  JsonlReaderResponse,
  OpenOkResponse,
  ReadRangeOkResponse,
  SearchOkResponse,
  ContextBreakdownOkResponse,
  AnalyzeFileMetadataOkResponse,
  CloseOkResponse,
  SearchKind,
  OpenTimelineFileInput,
  OpenTimelineOkResponse,
  ReadTimelineRangeOkResponse,
  SearchTimelineOkResponse,
  ContextAtOkResponse,
} from '@/lib/jsonl-reader-protocol'
import { isErrorResponse } from '@/lib/jsonl-reader-protocol'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Idle TTL before we auto-close a session handle. 30 min per spec §5.3. */
export const IDLE_SESSION_TTL_MS = 30 * 60 * 1000

/** How often we sweep idle sessions. 1 min keeps resolution cheap. */
const IDLE_SWEEP_INTERVAL_MS = 60 * 1000

/**
 * Path to the Rust binary. Phase 1 build hook drops it here.
 * Respect BUILD_TARGET= override if set by the build script, but default
 * to the stable scripts/aim-jsonl-reader location.
 */
function resolveBinaryPath(): string {
  const override = process.env.AIM_JSONL_READER_PATH
  if (override && override.length > 0) return override
  // Walk up from cwd to find project root (identified by scripts/aim-jsonl-reader sibling of package.json)
  // Fallback: <cwd>/scripts/aim-jsonl-reader
  const candidates = [
    path.resolve(process.cwd(), 'scripts', 'aim-jsonl-reader'),
    path.resolve(__dirname, '..', 'scripts', 'aim-jsonl-reader'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  // Return the cwd-relative path even if missing — the spawn will fail with
  // ENOENT, which our error path converts to a 503-friendly message.
  return candidates[0]
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class JsonlReaderBinaryMissingError extends Error {
  readonly code = 'binary_missing'
  readonly binaryPath: string
  constructor(binaryPath: string) {
    super(
      `aim-jsonl-reader binary not found at ${binaryPath}. ` +
        'Run `yarn build:jsonl-reader` first.',
    )
    this.binaryPath = binaryPath
    this.name = 'JsonlReaderBinaryMissingError'
  }
}

export class JsonlReaderProtocolError extends Error {
  readonly code: string
  readonly detail?: string
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.code = code
    this.detail = detail
    this.name = 'JsonlReaderProtocolError'
  }
}

// ---------------------------------------------------------------------------
// JsonlReader
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: JsonlReaderResponse) => void
  reject: (err: Error) => void
}

interface OpenSessionEntry {
  /** The Rust side's sessionId. */
  sessionId: string
  /** Absolute path to the .jsonl file. */
  path: string
  /** Line count returned by open. */
  lineCount: number
  /** Last use timestamp (Date.now()). Updated on every request touching this session. */
  lastUsedAt: number
  /** File size at last open, used to detect appends since the snapshot. */
  size: number
  /** File mtime (ms since epoch) at last open. */
  mtimeMs: number
}

/**
 * Options for constructing a JsonlReader.
 *
 * `now` is injectable so fake-timer tests can exercise idle GC without
 * wall-clock waits.
 */
export interface JsonlReaderOptions {
  binaryPath?: string
  idleTtlMs?: number
  sweepIntervalMs?: number
  now?: () => number
  /**
   * When true, suppress automatic idle-sweep setInterval. Tests that
   * advance time manually prefer this so they can call `sweepIdleSessions()`
   * directly.
   */
  manualSweep?: boolean
}

export class JsonlReader extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private queue: PendingRequest[] = []
  /** Map: path → open session. One entry per unique path to dedupe opens. */
  private readonly sessionsByPath = new Map<string, OpenSessionEntry>()
  /** Map: sessionId → entry (for read/search/close). */
  private readonly sessionsById = new Map<string, OpenSessionEntry>()
  /**
   * Per-path open() locks. When two requests call `open(samePath)` in
   * parallel and the cache is stale, the SECOND caller MUST wait for
   * the FIRST to finish — otherwise both would issue close+open and
   * the in-flight operation of the first caller (read_range,
   * context_breakdown, search) would race against the second caller's
   * close, surfacing as `session_not_found`.
   *
   * Map entry is the in-flight Promise. New callers `await` it. The
   * entry is removed in a `finally` so subsequent callers re-enter
   * the real open path.
   */
  private readonly openLocks = new Map<string, Promise<OpenOkResponse>>()
  private sweepTimer: NodeJS.Timeout | null = null
  private readonly binaryPath: string
  private readonly idleTtlMs: number
  private readonly sweepIntervalMs: number
  private readonly manualSweep: boolean
  private readonly now: () => number
  private shuttingDown = false

  constructor(opts: JsonlReaderOptions = {}) {
    super()
    this.binaryPath = opts.binaryPath ?? resolveBinaryPath()
    this.idleTtlMs = opts.idleTtlMs ?? IDLE_SESSION_TTL_MS
    this.sweepIntervalMs = opts.sweepIntervalMs ?? IDLE_SWEEP_INTERVAL_MS
    this.manualSweep = opts.manualSweep ?? false
    this.now = opts.now ?? Date.now.bind(Date)
  }

  /** For diagnostics / the optional _debug route. */
  get openSessions(): ReadonlyMap<string, OpenSessionEntry> {
    return this.sessionsById
  }

  get isChildAlive(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed
  }

  /**
   * Spawn the child if needed. Idempotent.
   * @throws JsonlReaderBinaryMissingError if the binary is missing.
   */
  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.isChildAlive && this.child) return this.child

    if (!existsSync(this.binaryPath)) {
      throw new JsonlReaderBinaryMissingError(this.binaryPath)
    }

    const child = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    this.child = child
    this.stdoutBuffer = ''

    child.stdout.setEncoding('utf-8')
    child.stdout.on('data', (chunk: string) => this.onStdoutData(chunk))
    child.stderr.setEncoding('utf-8')
    child.stderr.on('data', (chunk: string) => {
      // Stderr is diagnostic only; emit for observers but never reject the queue.
      this.emit('stderr', chunk)
    })
    child.on('exit', (code, signal) => this.onChildExit(code, signal))
    child.on('error', (err) => {
      // Spawn/runtime error. Reject all pending requests and let next call respawn.
      this.drainQueueWithError(
        new JsonlReaderProtocolError('child_error', err.message),
      )
      this.child = null
    })

    // Start the idle-sweep timer on first spawn.
    if (!this.manualSweep && this.sweepTimer === null) {
      this.sweepTimer = setInterval(() => {
        this.sweepIdleSessions().catch((err) => this.emit('error', err))
      }, this.sweepIntervalMs)
      // Don't keep the event loop alive just for the sweep.
      this.sweepTimer.unref?.()
    }

    return child
  }

  private onStdoutData(chunk: string): void {
    this.stdoutBuffer += chunk
    // Split on newline; keep last partial segment in buffer.
    let nl: number
    // eslint-disable-next-line no-cond-assign
    while ((nl = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, nl).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1)
      if (!line) continue
      this.deliverResponse(line)
    }
  }

  private deliverResponse(line: string): void {
    let parsed: JsonlReaderResponse
    try {
      parsed = JSON.parse(line) as JsonlReaderResponse
    } catch (err) {
      const next = this.queue.shift()
      const wrapped = new JsonlReaderProtocolError(
        'bad_response',
        `failed to parse reader stdout line: ${(err as Error).message}`,
      )
      if (next) next.reject(wrapped)
      else this.emit('error', wrapped)
      return
    }

    const next = this.queue.shift()
    if (!next) {
      // Unexpected response with no pending request — surface as an event.
      this.emit('orphanResponse', parsed)
      return
    }
    next.resolve(parsed)
  }

  private onChildExit(_code: number | null, _signal: NodeJS.Signals | null): void {
    const err = new JsonlReaderProtocolError(
      'child_exited',
      'aim-jsonl-reader child process exited unexpectedly',
    )
    this.drainQueueWithError(err)
    this.child = null
    // Sessions on the Rust side are gone; clear our side too so re-opens
    // create fresh Rust-side handles.
    this.sessionsByPath.clear()
    this.sessionsById.clear()
    this.emit('childExit')
  }

  private drainQueueWithError(err: Error): void {
    const pending = this.queue.splice(0, this.queue.length)
    for (const p of pending) p.reject(err)
  }

  /**
   * Send a single request and await its response. Serializes via a FIFO queue
   * so the line-oriented NDJSON protocol is never interleaved.
   */
  private sendRequest(req: JsonlReaderRequest): Promise<JsonlReaderResponse> {
    return new Promise<JsonlReaderResponse>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = this.ensureChild()
      } catch (err) {
        return reject(err as Error)
      }
      const line = JSON.stringify(req) + '\n'
      this.queue.push({ resolve, reject })
      // stdin.write returns false when the OS buffer is full — we don't
      // block on drain because requests are small (<1 KB each). But if
      // the write fails synchronously, we must unwind the queue entry.
      try {
        const ok = child.stdin.write(line, (err) => {
          if (err) {
            // Remove our pending entry (should be the tail we just pushed).
            const idx = this.queue.findIndex((q) => q.resolve === resolve)
            if (idx !== -1) this.queue.splice(idx, 1)
            reject(err)
          }
        })
        if (!ok) {
          // Back-pressure; safe to continue, the OS buffers it.
        }
      } catch (err) {
        const idx = this.queue.findIndex((q) => q.resolve === resolve)
        if (idx !== -1) this.queue.splice(idx, 1)
        reject(err as Error)
      }
    })
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Open (or reuse) a Rust-side session handle for `filePath`.
   *
   * **Append-aware cache** (TRDD-d46b42e9 phase 6): the cached entry stores
   * the file's size + mtime at the moment of the open call. On subsequent
   * `open()`s, we re-stat the file and compare. If size or mtime changed
   * (the live agent appended new lines since the snapshot), we evict the
   * cache and tell Rust to re-open — only then will the new lines show up
   * in `read_range` / `context_breakdown` / `search`. Without this check
   * the UI sees a frozen transcript even though the file on disk keeps
   * growing.
   *
   * Re-stat is a single `statSync` (microseconds on a hot file in the
   * page cache) and runs once per open() — far cheaper than re-indexing
   * the whole file on every read. The Rust binary's own sidecar cache
   * makes the actual re-open fast (it diffs against the persistent
   * sparse-index file rather than re-scanning every line).
   */
  async open(filePath: string): Promise<OpenOkResponse> {
    // Serialize concurrent opens on the same path. See `openLocks`
    // doc comment — without this lock, parallel callers can race
    // each other's close+reopen and produce a transient
    // `session_not_found` for an in-flight read_range / context_breakdown.
    const inFlight = this.openLocks.get(filePath)
    if (inFlight) {
      return inFlight
    }
    const promise = this._openImpl(filePath).finally(() => {
      // Best-effort delete — even if the open threw, drop the lock
      // so the next caller can retry. The cache entry is only written
      // on success, so a failed open leaves no zombie state.
      this.openLocks.delete(filePath)
    })
    this.openLocks.set(filePath, promise)
    return promise
  }

  private async _openImpl(filePath: string): Promise<OpenOkResponse> {
    let currentSize: number | null = null
    let currentMtimeMs: number | null = null
    try {
      const st = statSync(filePath)
      currentSize = st.size
      currentMtimeMs = st.mtimeMs
    } catch {
      // File missing — let Rust raise the proper error code rather than
      // shadowing it here. We'll send the open and propagate whatever
      // protocol error comes back.
    }

    const existing = this.sessionsByPath.get(filePath)
    if (existing) {
      const stale =
        currentSize !== null &&
        currentMtimeMs !== null &&
        (existing.size !== currentSize || existing.mtimeMs !== currentMtimeMs)
      if (!stale) {
        existing.lastUsedAt = this.now()
        return {
          ok: true,
          sessionId: existing.sessionId,
          lineCount: existing.lineCount,
          // Subsequent re-opens on the server side — from the Rust process's
          // perspective — always reuse the sparse sidecar if present, so we
          // return `true` to reflect that the Node side is handing back a
          // cached handle. (The raw Rust reply flag is preserved only on the
          // first open.)
          indexed: true,
        }
      }
      // File grew or was rewritten. Evict the cached handle so Rust
      // reopens against the current snapshot. We also send a `close` so
      // the Rust side doesn't accumulate dead session entries.
      try {
        await this.sendRequest({ cmd: 'close', sessionId: existing.sessionId })
      } catch {
        // Best-effort — even if Rust never receives the close (e.g. it
        // already evicted the session), we drop our cache anyway.
      }
      this.sessionsByPath.delete(filePath)
      this.sessionsById.delete(existing.sessionId)
    }
    const resp = await this.sendRequest({ cmd: 'open', path: filePath })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    const openResp = resp as OpenOkResponse
    const entry: OpenSessionEntry = {
      sessionId: openResp.sessionId,
      path: filePath,
      lineCount: openResp.lineCount,
      lastUsedAt: this.now(),
      // Snapshot the file stats we used for cache invalidation. If the
      // earlier statSync threw, store 0/0 — the next open() will see the
      // real values as "different" and force another re-open, which is
      // safer than caching a "no info" sentinel forever.
      size: currentSize ?? 0,
      mtimeMs: currentMtimeMs ?? 0,
    }
    this.sessionsByPath.set(filePath, entry)
    this.sessionsById.set(openResp.sessionId, entry)
    return openResp
  }

  /**
   * Read lines [fromLine, toLine] inclusive from `sessionId`.
   */
  async readRange(sessionId: string, fromLine: number, toLine: number): Promise<ReadRangeOkResponse> {
    this.touch(sessionId)
    const resp = await this.sendRequest({
      cmd: 'read_range',
      sessionId,
      fromLine,
      toLine,
    })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    return resp as ReadRangeOkResponse
  }

  async search(
    sessionId: string,
    query: string,
    opts: { kind?: SearchKind; caseInsensitive?: boolean; limit?: number } = {},
  ): Promise<SearchOkResponse> {
    this.touch(sessionId)
    const resp = await this.sendRequest({
      cmd: 'search',
      sessionId,
      query,
      kind: opts.kind,
      caseInsensitive: opts.caseInsensitive,
      limit: opts.limit,
    })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    return resp as SearchOkResponse
  }

  async contextBreakdown(sessionId: string): Promise<ContextBreakdownOkResponse> {
    this.touch(sessionId)
    const resp = await this.sendRequest({ cmd: 'context_breakdown', sessionId })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    return resp as ContextBreakdownOkResponse
  }

  /**
   * Phase 5 §3.8 — run the streaming metadata analyzer on `filePath`.
   *
   * Unlike every other method on this class, `analyzeFileMetadata` takes a
   * raw absolute path — NOT a sessionId. The sessions-browser list calls
   * this BEFORE opening a Rust-side session handle so it can populate
   * divider-row previews, ongoing flags, and compaction counts without
   * paying for an index build.
   *
   * The child is still lazily spawned on first call (same FIFO queue and
   * self-healing as the rest of the API), and the call is still
   * serialized through the singleton Rust process, so concurrent callers
   * pipeline their requests on the queue.
   */
  async analyzeFileMetadata(filePath: string): Promise<AnalyzeFileMetadataOkResponse> {
    const resp = await this.sendRequest({ cmd: 'analyze_file_metadata', path: filePath })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    return resp as AnalyzeFileMetadataOkResponse
  }

  // -------------------------------------------------------------------------
  // Phase 6 — timeline commands. See jsonl-reader-protocol.ts for shape
  // docs and rust-tools/aim-jsonl-reader/src/timeline.rs for the backing
  // implementation. Unlike per-file `open`, timelines are NOT tracked
  // by the Node wrapper's session registry — they live only on the
  // Rust side, keyed by the returned timelineId. Callers that re-open
  // the same set of files will get a fresh timelineId (the Rust-side
  // id is deterministic, so it happens to match, but we do not rely
  // on that).
  // -------------------------------------------------------------------------

  /**
   * Open a cross-file timeline. Sends one `open_timeline` request with the
   * full list of {path, laneId} pairs. Returns the Rust-side manifest
   * (timelineId + total lines + per-lane summaries).
   */
  async openTimeline(
    files: OpenTimelineFileInput[],
  ): Promise<OpenTimelineOkResponse> {
    const resp = await this.sendRequest({ cmd: 'open_timeline', files })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    return resp as OpenTimelineOkResponse
  }

  /**
   * Read rows in the inclusive [fromGlobal, toGlobal] global-line range
   * on the given timeline. The Rust side binary-searches its stitched
   * sparse index and delegates to the per-file reader.
   */
  async readTimelineRange(
    timelineId: string,
    fromGlobal: number,
    toGlobal: number,
  ): Promise<ReadTimelineRangeOkResponse> {
    const resp = await this.sendRequest({
      cmd: 'read_timeline_range',
      timelineId,
      fromGlobal,
      toGlobal,
    })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    return resp as ReadTimelineRangeOkResponse
  }

  /**
   * Search every file in the timeline and return globally-sorted matches.
   * There is no match limit on the Rust side — callers that want top-N
   * should post-truncate. Rust defaults to `substring` kind with
   * case-insensitive=true when fields are omitted.
   */
  async searchTimeline(
    timelineId: string,
    query: string,
    opts: { kind?: SearchKind; caseInsensitive?: boolean } = {},
  ): Promise<SearchTimelineOkResponse> {
    const resp = await this.sendRequest({
      cmd: 'search_timeline',
      timelineId,
      query,
      kind: opts.kind,
      caseInsensitive: opts.caseInsensitive,
    })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    return resp as SearchTimelineOkResponse
  }

  /**
   * Compute a context-at-cursor breakdown plus phase history up to the
   * anchor. Exactly one of `anchorUuid` or `globalLineIndex` must be
   * provided — the Rust side rejects missing-anchor requests as
   * `invalid_request`.
   */
  async contextAt(
    timelineId: string,
    target: { anchorUuid?: string; globalLineIndex?: number },
  ): Promise<ContextAtOkResponse> {
    const resp = await this.sendRequest({
      cmd: 'context_at',
      timelineId,
      anchorUuid: target.anchorUuid,
      globalLineIndex: target.globalLineIndex,
    })
    if (isErrorResponse(resp)) {
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    return resp as ContextAtOkResponse
  }

  async close(sessionId: string): Promise<CloseOkResponse> {
    const entry = this.sessionsById.get(sessionId)
    // Send the close even if we don't know about this id locally — the
    // Rust side may still have it if our bookkeeping drifted.
    const resp = await this.sendRequest({ cmd: 'close', sessionId })
    if (isErrorResponse(resp)) {
      // session_not_found during close is benign — just clean our side.
      if (resp.error === 'session_not_found') {
        if (entry) {
          this.sessionsByPath.delete(entry.path)
          this.sessionsById.delete(entry.sessionId)
        }
        return { ok: true }
      }
      throw new JsonlReaderProtocolError(String(resp.error), resp.detail)
    }
    if (entry) {
      this.sessionsByPath.delete(entry.path)
      this.sessionsById.delete(entry.sessionId)
    }
    return resp as CloseOkResponse
  }

  /**
   * Refresh `lastUsedAt` for the given sessionId. Silent no-op when the
   * id isn't in our map — used before every operation that touches a
   * live session.
   */
  private touch(sessionId: string): void {
    const entry = this.sessionsById.get(sessionId)
    if (entry) entry.lastUsedAt = this.now()
  }

  /**
   * Scan for stale sessions and close them. Idempotent. Callers may
   * invoke directly (tests do this after advancing fake timers) or let
   * the internal interval do it.
   */
  async sweepIdleSessions(): Promise<void> {
    if (this.shuttingDown) return
    const cutoff = this.now() - this.idleTtlMs
    const toClose: OpenSessionEntry[] = []
    for (const entry of this.sessionsById.values()) {
      if (entry.lastUsedAt <= cutoff) toClose.push(entry)
    }
    for (const entry of toClose) {
      try {
        await this.close(entry.sessionId)
      } catch (err) {
        // Best-effort. Don't let one failure block the rest.
        this.emit('error', err)
      }
    }
  }

  /**
   * Shut down the child process and stop timers. Best-effort.
   * Safe to call even if never started.
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    if (this.child && this.isChildAlive) {
      // Give the child a chance to exit cleanly (EOF on stdin triggers the
      // main loop's break). Then fall back to SIGKILL after a short grace.
      this.drainQueueWithError(
        new JsonlReaderProtocolError('shutdown', 'reader shutting down'),
      )
      try {
        this.child.stdin.end()
      } catch {
        // ignore
      }
      const killed = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 250)
        this.child!.once('exit', () => {
          clearTimeout(timer)
          resolve(true)
        })
      })
      if (!killed && this.child) {
        try {
          this.child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }
    }
    this.child = null
    this.sessionsByPath.clear()
    this.sessionsById.clear()
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _singleton: JsonlReader | null = null

/**
 * Return the process-wide singleton JsonlReader, creating it on demand.
 * Tests that need isolation may call `resetJsonlReader()` between cases.
 */
export function getJsonlReader(): JsonlReader {
  if (_singleton === null) {
    _singleton = new JsonlReader()
  }
  return _singleton
}

/**
 * Test helper: tear down and forget the singleton.
 */
export async function resetJsonlReader(): Promise<void> {
  if (_singleton) {
    await _singleton.shutdown()
    _singleton = null
  }
}
