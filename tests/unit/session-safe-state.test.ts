/**
 * lib/session-safe-state.ts (TRDD-O8NCNRWO)
 *
 * The safe-state helpers behind the stop/restart subagent gate. The trust
 * model under test: only a PROVEN positive counter blocks (a null/absent/0
 * counter can be stale-low per Emasoft/ai-maestro-plugin#17, so it must
 * never be treated as proof of safety NOR as a reason to refuse service).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

let tmpStateDir: string

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  return {
    ...original,
    statePath: (sub: string) => path.join(tmpStateDir, sub),
  }
})

import { readSubagentCount, evaluateExitGate, looksLikeAbandonPrompt } from '@/lib/session-safe-state'

const WORKDIR = '/Users/someone/agents/test-agent'

// The HOOK's derivation (sha256 since ai-maestro-plugin 2026-05-08): the fixture sits where the
// hook writes. This file was green for three months placing fixtures at the md5 path while the
// reader also used md5 and production read a file that did not exist (lib/chat-state-path.ts).
const HOOK_HASH = crypto.createHash('sha256').update(WORKDIR).digest('hex').substring(0, 16)
const MD5_ERA_HASH = crypto.createHash('md5').update(WORKDIR).digest('hex').substring(0, 16)

function writeState(state: Record<string, unknown>, hash: string = HOOK_HASH) {
  const dir = path.join(tmpStateDir, 'chat-state')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${hash}.json`), JSON.stringify(state))
}

describe('readSubagentCount', () => {
  beforeEach(() => {
    tmpStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-state-'))
  })
  afterEach(() => {
    fs.rmSync(tmpStateDir, { recursive: true, force: true })
  })

  it('returns null for a missing workdir (unknown, not safe)', () => {
    expect(readSubagentCount(undefined)).toBeNull()
    expect(readSubagentCount(null)).toBeNull()
    expect(readSubagentCount('')).toBeNull()
  })

  it('returns null when no chat-state file exists for the workdir', () => {
    expect(readSubagentCount(WORKDIR)).toBeNull()
  })

  it('returns the numeric counter when present', () => {
    writeState({ status: 'waiting_for_input', subagentCount: 3 })
    expect(readSubagentCount(WORKDIR)).toBe(3)
  })

  it('returns 0 when the counter is explicitly zero (still never blocks)', () => {
    writeState({ status: 'waiting_for_input', subagentCount: 0 })
    expect(readSubagentCount(WORKDIR)).toBe(0)
  })

  it('returns null when the field is absent (the plugin#17 stale-low shape)', () => {
    writeState({ status: 'waiting_for_input', notificationType: 'idle_prompt' })
    expect(readSubagentCount(WORKDIR)).toBeNull()
  })

  it('returns null for non-numeric, negative, or non-finite values', () => {
    writeState({ subagentCount: 'two' })
    expect(readSubagentCount(WORKDIR)).toBeNull()
    writeState({ subagentCount: -1 })
    expect(readSubagentCount(WORKDIR)).toBeNull()
    writeState({ subagentCount: Number.NaN })
    expect(readSubagentCount(WORKDIR)).toBeNull()
  })

  it('reads the file the HOOK writes (sha256 path) and NEVER the md5-era path — the 3-month regression', () => {
    writeState({ subagentCount: 3 }, MD5_ERA_HASH) // only the relic path exists
    expect(readSubagentCount(WORKDIR)).toBeNull()
    writeState({ subagentCount: 3 }) // now the hook's path exists too
    expect(readSubagentCount(WORKDIR)).toBe(3)
  })

  it("prefers the hook's own index.json mapping over any derivation", () => {
    const dir = path.join(tmpStateDir, 'chat-state')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ [WORKDIR]: '0123456789abcdef' }))
    writeState({ subagentCount: 1 }, '0123456789abcdef')
    writeState({ subagentCount: 9 }) // a derived-path decoy must lose to the index
    expect(readSubagentCount(WORKDIR)).toBe(1)
  })

  it('returns null on malformed JSON instead of throwing', () => {
    const dir = path.join(tmpStateDir, 'chat-state')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${HOOK_HASH}.json`), '{not json')
    expect(readSubagentCount(WORKDIR)).toBeNull()
  })
})

describe('evaluateExitGate', () => {
  it('blocks only on a proven positive count without force', () => {
    expect(evaluateExitGate(2, false)).toEqual({ blocked: true, subagentCount: 2 })
  })

  it('never blocks on zero or unknown counts (stale-low tolerance)', () => {
    expect(evaluateExitGate(0, false).blocked).toBe(false)
    expect(evaluateExitGate(null, false).blocked).toBe(false)
  })

  it('programRunning=false (pane provably at a shell) never blocks — the stale-HIGH escape', () => {
    // Measured 2026-08-20: a force-stop orphans the counter at 1 forever (SubagentStop never
    // fires), and without this escape every later stop/restart 409s on a dead session.
    expect(evaluateExitGate(1, false, false)).toEqual({ blocked: false, subagentCount: 1 })
  })

  it('programRunning true/null/undefined keeps the conservative block on a positive count', () => {
    expect(evaluateExitGate(1, false, true).blocked).toBe(true)
    expect(evaluateExitGate(1, false, null).blocked).toBe(true)
    expect(evaluateExitGate(1, false, undefined).blocked).toBe(true)
  })

  it('force overrides a positive count', () => {
    expect(evaluateExitGate(5, true)).toEqual({ blocked: false, subagentCount: 5 })
  })
})

describe('looksLikeAbandonPrompt', () => {
  it('matches the background-agents exit-confirmation shapes', () => {
    expect(looksLikeAbandonPrompt('You have 2 background agents running. Exit anyway?')).toBe(true)
    expect(looksLikeAbandonPrompt('Running subagents will be abandoned. Are you sure you want to exit?')).toBe(true)
    expect(looksLikeAbandonPrompt('Exit now? 1 background agent is still running')).toBe(true)
  })

  it("matches CC 2.1.235's ACTUAL dialog (captured live 2026-08-19) — it never says 'agents'", () => {
    // The wording that made both probes blind until measured: prose family 2 + menu family 3.
    const live = [
      'Background work is running',
      'The following will stop when you exit:',
      'shell · end=$((SECONDS+170)); until [ $SECONDS -ge $end ]…',
      '❯ 1. Exit and stop tasks',
    ].join('\n')
    expect(looksLikeAbandonPrompt(live)).toBe(true)
    // each family carries the detection alone (the copy has changed once already):
    expect(looksLikeAbandonPrompt('Background work is running')).toBe(true)
    expect(looksLikeAbandonPrompt('❯ 1. Exit and stop tasks')).toBe(true)
  })

  it('does not match ordinary prompts or unrelated output', () => {
    expect(looksLikeAbandonPrompt('❯ ')).toBe(false)
    expect(looksLikeAbandonPrompt('Do you want to allow this tool call?')).toBe(false)
    expect(looksLikeAbandonPrompt('build finished with 0 errors')).toBe(false)
  })
})
