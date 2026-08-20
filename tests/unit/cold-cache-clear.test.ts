// The absorbed cold-cache-clear lane — the janitor-named shell-out contract (their
// TRDD-9ZPU69UC): argv-only integration, version-gated on the 3.3.19 flag branch.
// 0-IMPACT: fixture cache trees, spy spawn/claim/stamp — never the real stub or data dir.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  launcherFlagPresent,
  newestCachedVersionDir,
  runColdCacheClear,
  startColdCacheClearScheduler,
} from '@/lib/cold-cache-clear'
import { activeAbsorbedChores, markChoreLive } from '@/lib/janitor-chore-stamp'

/*
 * NEUTER RUNS (2026-08-20 — OBSERVED via scripts/dev/neuter, restores blob-hash-verified):
 *   newest → names[0] (oldest)      → 3 red/6 green (all three version-gate tests)
 *   launcher-absent branch dropped  → 2 red/7 green (never-spawns + dynamic-claim tests)
 *   unarmed gate dropped            → 1 red/8 green (full-no-op test)
 */
function cacheFixture(versions: Record<string, string | null>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-cache-'))
  for (const [v, dispatch] of Object.entries(versions)) {
    const d = path.join(root, v, 'scripts')
    fs.mkdirSync(d, { recursive: true })
    if (dispatch !== null) fs.writeFileSync(path.join(d, 'dispatch.py'), dispatch)
  }
  return root
}

describe('the version gate — NEWEST cache decides, numerically', () => {
  it('numeric segment sort: 3.3.19 beats 3.3.9 (a lexical sort inverts them)', () => {
    const root = cacheFixture({ '3.3.9': 'x', '3.3.19': 'x' })
    expect(newestCachedVersionDir(root)).toBe(path.join(root, '3.3.19'))
  })
  it('suffixed dirs sort by numeric prefix; junk names and a missing root yield null', () => {
    const root = cacheFixture({ '3.1.28-4c79924c94e5': 'x', '3.1.26-3ccab2af86d8': 'x' })
    expect(newestCachedVersionDir(root)).toBe(path.join(root, '3.1.28-4c79924c94e5'))
    expect(newestCachedVersionDir(path.join(root, 'nope'))).toBe(null)
    expect(newestCachedVersionDir(cacheFixture({}))).toBe(null)
  })
  it('flag present in the NEWEST dispatch.py → true; absent there → false even if an OLDER has it', () => {
    const yes = cacheFixture({ '3.3.19': 'if "--run-cold-cache-clear" in argv: ...' })
    expect(launcherFlagPresent(yes)).toBe(true)
    // pre-3.3.19: the stub resolves NEWEST, so an older version's flag is unreachable
    const inverted = cacheFixture({ '3.3.16': 'plain heartbeat only', '3.3.15': 'run-cold-cache-clear' })
    expect(launcherFlagPresent(inverted)).toBe(false)
    // fail-closed: newest dir without a readable dispatch.py
    expect(launcherFlagPresent(cacheFixture({ '3.3.19': null }))).toBe(false)
  })
})

describe('runColdCacheClear — gates in order', () => {
  it('unarmed = full no-op: no probe, no spawn, no claim, no stamp (the janitor keeps the chore)', async () => {
    const probe = vi.fn(() => true)
    const spawn = vi.fn(async () => 0)
    const stamp = vi.fn()
    const r = await runColdCacheClear({ armed: false, probe, spawn, stamp, log: () => {} })
    expect(r).toEqual({ ran: false, rc: null, reason: 'unarmed' })
    expect(probe).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(stamp).not.toHaveBeenCalled()
  })

  it('armed + launcher ABSENT: releases the claim, never spawns (a pre-3.3.19 stub would fire a full heartbeat turn)', async () => {
    const spawn = vi.fn(async () => 0)
    const unmarkLive = vi.fn()
    const r = await runColdCacheClear({
      armed: true,
      probe: () => false,
      spawn,
      unmarkLive,
      stamp: vi.fn(),
      log: () => {},
    })
    expect(r.reason).toBe('launcher-absent')
    expect(spawn).not.toHaveBeenCalled()
    expect(unmarkLive).toHaveBeenCalledTimes(1)
  })

  it('armed + launcher present: claims, stamps on ATTEMPT, spawns; a non-zero rc is logged, never thrown', async () => {
    const markLive = vi.fn()
    const stamp = vi.fn()
    const logs: string[] = []
    const r = await runColdCacheClear({
      armed: true,
      probe: () => true,
      spawn: async () => 3,
      markLive,
      stamp,
      log: (m) => logs.push(m),
    })
    expect(r).toEqual({ ran: true, rc: 3, reason: 'ran' })
    expect(markLive).toHaveBeenCalledTimes(1)
    expect(stamp).toHaveBeenCalledTimes(1) // attempt = stamped, rc regardless
    expect(logs.some((l) => /rc=3/.test(l))).toBe(true)
  })

  it('a throwing spawn is contained (stamped as attempted, reason spawn-failed)', async () => {
    const stamp = vi.fn()
    const r = await runColdCacheClear({
      armed: true,
      probe: () => true,
      spawn: async () => {
        throw new Error('uv gone')
      },
      markLive: () => {},
      stamp,
      log: () => {},
    })
    expect(r.reason).toBe('spawn-failed')
    expect(stamp).toHaveBeenCalledTimes(1)
  })
})

describe('the dynamic claim — self-activates when 3.3.19 lands, no restart', () => {
  const prev = process.env.AIM_COLD_CACHE_CLEAR
  afterEach(() => {
    if (prev === undefined) delete process.env.AIM_COLD_CACHE_CLEAR
    else process.env.AIM_COLD_CACHE_CLEAR = prev
  })

  it('claim appears/disappears with the probe across beats (default mark/unmark wiring)', async () => {
    // Simulate the cache rolling forward mid-run: probe false → claim released; true → claimed.
    await runColdCacheClear({ armed: true, probe: () => true, spawn: async () => 0, stamp: () => {}, log: () => {} })
    expect(activeAbsorbedChores()).toContain('cold-cache-clear')
    await runColdCacheClear({ armed: true, probe: () => false, log: () => {} })
    expect(activeAbsorbedChores()).not.toContain('cold-cache-clear')
  })

  it('scheduler stop releases the claim when armed', () => {
    process.env.AIM_COLD_CACHE_CLEAR = '1'
    markChoreLive('cold-cache-clear')
    const stop = startColdCacheClearScheduler({
      intervalMs: 300_000,
      runBeat: async () => ({ ran: false, rc: null, reason: 'unarmed' }),
    })
    stop?.()
    expect(activeAbsorbedChores()).not.toContain('cold-cache-clear')
  })
})
