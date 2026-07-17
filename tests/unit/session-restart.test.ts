/**
 * Unit tests for lib/session-restart.ts (TRDD-4P1M8I18 Phase 1).
 *
 * The security-critical construction helpers are pure and tested directly.
 * The stop→poll→relaunch sequence is tested with INJECTED exec/sleep/pane stubs
 * — no real tmux, no real timers — so every path (exit, timeout, abandon-confirm,
 * exec-error, capture-failure) is covered with zero side effects.
 */
import { describe, it, expect } from 'vitest'
import {
  isValidProgramArgs,
  sanitizePersonaName,
  resolveRestartBin,
  buildRelaunchCommand,
  runRestartSequence,
  type RestartSequenceDeps,
} from '@/lib/session-restart'

describe('isValidProgramArgs (CC-GOV-002 allowlist)', () => {
  it('accepts the empty string (no extra args)', () => {
    expect(isValidProgramArgs('')).toBe(true)
  })
  it('accepts allowlisted flags/values', () => {
    expect(isValidProgramArgs('--agent my-main-agent')).toBe(true)
    expect(isValidProgramArgs('--model claude-opus-4-8 --dir /a/b.c=1:2,3@x~y "quoted"')).toBe(true)
  })
  it('rejects shell metacharacters that could break out of the --name quoting', () => {
    for (const bad of ['a;b', 'a$b', 'a`b`', 'a&b', 'a|b', 'a(b)', 'a<b', 'a>b', 'a\\b', "a'b", 'a\nb']) {
      expect(isValidProgramArgs(bad)).toBe(false)
    }
  })
})

describe('sanitizePersonaName (API-MAJ-03 allowlist)', () => {
  it('preserves a clean display name', () => {
    expect(sanitizePersonaName('Peter Bot 2.0-x_y', 'fallback')).toBe('Peter Bot 2.0-x_y')
  })
  it('strips characters that could break the quoted --name argument', () => {
    // ", $, (, ) are removed; letters survive.
    expect(sanitizePersonaName('evil"$(rm -rf)', 'fallback')).toBe('evilrm -rf')
  })
  it('falls back when the sanitized result is empty', () => {
    expect(sanitizePersonaName('$$$`;|', 'session-1')).toBe('session-1')
  })
})

describe('resolveRestartBin', () => {
  it('maps display names to CLI binaries', () => {
    expect(resolveRestartBin('Claude Code')).toBe('claude')
    expect(resolveRestartBin('codex')).toBe('codex')
    expect(resolveRestartBin('Gemini')).toBe('gemini')
    expect(resolveRestartBin('aider')).toBe('aider')
  })
  it('falls back to claude for an unrecognized program', () => {
    expect(resolveRestartBin('some-unknown-thing')).toBe('claude')
  })
})

describe('buildRelaunchCommand (--name injection)', () => {
  it('appends --name when absent and no divider', () => {
    expect(buildRelaunchCommand('claude', '--foo bar', 'Peter')).toBe('claude --foo bar --name "Peter"')
  })
  it('appends --name to empty args', () => {
    expect(buildRelaunchCommand('claude', '', 'Peter')).toBe('claude --name "Peter"')
  })
  it('leaves an existing --name untouched (no duplicate)', () => {
    expect(buildRelaunchCommand('claude', '--name "X"', 'Peter')).toBe('claude --name "X"')
  })
  it('inserts --name BEFORE a " -- " raw-prompt divider', () => {
    expect(buildRelaunchCommand('claude', '--foo -- raw prompt', 'Peter')).toBe(
      'claude --foo --name "Peter" -- raw prompt',
    )
  })
})

// --- runRestartSequence: injected stubs, no real tmux/timers -----------------

const SESSION = 'test-session'
const CMD = 'claude --name "Peter"'

function makeDeps(overrides: Partial<RestartSequenceDeps> = {}): {
  deps: RestartSequenceDeps
  calls: string[][]
} {
  const calls: string[][] = []
  const deps: RestartSequenceDeps = {
    exec: (bin, args) => { calls.push([bin, ...args]); return '' },
    sleep: () => Promise.resolve(), // instant — no real timers
    paneCommand: () => 'zsh',       // default: exits on the first poll
    capturePane: () => '',
    ...overrides,
  }
  return { deps, calls }
}

const enterCount = (calls: string[][]) =>
  calls.filter((c) => c.includes('send-keys') && c[c.length - 1] === 'Enter').length

describe('runRestartSequence — exit-ok path', () => {
  it('sends the stop sequence then the relaunch command and returns ok', async () => {
    const { deps, calls } = makeDeps({ paneCommand: () => 'zsh' })
    const outcome = await runRestartSequence(SESSION, CMD, deps)
    expect(outcome).toEqual({ status: 'ok', command: CMD })
    // stop: C-c, -l /exit, Enter ; relaunch: -l <cmd>, Enter
    expect(calls).toContainEqual(['tmux', 'send-keys', '-t', SESSION, 'C-c'])
    expect(calls).toContainEqual(['tmux', 'send-keys', '-t', SESSION, '-l', '/exit'])
    expect(calls).toContainEqual(['tmux', 'send-keys', '-t', SESSION, '-l', CMD])
    expect(enterCount(calls)).toBe(2) // one after /exit, one after relaunch
  })
})

describe('runRestartSequence — timeout path', () => {
  it('never becomes a shell → timeout, and the relaunch command is NOT sent', async () => {
    const { deps, calls } = makeDeps({ paneCommand: () => 'claude', capturePane: () => 'nothing here' })
    const outcome = await runRestartSequence(SESSION, CMD, deps)
    expect(outcome).toEqual({ status: 'timeout' })
    expect(calls).not.toContainEqual(['tmux', 'send-keys', '-t', SESSION, '-l', CMD])
  })
})

describe('runRestartSequence — abandon-confirmation path', () => {
  it('confirms the abandon dialog at half-timeout, then exits ok', async () => {
    let poll = 0
    const { deps, calls } = makeDeps({
      // 'claude' for polls 1..10 (reaches the 5000ms abandon probe), then 'zsh'.
      paneCommand: () => { poll += 1; return poll <= 10 ? 'claude' : 'zsh' },
      capturePane: () => 'There are background subagents running.\nExit anyway? (y/n)',
    })
    const outcome = await runRestartSequence(SESSION, CMD, deps)
    expect(outcome).toEqual({ status: 'ok', command: CMD })
    // three Enters: after /exit, the abandon-confirm Enter, and after relaunch.
    expect(enterCount(calls)).toBe(3)
  })
})

describe('runRestartSequence — exec-error path', () => {
  it('surfaces { status: error } with the detail, never throwing', async () => {
    const { deps } = makeDeps({
      exec: () => { throw new Error('tmux: no server running') },
    })
    const outcome = await runRestartSequence(SESSION, CMD, deps)
    expect(outcome).toEqual({ status: 'error', detail: 'tmux: no server running' })
  })
})

describe('runRestartSequence — capture failure is non-fatal', () => {
  it('a throwing capturePane at the abandon probe does not abort the poll loop', async () => {
    const { deps } = makeDeps({
      paneCommand: () => 'claude', // never a shell → runs to timeout
      capturePane: () => { throw new Error('capture-pane failed') },
    })
    const outcome = await runRestartSequence(SESSION, CMD, deps)
    expect(outcome).toEqual({ status: 'timeout' }) // swallowed, loop kept its timeout
  })
})
