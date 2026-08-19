// TRDD-4QOWVSLU — the absorbed memory-guard lane, a line-faithful port of the janitor's Tier-1 OOM
// guard (memory_guard.py + daemon.py::task_memory_guard). What each closure pins, and the neuter
// that reds EXACTLY it (recorded on the card):
//
//  - the Tier-1 truth table, clause by clause (D1-a signature allowlist, D1-b protected pids and
//    the `claude`-but-not-plugin-CLI rejection, D1-g age gate) — each clause deleted from
//    `isTier1Killable` reds exactly its test;
//  - (D1-e) ONE kill per beat — a second killable row is never touched even when the first kill
//    fails; making the beat loop over candidates reds exactly the one-kill test;
//  - (D1-f) an unknown free reading is a NO-OP: no snapshot, no kill, no stamp; deleting the
//    null early-return reds exactly that test;
//  - default-OFF: unarmed, the beat never calls kill and never stamps but logs the would-kill;
//    inverting `armed` reds exactly the detect-only tests;
//  - the claim is coupled to arming: `activeAbsorbedChores()` carries `memory-guard` only while an
//    ARMED scheduler is running.
//
// All I/O is injected — no process is ever signalled, no ps is ever run, the developer's state dir
// is never written (0-IMPACT).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DEFAULT_ALERT_RSS_KB,
  DEFAULT_MIN_FREE_MB,
  DEFAULT_RUNAWAY_ETIME_S,
  JANITOR_WORKLOAD_SIGNATURES,
  isTier1Killable,
  parseMeminfo,
  parsePsSnapshot,
  parseVmStat,
  runMemoryGuardBeat,
  selectRefusedAlert,
  selectVictim,
  startMemoryGuardScheduler,
  _resetAlertDedupeForTests,
  type ProcRow,
} from '@/lib/memory-guard'
import { activeAbsorbedChores, ABSORBED_CHORES } from '@/lib/janitor-chore-stamp'

const row = (p: Partial<ProcRow> & { pid: number; command: string }): ProcRow => ({
  ppid: 1,
  rssKb: 1000,
  etimeS: DEFAULT_RUNAWAY_ETIME_S + 1,
  ...p,
})
const policy = { protectedPids: new Set([4242, 4243]), minEtimeS: DEFAULT_RUNAWAY_ETIME_S }

describe('parsers (ported doc cases)', () => {
  it('parsePsSnapshot tolerates the header, skips junk, keeps the command verbatim', () => {
    const text = [
      '  PID  PPID    RSS     ELAPSED COMMAND',
      '  123     1  40960  1-02:03:04 /opt/claude plugin   marketplace update --x',
      'garbage line',
      '  124   123    512       05:06 node server.mjs',
      '  125   123    abc       05:06 not-a-number',
    ].join('\n')
    expect(parsePsSnapshot(text)).toEqual([
      { pid: 123, ppid: 1, rssKb: 40960, etimeS: 86400 + 7384, command: '/opt/claude plugin   marketplace update --x' },
      { pid: 124, ppid: 123, rssKb: 512, etimeS: 306, command: 'node server.mjs' },
    ])
  })
  it('parseVmStat sums free+speculative pages; null when "Pages free" is absent (never guess)', () => {
    const out = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:  1000.\nPages active: 99.\nPages speculative: 24.\n'
    expect(parseVmStat(out, 16384)).toBe(Math.floor((1024 * 16384) / (1024 * 1024)))
    expect(parseVmStat('Pages active: 99.\n', 16384)).toBeNull()
    expect(parseVmStat('Pages free: 64.\n', 16384)).toBe(1) // speculative absent ⇒ 0, not null
  })
  it('parseMeminfo reads MemAvailable in kB; null when absent', () => {
    expect(parseMeminfo('MemTotal: 8 kB\nMemAvailable:  2048000 kB\n')).toBe(2000)
    expect(parseMeminfo('MemTotal: 8 kB\n')).toBeNull()
  })
})

describe('isTier1Killable — the USER-signed Decision 1 truth table', () => {
  it('(D1-a) every signature is killable once old enough; a non-signature never is', () => {
    for (const cmd of [
      'claude plugin marketplace update',
      '/usr/local/bin/claude plugin update foo',
      'claude plugin list',
      'python3 /x/oauth_rotator/rotator.py tick',
      'python3 /x/oauth_rotator/reauth.py',
      'python3 /x/oauth_rotator/slot_capture_browser.py',
    ]) {
      expect(isTier1Killable(row({ pid: 1, command: cmd }), policy), cmd).toBe(true)
    }
    expect(JANITOR_WORKLOAD_SIGNATURES).toHaveLength(6)
    // a 40 GB system daemon is NOT a candidate — the allowlist is the whole kill surface
    expect(isTier1Killable(row({ pid: 2, rssKb: 40 * 1024 * 1024, command: '/System/Library/fseventsd' }), policy)).toBe(false)
    expect(isTier1Killable(row({ pid: 3, command: 'node server.mjs' }), policy)).toBe(false)
  })
  it('(D1-b) the user\'s interactive claude session is NEVER killable, whatever its RSS or age', () => {
    for (const cmd of ['claude', 'claude --resume abc', '/Users/x/.local/bin/claude --continue', 'node /x/claude --dangerously-skip-permissions']) {
      expect(isTier1Killable(row({ pid: 9, rssKb: 99_999_999, etimeS: 999_999, command: cmd }), policy), cmd).toBe(false)
    }
  })
  it('(D1-b, clause 3) a claude-shaped command is killable ONLY via the three plugin-CLI signatures — a rotator signature inside a claude argv is refused', () => {
    // matches signature #4 (rotator.py) AND looks like a claude invocation ⇒ the defense-in-depth
    // clause refuses it; this is the test the clause exists for (a future signature edit must not be
    // able to widen onto user sessions silently).
    expect(isTier1Killable(row({ pid: 5, command: 'claude run /x/oauth_rotator/rotator.py' }), policy)).toBe(false)
  })
  it('(D1-b) the caller and its parent are protected by construction', () => {
    expect(isTier1Killable(row({ pid: 4242, command: 'claude plugin list' }), policy)).toBe(false)
    expect(isTier1Killable(row({ pid: 4243, command: 'claude plugin list' }), policy)).toBe(false)
  })
  it('(D1-g) a signature younger than the age gate is a legitimate workload, not a runaway; unparseable etime (0) fails the gate', () => {
    expect(isTier1Killable(row({ pid: 6, etimeS: DEFAULT_RUNAWAY_ETIME_S - 1, command: 'claude plugin update' }), policy)).toBe(false)
    expect(isTier1Killable(row({ pid: 6, etimeS: DEFAULT_RUNAWAY_ETIME_S, command: 'claude plugin update' }), policy)).toBe(true)
    expect(parsePsSnapshot('1 1 1 weird claude plugin update')[0].etimeS).toBe(0)
  })
})

describe('selectors', () => {
  const rows = [
    row({ pid: 10, rssKb: 100, command: 'claude plugin list' }),
    row({ pid: 11, rssKb: 900, command: 'python3 /x/oauth_rotator/rotator.py' }),
    row({ pid: 12, rssKb: 99_999, command: 'claude --resume' }), // refused, biggest
    row({ pid: 13, rssKb: 500, command: 'claude plugin update' }),
  ]
  it('selectVictim returns the SINGLE largest-RSS killable row, never the bigger refused one', () => {
    expect(selectVictim(rows, policy)?.pid).toBe(11)
    expect(selectVictim([rows[2]], policy)).toBeNull()
  })
  it('selectRefusedAlert returns the largest REFUSED row at/above the threshold, null below it', () => {
    expect(selectRefusedAlert(rows, policy, 10_000)?.pid).toBe(12)
    expect(selectRefusedAlert(rows, policy, 100_000)).toBeNull()
    expect(DEFAULT_ALERT_RSS_KB).toBe(4 * 1024 * 1024)
  })
})

describe('runMemoryGuardBeat — daemon.py::task_memory_guard, same order, same early-returns', () => {
  const victimRow = row({ pid: 77, rssKb: 5000, command: 'claude plugin marketplace update' })
  const secondKillable = row({ pid: 78, rssKb: 4000, command: 'claude plugin update' })
  const userSession = row({ pid: 79, rssKb: 9_000_000, command: 'claude --resume' })
  let kill: ReturnType<typeof vi.fn<(pid: number) => Promise<boolean>>>
  let snapshot: ReturnType<typeof vi.fn<() => Promise<ProcRow[]>>>
  let stamp: ReturnType<typeof vi.fn<() => void>>
  let logs: string[]
  const base = () => ({
    armed: true,
    minFreeMb: DEFAULT_MIN_FREE_MB,
    minEtimeS: DEFAULT_RUNAWAY_ETIME_S,
    protectedPids: new Set<number>(),
    snapshot,
    kill,
    stamp,
    log: (m: string) => {
      logs.push(m)
    },
    snapshotFile: '/dev/null/never-written',
  })
  beforeEach(() => {
    kill = vi.fn<(pid: number) => Promise<boolean>>(async () => true)
    snapshot = vi.fn<() => Promise<ProcRow[]>>(async () => [victimRow, secondKillable, userSession])
    stamp = vi.fn<() => void>()
    logs = []
    _resetAlertDedupeForTests()
  })

  it('(D1-f) an unknown free reading is a NO-OP: no snapshot, no kill, no stamp', async () => {
    const r = await runMemoryGuardBeat({ ...base(), freeMb: async () => null })
    expect(r.action).toBe('noop-unknown')
    expect(snapshot).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
    expect(stamp).not.toHaveBeenCalled()
  })
  it('at/above the floor the beat is healthy and never snapshots', async () => {
    const r = await runMemoryGuardBeat({ ...base(), freeMb: async () => DEFAULT_MIN_FREE_MB })
    expect(r.action).toBe('healthy')
    expect(snapshot).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })
  it('(D1-e) under pressure, ARMED: exactly ONE kill — the largest killable — even with two candidates, and the chore is stamped on attempt', async () => {
    kill = vi.fn<(pid: number) => Promise<boolean>>(async () => false) // a FAILED kill must not fall through to the next candidate either
    const r = await runMemoryGuardBeat({ ...base(), kill, freeMb: async () => 100 })
    expect(r.action).toBe('kill-failed')
    expect(kill).toHaveBeenCalledTimes(1)
    expect(kill).toHaveBeenCalledWith(77)
    expect(stamp).toHaveBeenCalledTimes(1)
    expect(logs.some((l) => /KILL FAILED for runaway pid=77/.test(l))).toBe(true)
  })
  it('(D1-h) a successful kill is logged loudly with pid, rss, age, command and the free reading', async () => {
    const r = await runMemoryGuardBeat({ ...base(), freeMb: async () => 100 })
    expect(r.action).toBe('killed')
    expect(logs.some((l) => /KILLED runaway pid=77 rss=5000KB age=\d+s cmd="claude plugin marketplace update" \(free was 100MB/.test(l))).toBe(true)
  })
  it('(D1-b) pressure with only refused rows stands down — no kill — and the S6 alert names the giant once', async () => {
    snapshot = vi.fn<() => Promise<ProcRow[]>>(async () => [userSession])
    const r1 = await runMemoryGuardBeat({ ...base(), snapshot, freeMb: async () => 100, alertRssKb: 1_000_000 })
    expect(r1.action).toBe('stood-down')
    expect(r1.alert?.pid).toBe(79)
    expect(kill).not.toHaveBeenCalled()
    expect(logs.filter((l) => /ALERT: unkillable runaway pid=79/.test(l))).toHaveLength(1)
    const r2 = await runMemoryGuardBeat({ ...base(), snapshot, freeMb: async () => 100, alertRssKb: 1_000_000 })
    expect(r2.action).toBe('stood-down')
    expect(logs.filter((l) => /ALERT: unkillable/.test(l))).toHaveLength(1) // deduped on program+threshold
  })
  it('default-OFF: UNARMED the beat logs what it would kill and calls neither kill nor stamp', async () => {
    const r = await runMemoryGuardBeat({ ...base(), armed: false, freeMb: async () => 100 })
    expect(r.action).toBe('would-kill')
    expect(r.victim?.pid).toBe(77)
    expect(kill).not.toHaveBeenCalled()
    expect(stamp).not.toHaveBeenCalled()
    expect(logs.some((l) => /would kill runaway pid=77 .*\[detect-only: AIM_MEMORY_GUARD not set\]/.test(l))).toBe(true)
  })
  it('the env flag is the only arming path and it is OFF by default', async () => {
    const prev = process.env.AIM_MEMORY_GUARD
    delete process.env.AIM_MEMORY_GUARD
    try {
      const r = await runMemoryGuardBeat({ ...base(), armed: undefined, freeMb: async () => 100 })
      expect(r.action).toBe('would-kill')
      expect(kill).not.toHaveBeenCalled()
      process.env.AIM_MEMORY_GUARD = 'true' // not the exact value ⇒ still off
      expect((await runMemoryGuardBeat({ ...base(), armed: undefined, freeMb: async () => 100 })).action).toBe('would-kill')
      process.env.AIM_MEMORY_GUARD = '1'
      expect((await runMemoryGuardBeat({ ...base(), armed: undefined, freeMb: async () => 100 })).action).toBe('killed')
    } finally {
      if (prev === undefined) delete process.env.AIM_MEMORY_GUARD
      else process.env.AIM_MEMORY_GUARD = prev
    }
  })
})

describe('the claim follows the arming', () => {
  const prev = process.env.AIM_MEMORY_GUARD
  afterEach(() => {
    if (prev === undefined) delete process.env.AIM_MEMORY_GUARD
    else process.env.AIM_MEMORY_GUARD = prev
  })
  it('unarmed scheduler: runs, but memory-guard is NOT in activeAbsorbedChores()', () => {
    delete process.env.AIM_MEMORY_GUARD
    const stop = startMemoryGuardScheduler({ intervalMs: 60_000_000, log: () => {}, runBeat: async () => undefined })
    try {
      expect(stop).not.toBeNull()
      expect(activeAbsorbedChores()).toEqual([...ABSORBED_CHORES])
    } finally {
      stop?.()
    }
  })
  it('armed scheduler: memory-guard is claimed while running and released on stop', () => {
    process.env.AIM_MEMORY_GUARD = '1'
    const stop = startMemoryGuardScheduler({ intervalMs: 60_000_000, log: () => {}, runBeat: async () => undefined })
    try {
      expect(activeAbsorbedChores()).toContain('memory-guard')
    } finally {
      stop?.()
    }
    expect(activeAbsorbedChores()).not.toContain('memory-guard')
  })
  it('interval 0 disables the lane entirely (no scheduler, no claim)', () => {
    process.env.AIM_MEMORY_GUARD = '1'
    expect(startMemoryGuardScheduler({ intervalMs: 0 })).toBeNull()
    expect(activeAbsorbedChores()).not.toContain('memory-guard')
  })
})
