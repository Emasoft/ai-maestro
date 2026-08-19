// TRDD-9FW92242 — the absorbed fleet-stop lane, ported from the janitor's task_fleet_stop +
// lib/fleet_stop.py. 0-IMPACT: stamps land in tmp files, both channels are spies, the flag is
// injected — never the janitor's real control plane, never a real tmux pane or command queue.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearStamps,
  fleetStopEnabled,
  injectionStampKey,
  readStamps,
  runFleetStop,
  selectStopTargets,
  startFleetStopScheduler,
  stopCommandFor,
  type StopSession,
} from '@/lib/fleet-stop'
import { activeAbsorbedChores } from '@/lib/janitor-chore-stamp'

/*
 * NEUTER RUNS (2026-08-20 — OBSERVED via scripts/dev/neuter, restores blob-hash-verified):
 *   dedupe dropped                → 2 red/12 green (dedupe test + box-2 both-halves test)
 *   flag-clear forgets nothing    → 2 red/12 green (forgotten-stamps + box-2 re-inject halves)
 *   detect-only gate dropped      → 1 red/13 green (unarmed fires/stamps nothing)
 *   refused enqueue stamped       → 2 red/12 green (409-retry + throwing-send-not-stamped)
 *   pane-less target planned      → 1 red/13 green (F2 delivery honesty)
 *   HID typing gate dropped       → 1 red/13 green (defer-all-under-HID)
 */
const tmpStamps = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-stop-')), 'stamps.json')
const queueTarget = (agentId: string, extra: Partial<StopSession> = {}): StopSession => ({
  channel: 'queue',
  agentId,
  ...extra,
})
const tmuxTarget = (pid: number, pane: string | null, extra: Partial<StopSession> = {}): StopSession => ({
  channel: 'tmux',
  pid,
  tmuxPane: pane,
  ...extra,
})

describe('stopCommandFor — disarm only (pause is GONE, janitor owner directive 2026-07-31)', () => {
  it('maps disarm to /janitor-disarm and nothing else to anything', () => {
    expect(stopCommandFor('disarm')).toBe('/janitor-disarm')
    expect(stopCommandFor('pause')).toBe(null) // deliberately diverges from the card text — current janitor semantics
    expect(stopCommandFor(null)).toBe(null)
  })
})

describe('fleetStopEnabled — default-OFF, the janitor truthy set', () => {
  it('off by default; the four truthy spellings arm it', () => {
    expect(fleetStopEnabled({})).toBe(false)
    expect(fleetStopEnabled({ AIM_FLEET_STOP: '0' })).toBe(false)
    for (const v of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(fleetStopEnabled({ AIM_FLEET_STOP: v })).toBe(true)
    }
  })
})

describe('selectStopTargets — the three gates, pure', () => {
  it('no flag → no plans; user-active and HID-present targets are deferred', () => {
    const sessions = [queueTarget('a1'), tmuxTarget(42, '%7')]
    expect(selectStopTargets(sessions, { flagState: null, alreadyInjected: new Set(), hidPresent: false })).toEqual([])
    // HID present ⇒ EVERY session counts user-active (the janitor typing gate)
    expect(selectStopTargets(sessions, { flagState: 'disarm', alreadyInjected: new Set(), hidPresent: true })).toEqual([])
    expect(
      selectStopTargets([queueTarget('a1', { userActive: true })], {
        flagState: 'disarm',
        alreadyInjected: new Set(),
        hidPresent: false,
      }),
    ).toEqual([])
  })
  it('F2 delivery honesty: a tmux target with NO pane is skipped WITHOUT a plan (no stamp burned)', () => {
    const plans = selectStopTargets([tmuxTarget(42, null), tmuxTarget(43, '  '), tmuxTarget(44, '%9')], {
      flagState: 'disarm',
      alreadyInjected: new Set(),
      hidPresent: false,
    })
    expect(plans.map((p) => p.pid)).toEqual([44])
    expect(plans[0].tmuxPane).toBe('%9')
  })
  it('dedupe: an already-injected key is skipped; keys are per (target, flag)', () => {
    const t = queueTarget('a1')
    const key = injectionStampKey(t, 'disarm')
    expect(key).toBe('agent:a1:disarm')
    expect(injectionStampKey(tmuxTarget(42, '%7'), 'disarm')).toBe('pid:42:disarm')
    expect(
      selectStopTargets([t], { flagState: 'disarm', alreadyInjected: new Set([key]), hidPresent: false }),
    ).toEqual([])
  })
})

describe('runFleetStop — the beat', () => {
  it('flag absent → stamps are FORGOTTEN so a future disarm re-injects fresh', async () => {
    const file = tmpStamps()
    fs.writeFileSync(file, JSON.stringify({ 'agent:a1:disarm': 123 }))
    const r = await runFleetStop({ flagState: () => null, stampsFile: file, log: () => {} })
    expect(r).toEqual({ flag: null, planned: 0, fired: 0 })
    expect(readStamps(file)).toEqual({}) // cleared
  })

  it('held flag injects each target exactly once; re-set flag re-injects (box 2, both halves)', async () => {
    const file = tmpStamps()
    const enqueue = vi.fn(() => true)
    const deps = {
      flagState: () => 'disarm' as const,
      sessions: async () => [queueTarget('a1')],
      enqueue,
      stampsFile: file,
      armed: true,
      log: () => {},
    }
    const r1 = await runFleetStop(deps)
    expect(r1).toEqual({ flag: 'disarm', planned: 1, fired: 1 })
    expect(enqueue).toHaveBeenCalledWith('a1', '/janitor-disarm')
    // held flag, second beat: the stamp suppresses the re-injection
    const r2 = await runFleetStop(deps)
    expect(r2).toEqual({ flag: 'disarm', planned: 0, fired: 0 })
    expect(enqueue).toHaveBeenCalledTimes(1)
    // flag clears → stamps forgotten → flag re-set → re-injects
    await runFleetStop({ ...deps, flagState: () => null })
    const r4 = await runFleetStop(deps)
    expect(r4.fired).toBe(1)
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it('a REFUSED enqueue (409/queue occupied) is NOT stamped — the next beat retries', async () => {
    const file = tmpStamps()
    const enqueue = vi.fn(() => false)
    const deps = {
      flagState: () => 'disarm' as const,
      sessions: async () => [queueTarget('a1')],
      enqueue,
      stampsFile: file,
      armed: true,
      log: () => {},
    }
    expect((await runFleetStop(deps)).fired).toBe(0)
    expect(readStamps(file)).toEqual({})
    await runFleetStop(deps)
    expect(enqueue).toHaveBeenCalledTimes(2) // retried, not suppressed
  })

  it('tmux channel: the pane receives the literal command; a throwing send is logged, not stamped', async () => {
    const file = tmpStamps()
    const sendToPane = vi.fn(async () => true)
    const r = await runFleetStop({
      flagState: () => 'disarm',
      sessions: async () => [tmuxTarget(42, '%7')],
      sendToPane,
      stampsFile: file,
      armed: true,
      log: () => {},
    })
    expect(r.fired).toBe(1)
    expect(sendToPane).toHaveBeenCalledWith('%7', '/janitor-disarm')
    expect(Object.keys(readStamps(file))).toEqual(['pid:42:disarm'])

    const logs: string[] = []
    const r2 = await runFleetStop({
      flagState: () => 'disarm',
      sessions: async () => [tmuxTarget(43, '%8')],
      sendToPane: async () => {
        throw new Error('pane gone')
      },
      stampsFile: file,
      armed: true,
      log: (m) => logs.push(m),
    })
    expect(r2.fired).toBe(0)
    expect(readStamps(file)['pid:43:disarm']).toBeUndefined()
    expect(logs.some((l) => /pid:43:disarm: FAILED pane gone/.test(l))).toBe(true)
  })

  it('UNARMED = detect-only: plans are logged with the arming hint, nothing fires, nothing stamps', async () => {
    const file = tmpStamps()
    const enqueue = vi.fn(() => true)
    const logs: string[] = []
    const r = await runFleetStop({
      flagState: () => 'disarm',
      sessions: async () => [queueTarget('a1')],
      enqueue,
      stampsFile: file,
      armed: false,
      log: (m) => logs.push(m),
    })
    expect(r).toEqual({ flag: 'disarm', planned: 1, fired: 0 })
    expect(enqueue).not.toHaveBeenCalled()
    expect(fs.existsSync(file)).toBe(false)
    expect(logs.some((l) => /would deliver .* \[detect-only: AIM_FLEET_STOP not set\]/.test(l))).toBe(true)
  })

  it('stamps on ATTEMPT via deps.stamp — every beat, flag or no flag', async () => {
    const stamp = vi.fn()
    await runFleetStop({ flagState: () => null, stampsFile: tmpStamps(), stamp, log: () => {} })
    await runFleetStop({ flagState: () => 'disarm', sessions: async () => [], stampsFile: tmpStamps(), stamp, log: () => {} })
    expect(stamp).toHaveBeenCalledTimes(2)
  })
})

describe('startFleetStopScheduler — claim ONLY when armed (CONDITIONAL_CHORES shape)', () => {
  const prev = process.env.AIM_FLEET_STOP
  afterEach(() => {
    if (prev === undefined) delete process.env.AIM_FLEET_STOP
    else process.env.AIM_FLEET_STOP = prev
  })
  const inertBeat = async () => ({ flag: null, planned: 0, fired: 0 }) as const

  it('unarmed: scheduler runs but NEVER claims fleet-stop (the janitor keeps the chore)', () => {
    delete process.env.AIM_FLEET_STOP
    const stop = startFleetStopScheduler({ intervalMs: 60_000, runBeat: inertBeat })
    try {
      expect(activeAbsorbedChores()).not.toContain('fleet-stop')
    } finally {
      stop?.()
    }
  })
  it('armed: claims fleet-stop while live, releases on stop', () => {
    process.env.AIM_FLEET_STOP = '1'
    const stop = startFleetStopScheduler({ intervalMs: 60_000, runBeat: inertBeat })
    expect(activeAbsorbedChores()).toContain('fleet-stop') // positive control for the row above
    stop?.()
    expect(activeAbsorbedChores()).not.toContain('fleet-stop')
  })
})

describe('stamps store hygiene', () => {
  it('fail-open read on garbage; clearStamps tolerates absence', () => {
    const file = tmpStamps()
    fs.writeFileSync(file, '{not json')
    expect(readStamps(file)).toEqual({})
    fs.writeFileSync(file, '[1,2]')
    expect(readStamps(file)).toEqual({})
    clearStamps(file)
    clearStamps(file) // second clear = no throw
    expect(fs.existsSync(file)).toBe(false)
  })
})
