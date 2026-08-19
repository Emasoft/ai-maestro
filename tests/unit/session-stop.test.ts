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
    // Default pane doubles: the program exits immediately (shell reached on the first probe),
    // so pre-existing sequence tests stay about the SEQUENCE. The abandon-dialog cases below
    // override these. Without doubles the probe would hit REAL tmux (0-IMPACT violation).
    paneCommand: () => 'zsh',
    capturePane: () => '',
    ...overrides,
  }
  return { deps, calls, sleeps }
}

// The dialog text as CC ≥2.1.203 renders it (captured live 2026-08-19 from a force-stopped
// session with one background subagent) — the fixture the detector must match.
const ABANDON_DIALOG = [
  'Background work is running',
  'The following will stop when you exit:',
  'shell · end=$((SECONDS+170)); until [ $SECONDS -ge $end ]…',
  '❯ 1. Exit and stop tasks',
].join('\n')

describe('runStopSequence — claude (and gemini/opencode/kiro fallback)', () => {
  it('sends C-c, literal /exit, Enter and returns ok', async () => {
    const { deps, calls, sleeps } = makeDeps()
    const outcome = await runStopSequence(SESSION, 'claude', deps)
    expect(outcome).toEqual({ status: 'ok', abandonPromptConfirmed: false })
    expect(calls).toEqual([
      ['tmux', 'send-keys', '-t', SESSION, 'C-c'],
      ['tmux', 'send-keys', '-t', SESSION, '-l', '/exit'],
      ['tmux', 'send-keys', '-t', SESSION, 'Enter'],
    ])
    // NEVER shells out to `sleep`; the only sleep is the probe's own step (clean exit ⇒ one).
    expect(sleeps).toEqual([1000])
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

describe('runStopSequence — abandon-confirmation dialog (TRDD-O8NCNRWO, the force-stop path)', () => {
  it('detects the dialog and confirms it with exactly ONE Enter, then stops at the shell', async () => {
    let probes = 0
    const { deps, calls } = makeDeps({
      // dialog visible for two probes (Enter must still be sent only once), then exit completes
      paneCommand: () => (++probes <= 2 ? 'node' : 'zsh'),
      capturePane: () => ABANDON_DIALOG,
    })
    const outcome = await runStopSequence(SESSION, 'claude', deps)
    expect(outcome).toEqual({ status: 'ok', abandonPromptConfirmed: true })
    const enters = calls.filter((c) => c.join(' ') === `tmux send-keys -t ${SESSION} Enter`)
    // one Enter from the exit sequence itself + exactly one confirming the dialog
    expect(enters).toHaveLength(2)
  })

  it('NEVER sends blind keys: a pane that is neither shell nor dialog gets zero extra keystrokes', async () => {
    const { deps, calls } = makeDeps({
      paneCommand: () => 'node', // never exits within the window
      capturePane: () => 'ordinary streaming output, no dialog here',
    })
    const outcome = await runStopSequence(SESSION, 'claude', deps)
    expect(outcome).toEqual({ status: 'ok', abandonPromptConfirmed: false })
    expect(calls).toHaveLength(3) // C-c, /exit, Enter — nothing more
  })

  it('codex path never probes the pane (its exit has no such dialog)', async () => {
    let captured = 0
    const { deps } = makeDeps({ capturePane: () => { captured++; return '' } })
    await runStopSequence(SESSION, 'codex', deps)
    expect(captured).toBe(0)
  })

  it('a probe failure is non-fatal: the stop still reports ok (the keys already landed)', async () => {
    const { deps } = makeDeps({
      paneCommand: () => { throw new Error('tmux: session gone mid-probe') },
    })
    const outcome = await runStopSequence(SESSION, 'claude', deps)
    expect(outcome).toEqual({ status: 'ok', abandonPromptConfirmed: false })
  })
})
