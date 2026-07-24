// Per-agent headless-terminal rendered-frame reader (TRDD-6HEF0XLS — the Flock-E foundation).
//
// The server-owned agents run CLI clients (claude/codex/kimi/opencode/…) that draw their UI on the
// terminal's ALTERNATE screen, like vim/less. To detect a wedged or blocking state — a retry spinner,
// an AskUserQuestion menu — the automaton must read the RENDERED GRID (what a human sees), NOT the raw
// PTY byte stream. The raw stream is a torrent of cursor-move/redraw escape sequences that no regex
// parses reliably: the same visible line can be painted by a dozen different byte sequences. So we
// feed each agent's PTY output into a headless `@xterm/headless` Terminal — the SAME VT parser the
// browser xterm uses, minus the DOM — and read back the composed cells.
//
// WHY headless and not the browser Terminal: the browser xterm needs a live DOM/canvas and a
// connected websocket, neither of which exists for an UNATTENDED agent nobody has open in a tab. The
// headless build renders the grid in memory with no display.
//
// FAIL-OPEN (R16 posture): an absent/unreadable grid returns '' → "not detected", NEVER a false
// positive. A detector that hallucinated a wedge would drive a spurious ESC injection; silence is the
// safe failure. This module only READS; it performs no injection and mutates no agent.

import { Terminal } from '@xterm/headless'

/** A generous default grid — a real agent PTY resizes it via `resizeAgentTerminal`. Wide enough that
 *  a retry-wedge / menu line is not wrapped away from its keyword. */
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 40

interface AgentTerminal {
  term: Terminal
}

/** One in-memory VT parser per server-owned agent, keyed by agentId. Module-level because the reader
 *  is a process singleton (like the watchdog stores); reset between tests via `resetFrameReader`. */
const registry = new Map<string, AgentTerminal>()

/** Get (or lazily create) the headless Terminal for an agent. `allowProposedApi` is required for the
 *  buffer inspection API used by `readRenderedFrame`. */
export function ensureAgentTerminal(agentId: string, opts: { cols?: number; rows?: number } = {}): Terminal {
  let entry = registry.get(agentId)
  if (!entry) {
    const term = new Terminal({
      cols: opts.cols ?? DEFAULT_COLS,
      rows: opts.rows ?? DEFAULT_ROWS,
      allowProposedApi: true,
      // no scrollback needed — we only read the visible rendered frame
      scrollback: 0,
    })
    entry = { term }
    registry.set(agentId, entry)
  }
  return entry.term
}

/**
 * Feed a chunk of PTY output into the agent's terminal. Resolves once xterm has PARSED the chunk —
 * `Terminal.write` is asynchronous (it queues the bytes for the VT parser), so a caller that reads
 * the frame immediately after an un-awaited write would read a stale grid. Await this, then read.
 */
export function feedFrame(agentId: string, data: string | Uint8Array): Promise<void> {
  const term = ensureAgentTerminal(agentId)
  return new Promise<void>((resolve) => term.write(data, () => resolve()))
}

/**
 * Read the currently-rendered visible frame as text — the composed cells of the ACTIVE buffer (which
 * is the alternate buffer whenever the client is in its full-screen TUI, exactly where a retry-wedge
 * or a menu renders). Each row is `translateToString(true)` (trailing blanks trimmed); trailing blank
 * ROWS are dropped. FAIL-OPEN: no terminal, or any buffer-read error, returns '' ("not detected").
 */
export function readRenderedFrame(agentId: string): string {
  const entry = registry.get(agentId)
  if (!entry) return ''
  try {
    const buf = entry.term.buffer.active
    const top = buf.viewportY
    const rows = entry.term.rows
    const lines: string[] = []
    for (let y = 0; y < rows; y++) {
      const line = buf.getLine(top + y)
      lines.push(line ? line.translateToString(true) : '')
    }
    // Drop trailing blank rows so a short frame in a tall grid isn't a wall of newlines.
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  } catch {
    return '' // fail-open — an unreadable grid is "not detected", never a false wedge
  }
}

/** The active buffer's type — 'alternate' when the client is in its full-screen TUI, 'normal' at a
 *  shell prompt. null when the agent has no terminal. A detector can gate on 'alternate' to ignore a
 *  plain shell. Fail-open to null. */
export function activeBufferType(agentId: string): 'normal' | 'alternate' | null {
  const entry = registry.get(agentId)
  if (!entry) return null
  try {
    return entry.term.buffer.active.type
  } catch {
    return null
  }
}

/** Wire a PTY's output into the agent's terminal so `readRenderedFrame` reflects the live screen.
 *  Duck-typed on `onData` so it accepts a node-pty IPty (or a fake in tests) without importing the
 *  native module here. The returned disposer detaches the listener (node-pty's onData returns an
 *  IDisposable; a plain callback form is tolerated). */
export function attachPty(agentId: string, pty: { onData(cb: (data: string) => void): { dispose(): void } | void }): () => void {
  ensureAgentTerminal(agentId)
  const sub = pty.onData((data) => {
    // fire-and-forget: the parse is queued; a reader awaits its own feedFrame or reads on the next tick
    void feedFrame(agentId, data)
  })
  return () => {
    if (sub && typeof sub.dispose === 'function') sub.dispose()
  }
}

/** Resize an agent's grid to match its PTY (cols/rows). No-op when the agent has no terminal. */
export function resizeAgentTerminal(agentId: string, cols: number, rows: number): void {
  const entry = registry.get(agentId)
  if (entry && cols > 0 && rows > 0) entry.term.resize(cols, rows)
}

/** Dispose one agent's terminal and drop it from the registry (call when an agent is removed). */
export function disposeAgentTerminal(agentId: string): void {
  const entry = registry.get(agentId)
  if (entry) {
    try {
      entry.term.dispose()
    } catch {
      // best-effort
    }
    registry.delete(agentId)
  }
}

/** Test-only: dispose every terminal and clear the registry (the running server keeps one for life). */
export function resetFrameReader(): void {
  for (const id of Array.from(registry.keys())) disposeAgentTerminal(id)
}

/** Convenience: feed a chunk then read the resulting frame (the common test/detector shape). */
export async function feedAndReadFrame(agentId: string, data: string | Uint8Array): Promise<string> {
  await feedFrame(agentId, data)
  return readRenderedFrame(agentId)
}
