/**
 * Tests for the per-agent headless-terminal rendered-frame reader (TRDD-6HEF0XLS — Flock-E foundation).
 *
 * The load-bearing property: the reader RENDERS the VT stream (via @xterm/headless, the same parser
 * the browser xterm uses) and returns the composed grid — what a human would SEE — rather than
 * byte-grepping the raw PTY. So a captured retry-wedge frame yields readable text containing
 * `attempt N/300`, while a stream of cursor-move/redraw escape noise renders to a clean screen with no
 * such text. Fail-open: an unknown agent returns '' (never a false wedge).
 *
 * 0-IMPACT: pure in-memory terminals under mkdtemp-free module state; resetFrameReader() between tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ensureAgentTerminal, feedFrame, feedAndReadFrame, readRenderedFrame, activeBufferType,
  attachPty, resizeAgentTerminal, disposeAgentTerminal, resetFrameReader,
} from '@/lib/agent-frame-reader'

// Enter the alternate screen (where a full-screen TUI draws), clear, home.
const ALT = '\x1b[?1049h\x1b[2J\x1b[H'
const RETRY_WEDGE_RE = /attempt\s+\d+\s*\/\s*\d+/i

beforeEach(() => resetFrameReader())
afterEach(() => resetFrameReader())

describe('agent-frame-reader — renders the grid, not the bytes', () => {
  it('a captured retry-wedge frame renders to text containing "attempt N/300"', async () => {
    const frame = ALT + '✳ Vibing… (esc to interrupt)\r\n  Retrying in 8s (attempt 12/300)\r\n'
    const text = await feedAndReadFrame('a1', frame)
    expect(activeBufferType('a1')).toBe('alternate') // the client is in its full-screen TUI
    expect(text).toContain('attempt 12/300')
    expect(RETRY_WEDGE_RE.test(text)).toBe(true)
  })

  it('a raw cursor-move/redraw escape-noise stream does NOT match the retry-wedge pattern', async () => {
    // lots of movement + a plain shell prompt + scattered output — but never "attempt N/300".
    const noise =
      '\x1b[2J\x1b[H\x1b[1;1H$ \x1b[10;5Hbuilding…\x1b[2;2H\x1b[7mstatus\x1b[0m\x1b[5;1H\x1b[Kdone\r\n'
    const text = await feedAndReadFrame('a2', noise)
    expect(RETRY_WEDGE_RE.test(text)).toBe(false)
    expect(activeBufferType('a2')).toBe('normal') // stayed at the shell, no alt-screen enter
  })

  it('later writes update the rendered frame (event-driven parse, not a one-shot)', async () => {
    await feedFrame('a3', ALT + 'waiting\r\n')
    expect(readRenderedFrame('a3')).toContain('waiting')
    await feedFrame('a3', '\x1b[2J\x1b[Hattempt 3/300\r\n')
    const text = readRenderedFrame('a3')
    expect(text).toContain('attempt 3/300')
  })
})

describe('agent-frame-reader — fail-open + lifecycle', () => {
  it('an unknown agent reads as empty / null (never a false detection)', () => {
    expect(readRenderedFrame('ghost')).toBe('')
    expect(activeBufferType('ghost')).toBeNull()
  })

  it('dispose drops the terminal → subsequent reads fail open', async () => {
    await feedFrame('a4', ALT + 'attempt 9/300\r\n')
    expect(readRenderedFrame('a4')).toContain('attempt 9/300')
    disposeAgentTerminal('a4')
    expect(readRenderedFrame('a4')).toBe('')
  })

  it('ensureAgentTerminal is idempotent (one parser per agent)', () => {
    const t1 = ensureAgentTerminal('a5')
    const t2 = ensureAgentTerminal('a5')
    expect(t1).toBe(t2)
  })

  it('resize does not throw and the reader still works', async () => {
    ensureAgentTerminal('a6')
    resizeAgentTerminal('a6', 80, 24)
    const text = await feedAndReadFrame('a6', ALT + 'attempt 1/300\r\n')
    expect(text).toContain('attempt 1/300')
  })
})

describe('agent-frame-reader — attachPty wiring', () => {
  it('wires a PTY onData → feedFrame so the live screen is reflected, and detaches cleanly', async () => {
    const listeners: ((d: string) => void)[] = []
    let disposed = false
    const pty = {
      onData(cb: (d: string) => void) {
        listeners.push(cb)
        return { dispose() { disposed = true } }
      },
    }
    const detach = attachPty('a7', pty)
    expect(listeners).toHaveLength(1)
    // the PTY emits a wedge frame; the reader reflects it once the async parse flushes
    listeners[0](ALT + 'Retrying in 4s (attempt 42/300)\r\n')
    await vi.waitFor(() => expect(readRenderedFrame('a7')).toContain('attempt 42/300'), { timeout: 500 })
    detach()
    expect(disposed).toBe(true)
  })
})
