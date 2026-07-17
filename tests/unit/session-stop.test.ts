/**
 * Unit tests for lib/session-stop.ts (TRDD-OPNDCKVA).
 *
 * The client-aware exit sequence is exercised with INJECTED exec/sleep stubs —
 * no real tmux, no real timers — so both client branches (claude /exit, codex
 * double Ctrl+C) and the exec-error path are covered with zero side effects.
 */
import { describe, it, expect } from 'vitest'
import { runStopSequence, type StopSequenceDeps } from '@/lib/session-stop'

const SESSION = 'test-session'

function makeDeps(overrides: Partial<StopSequenceDeps> = {}): {
  deps: StopSequenceDeps
  calls: string[][]
  sleeps: number[]
} {
  const calls: string[][] = []
  const sleeps: number[] = []
  const deps: StopSequenceDeps = {
    exec: (bin, args) => { calls.push([bin, ...args]) },
    sleep: (ms) => { sleeps.push(ms); return Promise.resolve() }, // instant — no real timers
    ...overrides,
  }
  return { deps, calls, sleeps }
}

describe('runStopSequence — claude (and gemini/opencode/kiro fallback)', () => {
  it('sends C-c, literal /exit, Enter and returns ok', async () => {
    const { deps, calls, sleeps } = makeDeps()
    const outcome = await runStopSequence(SESSION, 'claude', deps)
    expect(outcome).toEqual({ status: 'ok' })
    expect(calls).toEqual([
      ['tmux', 'send-keys', '-t', SESSION, 'C-c'],
      ['tmux', 'send-keys', '-t', SESSION, '-l', '/exit'],
      ['tmux', 'send-keys', '-t', SESSION, 'Enter'],
    ])
    // NEVER shells out to `sleep` and NEVER sends a second C-c on the claude path.
    expect(sleeps).toEqual([])
  })

  it('uses the claude sequence for a non-codex client (gemini)', async () => {
    const { deps, calls } = makeDeps()
    await runStopSequence(SESSION, 'gemini', deps)
    expect(calls).toContainEqual(['tmux', 'send-keys', '-t', SESSION, '-l', '/exit'])
  })
})

describe('runStopSequence — codex', () => {
  it('sends TWO C-c with a gap and NO /exit', async () => {
    const { deps, calls, sleeps } = makeDeps()
    const outcome = await runStopSequence(SESSION, 'codex', deps)
    expect(outcome).toEqual({ status: 'ok' })
    expect(calls).toEqual([
      ['tmux', 'send-keys', '-t', SESSION, 'C-c'],
      ['tmux', 'send-keys', '-t', SESSION, 'C-c'],
    ])
    // exactly one pause between the two Ctrl+C events; never a `/exit`.
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBeGreaterThan(0)
    expect(calls).not.toContainEqual(['tmux', 'send-keys', '-t', SESSION, '-l', '/exit'])
  })

  it('matches codex case-insensitively / trimmed (defensive normalization)', async () => {
    const { deps, calls } = makeDeps()
    await runStopSequence(SESSION, '  Codex  ', deps)
    // still the codex double-C-c path (2 exec calls, no /exit)
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c[c.length - 1] === 'C-c')).toBe(true)
  })
})

describe('runStopSequence — exec-error path', () => {
  it('surfaces { status: error } with the detail, never throwing', async () => {
    const { deps } = makeDeps({
      exec: () => { throw new Error('tmux: no server running') },
    })
    const outcome = await runStopSequence(SESSION, 'claude', deps)
    expect(outcome).toEqual({ status: 'error', detail: 'tmux: no server running' })
  })
})
