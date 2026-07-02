import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

import type { ChildProcessWithoutNullStreams } from 'child_process'

// ---------------------------------------------------------------------------
// Fake child-process infrastructure
// ---------------------------------------------------------------------------

interface FakeChild extends ChildProcessWithoutNullStreams {
  _simulateStdout: (line: string) => void
  _simulateExit: (code: number | null, signal?: NodeJS.Signals) => void
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
    pid: 42_000,
    killed: false,
    exitCode: null as number | null,
    _writtenLines: writtenLines,
    _onStdinWrite: null,
    _simulateStdout(line: string) {
      stdout.write(line.endsWith('\n') ? line : line + '\n')
    },
    _simulateExit(code: number | null, signal?: NodeJS.Signals) {
      ;(emitter as any).exitCode = code
      ;(emitter as any).killed = true
      process.nextTick(() => emitter.emit('exit', code, signal ?? null))
    },
    kill(this: any, _sig?: NodeJS.Signals) {
      this.killed = true
      this.exitCode = this.exitCode ?? 0
      process.nextTick(() => emitter.emit('exit', this.exitCode, _sig ?? null))
      return true
    },
  })
  return emitter
}

const currentChildRef: { current: FakeChild | null } = { current: null }
// Callback invoked every time a new child is spawned. Tests register it
// BEFORE the first reader.open() so canned responses are wired up before
// the first stdin.write() fires.
let onSpawn: ((child: FakeChild) => void) | null = null

// Mock child_process.spawn to produce our fake.
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const child = makeFakeChild()
    currentChildRef.current = child
    if (onSpawn) onSpawn(child)
    return child
  }),
}))

// Mock fs.existsSync so the binary always "exists" during tests.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  }
})

// ---------------------------------------------------------------------------
// Imports AFTER mocks are set up.
// ---------------------------------------------------------------------------

import {
  JsonlReader,
  JsonlReaderBinaryMissingError,
  JsonlReaderProtocolError,
  IDLE_SESSION_TTL_MS,
} from '@/lib/jsonl-reader'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function awaitSetImmediate() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

// Parse the most recent written line as a JSON request object.
function lastRequest(child: FakeChild): any {
  const tail = child._writtenLines[child._writtenLines.length - 1]
  return JSON.parse(tail.trim())
}

// Attach a canned-response wiring helper: answers each request via the
// returned sequence, in order.
function respondWith(child: FakeChild, responses: any[]) {
  let idx = 0
  child._onStdinWrite = () => {
    const resp = responses[idx++]
    if (resp === undefined) return
    // Deliver on a microtask so the writer's queue entry is already enqueued.
    process.nextTick(() => child._simulateStdout(JSON.stringify(resp)))
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JsonlReader', () => {
  let reader: JsonlReader

  beforeEach(() => {
    currentChildRef.current = null
    onSpawn = null
    reader = new JsonlReader({ manualSweep: true })
  })

  afterEach(async () => {
    await reader.shutdown()
    onSpawn = null
    vi.clearAllMocks()
  })

  it('spawns the child lazily on first open', async () => {
    expect(reader.isChildAlive).toBe(false)
    onSpawn = (child) => {
      respondWith(child, [
        { ok: true, sessionId: 'rust-sid-1', lineCount: 100, indexed: false },
      ])
    }
    const result = await reader.open('/tmp/fake.jsonl')
    expect(result.ok).toBe(true)
    expect(result.sessionId).toBe('rust-sid-1')
    expect(result.lineCount).toBe(100)
    expect(reader.openSessions.size).toBe(1)
  })

  it('self-heals after SIGKILL: respawns on next open', async () => {
    onSpawn = (child) => {
      respondWith(child, [
        { ok: true, sessionId: 'rust-sid-A', lineCount: 1, indexed: false },
      ])
    }
    await reader.open('/tmp/a.jsonl')
    const firstChild = currentChildRef.current!
    expect(reader.isChildAlive).toBe(true)

    // Simulate an unexpected child death (SIGKILL-class).
    firstChild._simulateExit(null, 'SIGKILL')
    await awaitSetImmediate()
    await awaitSetImmediate()
    expect(reader.isChildAlive).toBe(false)
    expect(reader.openSessions.size).toBe(0)

    // Next call must transparently respawn.
    currentChildRef.current = null
    onSpawn = (child) => {
      respondWith(child, [
        { ok: true, sessionId: 'rust-sid-B', lineCount: 2, indexed: true },
      ])
    }
    const second = await reader.open('/tmp/b.jsonl')
    expect(second.ok).toBe(true)
    expect(second.sessionId).toBe('rust-sid-B')
    expect(reader.isChildAlive).toBe(true)
  })

  it('returns JsonlReaderBinaryMissingError when binary is absent', async () => {
    const fs = await import('fs')
    ;(fs.existsSync as any).mockReturnValueOnce(false)
    const readerMissing = new JsonlReader({
      binaryPath: '/absolutely/not/here',
      manualSweep: true,
    })
    await expect(readerMissing.open('/tmp/x.jsonl')).rejects.toBeInstanceOf(
      JsonlReaderBinaryMissingError,
    )
  })

  it('surfaces Rust error responses as JsonlReaderProtocolError', async () => {
    onSpawn = (child) => {
      respondWith(child, [{ ok: false, error: 'open_failed', detail: 'bad magic' }])
    }
    await expect(reader.open('/tmp/bad.jsonl')).rejects.toBeInstanceOf(
      JsonlReaderProtocolError,
    )
  })

  it('GC closes idle sessions after idleTtlMs', async () => {
    let fakeNow = 1_000_000
    const customReader = new JsonlReader({
      manualSweep: true,
      idleTtlMs: IDLE_SESSION_TTL_MS,
      now: () => fakeNow,
    })
    onSpawn = (child) => {
      respondWith(child, [
        { ok: true, sessionId: 'sid-1', lineCount: 10, indexed: false },
        // Response for the upcoming close command.
        { ok: true },
      ])
    }
    await customReader.open('/tmp/idle.jsonl')
    expect(customReader.openSessions.size).toBe(1)

    // Advance fake clock past 31 min.
    fakeNow += IDLE_SESSION_TTL_MS + 60_000

    await customReader.sweepIdleSessions()
    expect(customReader.openSessions.size).toBe(0)

    await customReader.shutdown()
  })

  it('reuses the same session when opened twice on the same path', async () => {
    onSpawn = (child) => {
      respondWith(child, [
        { ok: true, sessionId: 'sid-reuse', lineCount: 7, indexed: false },
      ])
    }
    const first = await reader.open('/tmp/reuse.jsonl')
    const second = await reader.open('/tmp/reuse.jsonl')
    expect(second.sessionId).toBe(first.sessionId)
    expect(reader.openSessions.size).toBe(1)
    const openRequests = currentChildRef.current!._writtenLines.filter((l) =>
      l.includes('"cmd":"open"'),
    )
    expect(openRequests.length).toBe(1)
  })

  it('re-opens when the file grew since the last open (live-tail support)', async () => {
    // Use a real temp file so statSync sees actual size/mtime changes.
    const fs = await vi.importActual<typeof import('fs')>('fs')
    const os = await vi.importActual<typeof import('os')>('os')
    const path = await vi.importActual<typeof import('path')>('path')
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-reader-tail-'))
    const tmpFile = path.join(tmpDir, 'session.jsonl')
    fs.writeFileSync(tmpFile, '{"a":1}\n')
    onSpawn = (child) => {
      respondWith(child, [
        // First open
        { ok: true, sessionId: 'sid-first', lineCount: 1, indexed: false },
        // close (after staleness detected)
        { ok: true, closed: true },
        // Second open (after file grew)
        { ok: true, sessionId: 'sid-second', lineCount: 2, indexed: false },
      ])
    }

    const first = await reader.open(tmpFile)
    expect(first.sessionId).toBe('sid-first')
    expect(first.lineCount).toBe(1)

    // Simulate the live agent appending a new line. mtime changes too;
    // bump it explicitly because some filesystems have 1s mtime resolution.
    fs.appendFileSync(tmpFile, '{"b":2}\n')
    const future = new Date(Date.now() + 5_000)
    fs.utimesSync(tmpFile, future, future)

    const second = await reader.open(tmpFile)
    expect(second.sessionId).toBe('sid-second')
    expect(second.lineCount).toBe(2)
    // Exactly TWO open commands were sent (close in the middle).
    const openRequests = currentChildRef.current!._writtenLines.filter((l) =>
      l.includes('"cmd":"open"'),
    )
    expect(openRequests.length).toBe(2)
    const closeRequests = currentChildRef.current!._writtenLines.filter((l) =>
      l.includes('"cmd":"close"'),
    )
    expect(closeRequests.length).toBe(1)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('readRange validates session and passes through line payload', async () => {
    onSpawn = (child) => {
      respondWith(child, [
        { ok: true, sessionId: 'sid-r', lineCount: 3, indexed: false },
        { ok: true, lines: [{ a: 1 }, { b: 2 }] },
      ])
    }
    const { sessionId } = await reader.open('/tmp/range.jsonl')
    const resp = await reader.readRange(sessionId, 0, 1)
    expect(resp.lines).toHaveLength(2)
    const lastReq = lastRequest(currentChildRef.current!)
    expect(lastReq).toMatchObject({
      cmd: 'read_range',
      fromLine: 0,
      toLine: 1,
      sessionId: 'sid-r',
    })
  })

  // ------------------------------------------------------------------
  // Phase 5 §3.8 — analyzeFileMetadata
  // ------------------------------------------------------------------

  it('analyzeFileMetadata sends path-based request and returns metadata', async () => {
    // Unlike readRange/search/context, this call takes a raw path —
    // the Rust side does not require an open sessionId. Verify the
    // wire shape: `{cmd:"analyze_file_metadata", path:"..."}` with
    // NO sessionId field.
    onSpawn = (child) => {
      respondWith(child, [
        {
          ok: true,
          firstUserMessagePreview: 'hello world',
          isOngoing: true,
          compactionCount: 2,
          phaseTokenBreakdown: [
            { phaseId: 0, pre: 0, peak: 30, post: 30 },
            { phaseId: 1, pre: 30, peak: 70, post: 70 },
            { phaseId: 2, pre: 70, peak: 100, post: null },
          ],
          shutdownToolCalls: 0,
          rejections: 1,
          requestIdDedupedAssistantTokens: 100,
          hasSubagentSpawns: true,
          hasCompactSummary: true,
        },
      ])
    }

    const result = await reader.analyzeFileMetadata('/tmp/sess.jsonl')

    expect(result.ok).toBe(true)
    expect(result.firstUserMessagePreview).toBe('hello world')
    expect(result.isOngoing).toBe(true)
    expect(result.compactionCount).toBe(2)
    expect(result.phaseTokenBreakdown).toHaveLength(3)
    expect(result.phaseTokenBreakdown[2].post).toBeNull()
    expect(result.hasSubagentSpawns).toBe(true)
    expect(result.hasCompactSummary).toBe(true)
    expect(result.requestIdDedupedAssistantTokens).toBe(100)

    const req = lastRequest(currentChildRef.current!)
    expect(req).toMatchObject({
      cmd: 'analyze_file_metadata',
      path: '/tmp/sess.jsonl',
    })
    // CRITICAL: no sessionId field — this call runs WITHOUT opening
    // a Rust-side handle first.
    expect(req.sessionId).toBeUndefined()
  })

  it('analyzeFileMetadata surfaces Rust error responses as JsonlReaderProtocolError', async () => {
    onSpawn = (child) => {
      respondWith(child, [
        { ok: false, error: 'open_failed', detail: 'no such file: /tmp/ghost.jsonl' },
      ])
    }
    await expect(reader.analyzeFileMetadata('/tmp/ghost.jsonl')).rejects.toBeInstanceOf(
      JsonlReaderProtocolError,
    )
  })

  it('analyzeFileMetadata does NOT create or touch an OpenSessionEntry', async () => {
    // Regression guard — if someone later wires this through `touch()`
    // (like readRange/search/context do), a missing sessionId would
    // silently become a no-op but the bookkeeping would be wrong.
    // This test confirms that analyzeFileMetadata does not pollute the
    // openSessions map.
    onSpawn = (child) => {
      respondWith(child, [
        {
          ok: true,
          firstUserMessagePreview: 'first line',
          isOngoing: false,
          compactionCount: 0,
          phaseTokenBreakdown: [{ phaseId: 0, pre: 0, peak: 0, post: null }],
          shutdownToolCalls: 0,
          rejections: 0,
          requestIdDedupedAssistantTokens: 0,
          hasSubagentSpawns: false,
          hasCompactSummary: false,
        },
      ])
    }
    expect(reader.openSessions.size).toBe(0)
    await reader.analyzeFileMetadata('/tmp/anything.jsonl')
    expect(reader.openSessions.size).toBe(0)
  })
})
