/**
 * Tests for the dead-class boot-debounce (TRDD-SX593MDG D2) — the safety guard the (dark,
 * owner-gated) Phase-C hard actuator must consult so it never hard-recovers a FRESHLY-relaunched
 * agent that merely looks dead while its tmux pane is still coming up.
 *
 * 0-IMPACT: `partitionDeadByBootWindow` is PURE. `trackDeadDebounce` is given an explicit
 * `sidecarPath` under a mkdtemp dir, so the real ~/.aimaestro/fleet-dead-since.json is never
 * touched. The core box-2 property — "a dead agent is a hard-recovery candidate ONLY past the boot
 * window" — is proven directly on the pure partition and end-to-end through the sidecar tracker.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { partitionDeadByBootWindow, trackDeadDebounce, deadSincePath } from '@/lib/fleet-dead-debounce'

const WINDOW = 120_000

describe('partitionDeadByBootWindow — pure boot-window partition', () => {
  it('a first-seen dead agent (absent from firstSeen) starts its window now → debouncing', () => {
    const p = partitionDeadByBootWindow({}, ['a1'], 1_000, WINDOW)
    expect(p.debouncing).toEqual(['a1'])
    expect(p.hardRecoverable).toEqual([])
    expect(p.nextFirstSeen).toEqual({ a1: 1_000 }) // its first-seen is stamped at `now`
  })

  it('a dead agent PAST the boot window → hardRecoverable', () => {
    const p = partitionDeadByBootWindow({ a1: 1_000 }, ['a1'], 1_000 + WINDOW + 1, WINDOW)
    expect(p.hardRecoverable).toEqual(['a1'])
    expect(p.debouncing).toEqual([])
    expect(p.nextFirstSeen).toEqual({ a1: 1_000 }) // first-seen is preserved, not reset
  })

  it('a dead agent WITHIN the boot window → still debouncing (strict > boundary)', () => {
    // exactly AT the window is NOT past it — the process may still be booting.
    const p = partitionDeadByBootWindow({ a1: 1_000 }, ['a1'], 1_000 + WINDOW, WINDOW)
    expect(p.debouncing).toEqual(['a1'])
    expect(p.hardRecoverable).toEqual([])
  })

  it('an agent no longer dead is PRUNED from nextFirstSeen (a re-death restarts its window)', () => {
    const p = partitionDeadByBootWindow({ a1: 1_000, a2: 1_000 }, ['a1'], 5_000, WINDOW)
    expect(p.nextFirstSeen).toEqual({ a1: 1_000 }) // a2 (recovered) is dropped
  })

  it('a garbage first-seen value is treated as first-seen-now (fail toward debouncing)', () => {
    const p = partitionDeadByBootWindow({ a1: NaN as unknown as number }, ['a1'], 9_999_999, WINDOW)
    expect(p.debouncing).toEqual(['a1'])
    expect(p.nextFirstSeen.a1).toBe(9_999_999)
  })

  it('partitions a mixed set correctly in one pass', () => {
    const p = partitionDeadByBootWindow({ old: 0, recent: 100_000 }, ['old', 'recent', 'new'], 130_000, WINDOW)
    expect(p.hardRecoverable).toEqual(['old']) // 130k - 0 = 130k > 120k
    expect(p.debouncing.sort()).toEqual(['new', 'recent']) // recent: 30k, new: 0 → both within window
  })
})

describe('trackDeadDebounce — sidecar-backed first-seen (temp path, 0-IMPACT)', () => {
  let tmpDir: string
  let sidecar: string
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-dead-debounce-'))
    sidecar = path.join(tmpDir, 'fleet-dead-since.json')
  })
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  it('first sight → all debouncing; the first-seen epoch persists to the sidecar', () => {
    const p = trackDeadDebounce(['a1'], 1_000, { windowMs: WINDOW, sidecarPath: sidecar })
    expect(p.debouncing).toEqual(['a1'])
    expect(p.hardRecoverable).toEqual([])
    expect(JSON.parse(fs.readFileSync(sidecar, 'utf8'))).toEqual({ a1: 1_000 })
  })

  it('a later sight past the window → hardRecoverable off the PERSISTED first-seen', () => {
    trackDeadDebounce(['a1'], 1_000, { windowMs: WINDOW, sidecarPath: sidecar })
    const p = trackDeadDebounce(['a1'], 1_000 + WINDOW + 1, { windowMs: WINDOW, sidecarPath: sidecar })
    expect(p.hardRecoverable).toEqual(['a1'])
  })

  it('a recovered agent is pruned from the sidecar (its window resets on a future re-death)', () => {
    trackDeadDebounce(['a1'], 1_000, { windowMs: WINDOW, sidecarPath: sidecar })
    trackDeadDebounce([], 2_000, { windowMs: WINDOW, sidecarPath: sidecar }) // a1 recovered
    expect(JSON.parse(fs.readFileSync(sidecar, 'utf8'))).toEqual({})
    // re-death much later still debounces from the NEW first-seen, not the old one
    const p = trackDeadDebounce(['a1'], 999_999, { windowMs: WINDOW, sidecarPath: sidecar })
    expect(p.debouncing).toEqual(['a1'])
  })

  it('an unreadable/corrupt sidecar fails safe → everyone debouncing (NEVER hard-recover on read failure)', () => {
    fs.writeFileSync(sidecar, 'not json{')
    const p = trackDeadDebounce(['a1'], 9_999_999, { windowMs: WINDOW, sidecarPath: sidecar })
    expect(p.hardRecoverable).toEqual([])
    expect(p.debouncing).toEqual(['a1'])
  })

  it('deadSincePath resolves under the state dir', () => {
    expect(deadSincePath().endsWith('fleet-dead-since.json')).toBe(true)
  })
})
