import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  enqueueCommand,
  listQueue,
  cancelEntry,
  peekNext,
  dequeueNext,
  loadQueue,
  dedupeKey,
  findDuplicate,
  type CommandQueueEntry,
} from '@/lib/command-queue'
import { evaluateExitGate } from '@/lib/session-safe-state'

// Every fs-touching test uses a throwaway dir (the `dir` testability seam), so
// nothing writes into the real ~/.aimaestro/command-queue.
let tmpDir: string
const AGENT = 'agent-uuid-1'

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdq-test-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('command-queue persistence + FIFO', () => {
  it('persists an entry to disk and survives a simulated server restart', () => {
    const r = enqueueCommand(AGENT, { commandKey: 'compact', when: 'idle' }, tmpDir)
    expect(r.ok).toBe(true)

    // "restart": a fresh read from the SAME file path via loadQueue must still
    // see the entry (no in-memory state carried over — it comes off disk).
    const reread = loadQueue(AGENT, tmpDir)
    expect(reread).toHaveLength(1)
    expect(reread[0].commandKey).toBe('compact')
    expect(reread[0].id).toBeTruthy()
    // And it is a real file on disk.
    expect(fs.existsSync(path.join(tmpDir, `${AGENT}.json`))).toBe(true)
  })

  it('drains three entries in FIFO order', () => {
    enqueueCommand(AGENT, { command: 'first', when: 'idle' }, tmpDir)
    enqueueCommand(AGENT, { command: 'second', when: 'idle' }, tmpDir)
    enqueueCommand(AGENT, { command: 'third', when: 'idle' }, tmpDir)

    expect(peekNext(AGENT, tmpDir)!.command).toBe('first')
    expect(dequeueNext(AGENT, tmpDir)!.command).toBe('first')
    expect(dequeueNext(AGENT, tmpDir)!.command).toBe('second')
    expect(dequeueNext(AGENT, tmpDir)!.command).toBe('third')
    expect(dequeueNext(AGENT, tmpDir)).toBeNull()
  })

  it('dedupes an identical enqueue (same command + when) rather than flooding', () => {
    const a = enqueueCommand(AGENT, { command: '/status', when: 'idle' }, tmpDir)
    expect(a.ok).toBe(true)
    const b = enqueueCommand(AGENT, { command: '/status', when: 'idle' }, tmpDir)
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.status).toBe(409)
    expect(listQueue(AGENT, tmpDir)).toHaveLength(1)
  })

  it('does NOT dedupe when `when` differs (different scheduling intent)', () => {
    enqueueCommand(AGENT, { command: '/status', when: 'idle' }, tmpDir)
    const b = enqueueCommand(AGENT, { command: '/status', when: 'online' }, tmpDir)
    expect(b.ok).toBe(true)
    expect(listQueue(AGENT, tmpDir)).toHaveLength(2)
  })

  it('cancels exactly one entry by id and leaves the others intact', () => {
    const a = enqueueCommand(AGENT, { command: 'a', when: 'idle' }, tmpDir)
    const b = enqueueCommand(AGENT, { command: 'b', when: 'idle' }, tmpDir)
    const c = enqueueCommand(AGENT, { command: 'c', when: 'idle' }, tmpDir)
    expect(a.ok && b.ok && c.ok).toBe(true)
    if (!b.ok) return

    expect(cancelEntry(AGENT, b.entry.id, tmpDir)).toBe(true)
    const remaining = listQueue(AGENT, tmpDir).map((e) => e.command)
    expect(remaining).toEqual(['a', 'c'])

    // Cancelling an unknown id is a no-op that reports false.
    expect(cancelEntry(AGENT, 'no-such-id', tmpDir)).toBe(false)
  })

  it('rejects a bad shape: neither or both of command/commandKey', () => {
    const neither = enqueueCommand(AGENT, { when: 'idle' }, tmpDir)
    expect(neither.ok).toBe(false)
    if (!neither.ok) expect(neither.status).toBe(400)

    const both = enqueueCommand(AGENT, { command: 'x', commandKey: 'compact', when: 'idle' }, tmpDir)
    expect(both.ok).toBe(false)

    const badWhen = enqueueCommand(
      AGENT,
      { command: 'x', when: 'someday' as unknown as CommandQueueEntry['when'] },
      tmpDir,
    )
    expect(badWhen.ok).toBe(false)
  })

  it('defaults `when` to idle and carries wakeFirst through', () => {
    const r = enqueueCommand(AGENT, { command: 'x', wakeFirst: true }, tmpDir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.entry.when).toBe('idle')
      expect(r.entry.wakeFirst).toBe(true)
    }
  })
})

describe('command-queue pure ops', () => {
  it('dedupeKey ignores wakeFirst (a repeat with a wake hint still coalesces)', () => {
    const base = { command: 'c', commandKey: undefined, when: 'idle' as const }
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base }))
    const entries: CommandQueueEntry[] = [
      { id: '1', agentId: AGENT, command: 'c', when: 'idle', wakeFirst: true, createdAt: 'x' },
    ]
    expect(findDuplicate(entries, base)).toBeDefined()
  })
})

describe('drain safety gate (evaluateExitGate — the drainer consults this)', () => {
  it('blocks the drain only when subagents are PROVEN running and not forced', () => {
    // >0 subagents, no force → blocked (drain must NOT send).
    expect(evaluateExitGate(2, false).blocked).toBe(true)
    // unknown (null) → never blocks (counter is not trustworthy enough to refuse).
    expect(evaluateExitGate(null, false).blocked).toBe(false)
    // zero → not blocked.
    expect(evaluateExitGate(0, false).blocked).toBe(false)
  })
})
