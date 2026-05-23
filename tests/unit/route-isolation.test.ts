/**
 * SCEN-027 BUG-001 regression test (PROP-001).
 *
 * Locks the chat-browser's session-resolution contract against the bug
 * documented at:
 *   - 967d8d2c  fix(scen-027): accept `?path=` for cross-worker map staleness
 *   - e1944e75  fix(jsonl-browser): per-path lock + load-before-list guard
 *   - dbed4a51  fix(jsonl-browser): include retry-loop route changes
 *
 * Failure mode: a request to /api/sessions-browser/sessions/[sid]/range
 * is served by Next.js worker B while the list endpoint that would have
 * populated B's in-memory `sidToPath` map ran on worker A. Without a
 * cross-worker resolution mechanism the range endpoint returns
 *   { error: "session_not_found" } HTTP 404
 * even though the .jsonl file is perfectly readable on disk.
 *
 * The current shipped mechanism layers FOUR defenses, and each of the
 * five tests below locks ONE of them. If any layer regresses, exactly
 * one test fails — making the bug self-locating.
 *
 *   Layer 1: `?path=<abs>` query param  — authoritative, cross-worker safe.
 *   Layer 2: `resolveSessionPath(sid)`  — same-worker warm-cache fallback.
 *   Layer 3: bounded retry on `session_not_found` — survives concurrent
 *            mtime-evictions during the read window.
 *   Layer 4: per-path Promise lock in `JsonlReader.open()` — dedupes
 *            concurrent opens so caller A's read doesn't race caller
 *            B's close+reopen.
 *
 * Plus: layer 5 (list endpoint populates the sid→path map for same-worker
 * warm-cache callers) is locked by the existing
 * `sessions-browser-service.test.ts::recordSessionMapping` block — we do
 * not duplicate it here, but reference it for completeness.
 *
 * The tests deliberately mock ONLY external dependencies (the JsonlReader
 * singleton, file-system reads) so the real route handler logic AND the
 * real per-path lock code path execute end-to-end. Per the test-writer
 * golden rule: a test that bypasses the code under test provides false
 * confidence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import type { ChildProcessWithoutNullStreams } from 'child_process'

// ---------------------------------------------------------------------------
// Mocks — declared before importing the route handlers under test.
// ---------------------------------------------------------------------------

// Mock the JsonlReader singleton accessor while PRESERVING the error
// classes (the route handlers do `instanceof JsonlReaderProtocolError`
// to map 'session_not_found' to HTTP 404). A naive `vi.mock(...)` that
// only exports `getJsonlReader` breaks every error-path assertion.
vi.mock('@/lib/jsonl-reader', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jsonl-reader')>(
    '@/lib/jsonl-reader',
  )
  return {
    ...actual,
    getJsonlReader: vi.fn(),
  }
})

// Mock fs.existsSync so the real JsonlReader (used in the per-path lock
// test below) reports the fake binary as present. Module-level mocking
// is REQUIRED here because ESM module namespaces are not configurable —
// vi.spyOn(fs, 'existsSync') throws "Cannot redefine property". See
// https://vitest.dev/guide/browser/#limitations. The other tests in
// this file do not exercise fs, so this is a no-op for them.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    // statSync is called by JsonlReader._openImpl to capture file
    // size/mtime for the append-aware cache. Return a stable stub so
    // the lock test doesn't depend on a real file existing.
    statSync: vi.fn(() => ({ size: 100, mtimeMs: 1_700_000_000_000 })),
  }
})

// Mock child_process.spawn so the per-path lock test can wire a fake
// child without spawning the real aim-jsonl-reader binary. Use a
// partial mock — agent-runtime and other transitive dependencies need
// `execFile` and friends to remain available.
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    spawn: vi.fn(),
  }
})

import { getJsonlReader, JsonlReader, JsonlReaderProtocolError } from '@/lib/jsonl-reader'
import {
  clearSessionMappings,
  recordSessionMapping,
} from '@/services/sessions-browser-service'
import { POST as rangePOST } from '@/app/api/sessions-browser/sessions/[sid]/range/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Request the same way the production fetch path would: with an
 * `aim_session` cookie (so the auth gate passes) and a JSON body.
 */
function makeRangeRequest(sid: string, queryPath?: string, body = { fromLine: 0, toLine: 10 }) {
  const base = `http://localhost:23000/api/sessions-browser/sessions/${sid}/range`
  const url = queryPath ? `${base}?path=${encodeURIComponent(queryPath)}` : base
  return new Request(url, {
    method: 'POST',
    headers: {
      cookie: 'aim_session=fake-test-cookie',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function asParams<T extends object>(obj: T): { params: Promise<T> } {
  return { params: Promise.resolve(obj) }
}

/**
 * A minimal fake reader. Each method is a vi.fn(); tests replace the
 * implementation per case. Returned `as any` to satisfy the JsonlReader
 * shape without re-declaring its huge surface.
 */
function makeFakeReader(): {
  open: ReturnType<typeof vi.fn>
  readRange: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
  contextBreakdown: ReturnType<typeof vi.fn>
} {
  return {
    open: vi.fn(),
    readRange: vi.fn(),
    search: vi.fn(),
    contextBreakdown: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Test 1 — Layer 1: empty sidToPath + `?path=` query → resolves
// ---------------------------------------------------------------------------
//
// This is the SCEN-027 BUG-001 core case. Without `?path=`, an empty map
// would force a 404. With `?path=`, the route uses the query param
// directly, opens via `ensureOpenForPath`, and returns 200.

describe('range route — cross-worker isolation (BUG-001 core)', () => {
  beforeEach(() => {
    clearSessionMappings()
    vi.mocked(getJsonlReader).mockReset()
  })

  afterEach(() => {
    vi.mocked(getJsonlReader).mockReset()
  })

  it('returns 200 when sidToPath is empty but `?path=` is supplied', async () => {
    // Realistic UI flow: user opens chat browser, list ran on worker A,
    // user clicks a session — range request lands on worker B whose
    // sidToPath map is empty. The UI sends `?path=` from the list
    // response so the route MUST resolve cross-worker.
    const sid = 'aabbccdd-1111-2222-3333-444455556666'
    const absolutePath = '/Users/test/.claude/projects/-Users-test-proj/aabbccdd.jsonl'

    const fakeReader = makeFakeReader()
    fakeReader.open.mockResolvedValue({
      ok: true,
      sessionId: 'rust-sid-cross-worker',
      lineCount: 50,
      indexed: false,
    })
    fakeReader.readRange.mockResolvedValue({
      ok: true,
      lines: [{ type: 'user', content: 'hi' }, { type: 'assistant', content: 'hello' }],
    })
    vi.mocked(getJsonlReader).mockReturnValue(fakeReader as any)

    const req = makeRangeRequest(sid, absolutePath)
    const res = await rangePOST(req, asParams({ sid }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessionId).toBe(sid)
    expect(body.lines).toHaveLength(2)
    expect(fakeReader.open).toHaveBeenCalledWith(absolutePath)
  })
})

// ---------------------------------------------------------------------------
// Test 2 — 404 contract: empty map AND no `?path=` → session_not_found
// ---------------------------------------------------------------------------
//
// Locks the 404 error-shape contract. If BOTH resolution layers fail (no
// `?path=` AND empty sidToPath cache), the route MUST refuse with
// `error: "session_not_found"` HTTP 404. The reader is NEVER called.

describe('range route — 404 contract when no resolver succeeds', () => {
  beforeEach(() => {
    clearSessionMappings()
    vi.mocked(getJsonlReader).mockReset()
  })

  it('returns 404 with error="session_not_found" and never opens the reader', async () => {
    const sid = 'unknown-sid-deadbeef'
    const fakeReader = makeFakeReader()
    vi.mocked(getJsonlReader).mockReturnValue(fakeReader as any)

    // No `?path=`, no prior recordSessionMapping → both layers miss.
    const req = makeRangeRequest(sid, undefined)
    const res = await rangePOST(req, asParams({ sid }))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toEqual({ error: 'session_not_found' })
    // CRITICAL: the reader is never opened on the 404 path. If a future
    // refactor accidentally calls open() before resolution, this fires.
    expect(fakeReader.open).not.toHaveBeenCalled()
    expect(fakeReader.readRange).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Test 3 — Layer 2: warm sidToPath map + no `?path=` → resolves
// ---------------------------------------------------------------------------
//
// Locks the same-worker warm-cache path. When a list request previously
// populated `sidToPath` in THIS worker, a subsequent range request that
// omits `?path=` MUST still succeed. This is the legacy code path that
// 99% of single-worker dev setups exercised before BUG-001 was caught.

describe('range route — warm-cache fallback (same-worker, no `?path=`)', () => {
  beforeEach(() => {
    clearSessionMappings()
    vi.mocked(getJsonlReader).mockReset()
  })

  afterEach(() => {
    clearSessionMappings()
  })

  it('falls back to resolveSessionPath when `?path=` is omitted', async () => {
    const sid = 'warm-cache-sid-99887766'
    const absolutePath = '/Users/test/.claude/projects/-Users-test-proj/warm.jsonl'

    // Simulate a list call having already populated the same-worker map.
    recordSessionMapping(sid, absolutePath)

    const fakeReader = makeFakeReader()
    fakeReader.open.mockResolvedValue({
      ok: true,
      sessionId: 'rust-sid-warm',
      lineCount: 5,
      indexed: true,
    })
    fakeReader.readRange.mockResolvedValue({ ok: true, lines: [{ msg: 'ok' }] })
    vi.mocked(getJsonlReader).mockReturnValue(fakeReader as any)

    const req = makeRangeRequest(sid, undefined)
    const res = await rangePOST(req, asParams({ sid }))

    expect(res.status).toBe(200)
    expect(fakeReader.open).toHaveBeenCalledWith(absolutePath)
  })
})

// ---------------------------------------------------------------------------
// Test 4 — Layer 3: bounded retry on transient `session_not_found`
// ---------------------------------------------------------------------------
//
// Locks the retry-loop fix (commit dbed4a51). When a parallel poll-tick
// mtime-evicts the path between our `ensureOpenForPath` and our
// `readRange`, the reader surfaces `session_not_found`. The route MUST
// retry up to 3 times with a brief backoff. We simulate one transient
// failure followed by a success and assert the route returns 200.

describe('range route — retry on transient session_not_found (eviction race)', () => {
  beforeEach(() => {
    clearSessionMappings()
    vi.mocked(getJsonlReader).mockReset()
  })

  it('retries after one session_not_found and returns 200 on the second attempt', async () => {
    const sid = 'retry-sid-aaaa'
    const absolutePath = '/Users/test/.claude/projects/-Users-test-proj/retry.jsonl'

    const fakeReader = makeFakeReader()
    // Open is called once per attempt — both attempts succeed (a fresh
    // sid each time, the in-flight eviction is invisible to us because
    // the per-path lock in JsonlReader handled it).
    fakeReader.open
      .mockResolvedValueOnce({
        ok: true,
        sessionId: 'rust-sid-evicted',
        lineCount: 10,
        indexed: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        sessionId: 'rust-sid-fresh',
        lineCount: 10,
        indexed: false,
      })
    // First readRange races a concurrent eviction; second succeeds.
    fakeReader.readRange
      .mockRejectedValueOnce(
        new JsonlReaderProtocolError('session_not_found', 'evicted during read'),
      )
      .mockResolvedValueOnce({ ok: true, lines: [{ ok: true }] })
    vi.mocked(getJsonlReader).mockReturnValue(fakeReader as any)

    const req = makeRangeRequest(sid, absolutePath)
    const res = await rangePOST(req, asParams({ sid }))

    expect(res.status).toBe(200)
    // Verify retry actually happened: 2 opens + 2 readRange calls.
    expect(fakeReader.open).toHaveBeenCalledTimes(2)
    expect(fakeReader.readRange).toHaveBeenCalledTimes(2)
  })

  it('gives up after MAX_ATTEMPTS=3 consecutive evictions and returns 404', async () => {
    const sid = 'retry-exhausted-sid'
    const absolutePath = '/Users/test/.claude/projects/-Users-test-proj/persistent-evict.jsonl'

    const fakeReader = makeFakeReader()
    fakeReader.open.mockResolvedValue({
      ok: true,
      sessionId: 'rust-sid-x',
      lineCount: 1,
      indexed: false,
    })
    // Every attempt evicts — the route MUST stop after 3 tries and
    // surface the 404 cleanly (not hang, not infinite-loop).
    fakeReader.readRange.mockRejectedValue(
      new JsonlReaderProtocolError('session_not_found', 'persistent eviction'),
    )
    vi.mocked(getJsonlReader).mockReturnValue(fakeReader as any)

    const req = makeRangeRequest(sid, absolutePath)
    const res = await rangePOST(req, asParams({ sid }))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('session_not_found')
    // Confirm we ATTEMPTED the documented MAX_ATTEMPTS=3 before giving up.
    expect(fakeReader.readRange).toHaveBeenCalledTimes(3)
  })
})

// ---------------------------------------------------------------------------
// Test 5 — Layer 4: per-path Promise lock dedupes concurrent opens
// ---------------------------------------------------------------------------
//
// This test exercises the REAL JsonlReader (with its real per-path lock
// code path) against a fake child process. Two concurrent open(samePath)
// calls MUST share a single in-flight Promise — only ONE 'open' command
// goes on the wire, and both callers receive the same sessionId.
// Without this, caller A's read races caller B's close+reopen and
// surfaces transient `session_not_found` — the original BUG-001 inner
// failure mode that commit e1944e75 fixed.
//
// Pattern lifted from tests/unit/jsonl-reader.test.ts so we use the same
// fake child machinery the rest of the suite relies on.

describe('JsonlReader.open() — per-path Promise lock (concurrent open dedup)', () => {
  interface FakeChild extends ChildProcessWithoutNullStreams {
    _simulateStdout: (line: string) => void
    _writtenLines: string[]
    _onStdinWrite: ((line: string) => void) | null
  }

  function makeFakeChild(): FakeChild {
    const emitter = new EventEmitter() as FakeChild
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const writtenLines: string[] = []
    const stdin = new PassThrough()
    stdin.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      writtenLines.push(text)
      if (emitter._onStdinWrite) emitter._onStdinWrite(text)
    })
    Object.assign(emitter, {
      stdout,
      stderr,
      stdin,
      pid: 99_999,
      killed: false,
      exitCode: null as number | null,
      _writtenLines: writtenLines,
      _onStdinWrite: null,
      _simulateStdout(line: string) {
        stdout.write(line.endsWith('\n') ? line : line + '\n')
      },
      kill(this: any) {
        this.killed = true
        this.exitCode = this.exitCode ?? 0
        process.nextTick(() => emitter.emit('exit', this.exitCode, null))
        return true
      },
    })
    return emitter
  }

  it('two concurrent open(samePath) calls share one Promise, send one open cmd', async () => {
    // Pull the mocked spawn (module-level vi.mock above).
    const childProcess = await import('child_process')
    const fakeChild = makeFakeChild()
    vi.mocked(childProcess.spawn).mockReturnValue(fakeChild as any)

    // Real JsonlReader — we want the REAL per-path lock code path. The
    // route-side mock (vi.mock('@/lib/jsonl-reader', ...)) intercepts
    // `getJsonlReader` but the `JsonlReader` class itself is the real
    // export (preserved via importActual + spread).
    const reader = new JsonlReader({
      manualSweep: true,
      binaryPath: '/fake/path/to/aim-jsonl-reader',
    })

    // The fake child delays its response so the second open lands
    // BEFORE the first resolves — this is the only way to exercise the
    // per-path lock. We count `cmd:"open"` writes; if the lock works,
    // count stays at 1 even though two callers raced for the same path.
    let respondNow: (() => void) | null = null
    let openCmdCount = 0
    fakeChild._onStdinWrite = (text) => {
      if (text.includes('"cmd":"open"')) {
        openCmdCount++
        respondNow = () => {
          fakeChild._simulateStdout(
            JSON.stringify({
              ok: true,
              sessionId: 'rust-sid-shared-lock',
              lineCount: 42,
              indexed: false,
            }),
          )
        }
      }
    }

    const samePath = '/tmp/locked-path.jsonl'
    // Fire both opens BEFORE the child responds — the second open MUST
    // land while the first is in-flight to exercise the lock.
    const p1 = reader.open(samePath)
    const p2 = reader.open(samePath)

    // Yield so the first open's stdin.write actually fires.
    await new Promise<void>((r) => setImmediate(r))

    // Release the canned response — both pending awaits resolve.
    expect(respondNow).not.toBeNull()
    respondNow!()

    const [r1, r2] = await Promise.all([p1, p2])

    // Both promises received the SAME sessionId.
    expect(r1.sessionId).toBe('rust-sid-shared-lock')
    expect(r2.sessionId).toBe('rust-sid-shared-lock')

    // CRITICAL: only ONE 'open' command was written to the wire. If the
    // per-path lock regresses, openCmdCount becomes 2 and the race
    // documented in commit e1944e75 is back. This assertion is the
    // regression sentinel.
    expect(openCmdCount).toBe(1)

    await reader.shutdown()
  })
})
