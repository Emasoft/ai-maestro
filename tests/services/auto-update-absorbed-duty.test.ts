/**
 * Tests for the absorbed-duty lane (ai-maestro#102, TRDD-5X3P79Q6): the three
 * chores the janitor daemon ran unconditionally before this server absorbed
 * them — marketplace-refresh, version-update (self-update the janitor),
 * user-plugins-update — must run regardless of `auto-update-settings.json`'s
 * master `enabled` toggle, gated ONLY on `isJanitorInstalledAndArmed()`.
 *
 * 0-IMPACT:
 *   - `runAbsorbedDutyTick` takes injected deps (`isJanitorInstalledAndArmed`,
 *     `readers`), so the decision logic under test never touches the real
 *     filesystem at all.
 *   - `@/services/element-management-service` is mocked — no real
 *     `ChangePlugin`/`UpdateMarketplace` pipeline call, no real `claude`
 *     CLI invocation.
 *   - `@/lib/marketplace-lock` is mocked to bypass the real server-lockfile
 *     (a file-based lock under the developer's real `~/.aimaestro`) with a
 *     pass-through, so the decision-logic tests need no $HOME containment.
 *   - The one test that DOES touch disk (persistence into
 *     auto-update-settings.json) repoints `$HOME` to a fresh temp dir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const refreshAllMarketplaces = vi.fn(async () => ({ success: true }))
const changePlugin = vi.fn(async (_agentId: unknown, _desired: unknown) => ({ success: true }))

vi.mock('@/services/element-management-service', () => ({
  RefreshAllMarketplaces: (...args: unknown[]) => (refreshAllMarketplaces as any)(...args),
  ChangePlugin: (...args: unknown[]) => (changePlugin as any)(...args),
}))

// A vi.fn rather than a bare passthrough so a test can simulate the lock being HELD by another
// process — `withMarketplaceLock` returns null in that case, which is the mechanism that makes
// the refresh single-executor machine-wide (AC3).
const withMarketplaceLockMock = vi.fn(async (fn: () => Promise<unknown>) => fn())
vi.mock('@/lib/marketplace-lock', () => ({
  withMarketplaceLock: (...args: unknown[]) => (withMarketplaceLockMock as any)(...args),
}))

import {
  runAbsorbedDutyTick,
  runAbsorbedDutyTickNow,
  startAbsorbedDutyScheduler,
  stopAbsorbedDutyScheduler,
  isAbsorbedDutySchedulerRunning,
  type CandidateReaders,
} from '@/services/auto-update-service'
// LOCAL_/CUSTOM_MARKETPLACE_NAME are gone with the per-name loop: the refresh no longer takes a
// name, so there are no per-marketplace assertions left to make. MARKETPLACE_NAME survives for the
// janitor self-update, which IS still per-name.
import { MARKETPLACE_NAME } from '@/lib/ecosystem-constants'
import { readChoreStamp } from '@/lib/janitor-chore-stamp'

const JANITOR = 'ai-maestro-janitor'

function fakeReaders(userScope: Array<{ name: string; marketplace: string }> = []): CandidateReaders {
  return {
    listUserScopePlugins: async () => userScope,
    listAgentLocalScopePlugins: async () => [],
    listInstalledPluginsInMarketplace: async () => [],
  }
}

// CONTAINMENT, added with the janitor chore stamps (TRDD-14HI8ZPR). The tick now writes
// `<chore>.last-run.ts` into the janitor control dir, so the file-header claim that these tests
// "never touch the real filesystem at all" stopped being true the moment that landed — without
// this redirect every test below would write the DEVELOPER'S real `~/.claude/janitor-control/`.
// `$JANITOR_CONTROL_DIR` is the same override the janitor itself honours, deliberately: isolating
// one side and not the other would be a silent skew.
let controlDir = ''
let priorControlDir: string | undefined

// CONTAINMENT #2, and it is the same lesson a second time. The tick gained a step that keeps
// `autoUpdate: true` on every marketplace in `~/.claude/settings.json`, and its path argument
// DEFAULTS to that real file. Every `runAbsorbedDutyTick` call below drives the tick body, so on
// the day that step landed this suite rewrote all 257 of the developer's marketplace entries —
// and reported 35/35 GREEN, because nothing here asserts on that file. `settingsPath` must be
// passed explicitly at every call site; `SETTINGS` below is the tmp path to pass.
let settingsDir = ''
/** The tmp settings file every tick call in this file must be pointed at. Deliberately NOT
 *  created: `ensureMarketplaceAutoUpdate` returns 'skipped' for a missing file and — the part
 *  that matters — refuses to create one, so this also exercises that refusal on every call. */
const SETTINGS = () => path.join(settingsDir, '.claude', 'settings.json')

beforeEach(() => {
  refreshAllMarketplaces.mockClear()
  withMarketplaceLockMock.mockClear()
  withMarketplaceLockMock.mockImplementation(async (fn: () => Promise<unknown>) => fn())
  changePlugin.mockClear()
  refreshAllMarketplaces.mockResolvedValue({ success: true })
  changePlugin.mockResolvedValue({ success: true })
  priorControlDir = process.env.JANITOR_CONTROL_DIR
  controlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-chore-stamp-'))
  process.env.JANITOR_CONTROL_DIR = controlDir
  settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-absorbed-settings-'))
  fs.mkdirSync(path.join(settingsDir, '.claude'), { recursive: true })
})

afterEach(() => {
  if (priorControlDir === undefined) delete process.env.JANITOR_CONTROL_DIR
  else process.env.JANITOR_CONTROL_DIR = priorControlDir
  fs.rmSync(controlDir, { recursive: true, force: true })
  fs.rmSync(settingsDir, { recursive: true, force: true })
})

describe('the janitor handover stamp (TRDD-14HI8ZPR / ai-maestro#111)', () => {
  it('writes a last-run stamp for each of the three chores this lane owns', async () => {
    // The defect this pins: the server absorbed these chores and never told the janitor, whose
    // daemon it had suppressed. Every one read as dark for weeks while all three ran hourly.
    await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders(), settingsPath: SETTINGS() })

    for (const chore of ['marketplace-refresh', 'version-update', 'user-plugins-update'] as const) {
      expect(readChoreStamp(chore), `${chore} left no stamp`).not.toBeNull()
    }
  })

  it('stamps EPOCH SECONDS — milliseconds would read as permanently fresh, for ever', async () => {
    // The one wrong answer worse than "stale": a ms value parses fine and lands ~55 000 years
    // out, so every chore would report healthy including the ones that stop running.
    await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders(), settingsPath: SETTINGS() })

    const raw = fs.readFileSync(path.join(controlDir, 'marketplace-refresh.last-run.ts'), 'utf8')
    const secs = Number(raw.trim())
    expect(Number.isInteger(secs)).toBe(true)
    expect(Math.abs(secs * 1000 - Date.now())).toBeLessThan(60_000)
  })

  it('does NOT stamp when the gate refused — an unowned chore must not look owned', async () => {
    // The complement, and the one that makes the two above non-vacuous: if the stamp were written
    // unconditionally, a host where the janitor is uninstalled/disarmed would report every chore
    // fresh while nothing ran.
    await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => false, readers: fakeReaders(), settingsPath: SETTINGS() })

    expect(readChoreStamp('marketplace-refresh')).toBeNull()
  })
})

describe('runAbsorbedDutyTick — gated on isJanitorInstalledAndArmed, NOT on settings.enabled', () => {
  it('does nothing at all when the janitor is not installed+armed (the gate, non-vacuity)', async () => {
    const entries = await runAbsorbedDutyTick({
      isJanitorInstalledAndArmed: () => false,
      readers: fakeReaders(),
      settingsPath: SETTINGS(),
    })
    expect(entries).toEqual([])
    expect(refreshAllMarketplaces).not.toHaveBeenCalled()
    expect(changePlugin).not.toHaveBeenCalled()
  })

  it('refreshes every marketplace in ONE argless call — the per-name loop is gone', async () => {
    // COUNTING THE INVOCATIONS IS THE ASSERTION. The previous shape looped
    // `UpdateMarketplace({ name })` once per registered marketplace — 275 processes and 275 git
    // fetches per tick on this host — and a test asserting only "it succeeded" passes over that
    // loop unchanged. So this pins the COUNT, and it pins it against a reader that reports MANY
    // marketplaces, because a count of 1 taken from a 1-marketplace fixture proves nothing.
    const readers = fakeReaders()
    await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers, settingsPath: SETTINGS() })

    expect(refreshAllMarketplaces).toHaveBeenCalledTimes(1)
    // Argless: the whole point is that no name narrows it. `RefreshAllMarketplaces` takes only an
    // auth context, so a regression that reintroduced per-name filtering could not keep this shape.
    expect(refreshAllMarketplaces.mock.calls[0]).toHaveLength(1)
  })

  it('is single-executor machine-wide — a tick whose lock is HELD refreshes nothing (AC3)', async () => {
    // THE HALF THAT SCALES INTO THE RATE LIMIT. One refresh per 3 h is only true if exactly one
    // executor performs it; a per-session implementation multiplies by the number of live
    // sessions (13 here) and by project count, which is the same per-instance-interval-against-a
    // per-account-limit error filed as ai-maestro-janitor#215. `withMarketplaceLock` returning
    // null IS that mechanism — it means another process holds it — and a single-session test
    // passes this trivially, which is exactly why the contention case has to be driven.
    // NEUTER RUN (2026-08-06 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
    //   dropping the lock — `withMarketplaceLock(() => body(...))` → `body(...)` — at line 310
    //   → 1 red / 15 green: this test. That mutation IS the regression it guards: a lane that
    //   runs the body without taking the machine-wide lock is per-process, and every live
    //   session then refreshes on its own schedule.
    withMarketplaceLockMock.mockImplementation(async () => null)

    const entries = await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders(), settingsPath: SETTINGS() })

    expect(entries).toEqual([])
    expect(refreshAllMarketplaces).not.toHaveBeenCalled()
    expect(changePlugin).not.toHaveBeenCalled()
    // And the lock was genuinely consulted — without this the assertions above would also pass
    // for a tick that simply never ran.
    expect(withMarketplaceLockMock).toHaveBeenCalledTimes(1)
  })

  it('emits ONE summary row for the refresh, not one per marketplace', async () => {
    // The reporting half of the same change: `lastRunSummary` used to fill with hundreds of rows
    // because the loop emitted one entry per name. One operation ⇒ one row.
    const entries = await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders(), settingsPath: SETTINGS() })
    // The load-bearing half is the ABSENCE of the old shape: the loop emitted one
    // `absorbed:marketplace:<name>` row per registered marketplace. Nothing may produce that
    // shape any more. (Note the colon — `absorbed:marketplace-refresh` and
    // `absorbed:marketplace-auto-update` both begin with `absorbed:marketplace`, so a
    // startsWith on that prefix matches the two current rows and asserts nothing.)
    expect(entries.filter(e => e.target.startsWith('absorbed:marketplace:'))).toHaveLength(0)
    expect(entries.filter(e => e.target === 'absorbed:marketplace-refresh')).toHaveLength(1)
  })

  it('self-updates the janitor plugin specifically, at user scope', async () => {
    await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders(), settingsPath: SETTINGS() })

    const janitorCall = changePlugin.mock.calls.find((c) => (c[1] as { name: string }).name === JANITOR)
    expect(janitorCall).toBeDefined()
    expect(janitorCall![1]).toMatchObject({ name: JANITOR, marketplace: MARKETPLACE_NAME, scope: 'user', action: 'update' })
  })

  it('updates every user-scope plugin (the user-plugins-update duty)', async () => {
    const readers = fakeReaders([
      { name: 'ai-maestro-plugin', marketplace: MARKETPLACE_NAME },
      { name: 'some-other-plugin', marketplace: 'some-marketplace' },
    ])
    const entries = await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers, settingsPath: SETTINGS() })

    const updatedNames = changePlugin.mock.calls.map((c) => (c[1] as { name: string }).name)
    expect(updatedNames).toContain('ai-maestro-plugin')
    expect(updatedNames).toContain('some-other-plugin')
    expect(entries.some((e) => e.target.includes('some-other-plugin'))).toBe(true)
  })

  it('a single failed candidate does not abort the rest of the tick', async () => {
    // Was a per-NAME injection back when the refresh looped; the argless refresh has one outcome,
    // so the failure is injected on that one call. The property under test is unchanged and is
    // the one that matters: a chore that fails must not take the other chores down with it.
    refreshAllMarketplaces.mockResolvedValue({ success: false, error: 'boom' } as never)
    const entries = await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders(), settingsPath: SETTINGS() })

    const failed = entries.find((e) => e.target === 'absorbed:marketplace-refresh')
    expect(failed).toMatchObject({ status: 'failed', detail: 'boom' })
    // The janitor self-update (a DIFFERENT chore) still ran despite the refresh failing.
    expect(changePlugin).toHaveBeenCalled()
  })

  it('a thrown exception from one candidate is caught and recorded, never propagated', async () => {
    changePlugin.mockRejectedValueOnce(new Error('pipeline exploded'))
    const entries = await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders(), settingsPath: SETTINGS() })
    expect(entries.some((e) => e.status === 'failed' && e.detail === 'pipeline exploded')).toBe(true)
  })

  it('defaults to the REAL isJanitorInstalledAndArmed when no dep is injected (non-vacuity)', async () => {
    // No override at all — must consult the real lib/janitor-presence check, which reads
    // this process's real $HOME. We don't assert a specific outcome (host-dependent); we
    // only assert it does not throw and returns an array either way.
    // `settingsPath` is still injected, and that is NOT a contradiction of "no override at all":
    // the override under test is the janitor GATE. This one is host-dependent, so on a machine
    // where it returns true the tick body runs — and without this line it would run against the
    // developer's real settings.json. Leaving the gate real while containing the write is the
    // whole point.
    const entries = await runAbsorbedDutyTick({ readers: fakeReaders(), settingsPath: SETTINGS() })
    expect(Array.isArray(entries)).toBe(true)
  })
})

describe('runAbsorbedDutyTickNow — persistence, independent of settings.enabled', () => {
  let tmpHome: string
  let prevHome: string | undefined

  beforeEach(() => {
    prevHome = process.env.HOME
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-absorbed-duty-'))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it('appends run entries into auto-update-settings.json WITHOUT touching `enabled`', async () => {
    // We can't inject deps through runAbsorbedDutyTickNow (it calls the exported
    // runAbsorbedDutyTick() with no overrides), so make the real gate pass by writing a
    // real installed+armed janitor settings.json under the fake $HOME.
    const claudeDir = path.join(tmpHome, '.claude')
    fs.mkdirSync(claudeDir, { recursive: true })
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'ai-maestro-janitor@ai-maestro-plugins': true } }),
    )

    const before = fs.existsSync(path.join(tmpHome, '.aimaestro', 'auto-update-settings.json'))
    expect(before).toBe(false)

    const result = await runAbsorbedDutyTickNow()
    expect(result.ran).toBe(true)
    expect(result.entries.length).toBeGreaterThan(0)

    const settingsPath = path.join(tmpHome, '.aimaestro', 'auto-update-settings.json')
    expect(fs.existsSync(settingsPath)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    // The master toggle must remain untouched (still the shipped default: OFF).
    expect(saved.enabled).toBe(false)
    expect(saved.lastRunSummary.length).toBeGreaterThan(0)
    expect(saved.lastRunSummary.some((e: { target: string }) => e.target.startsWith('absorbed:'))).toBe(true)

    // NEUTER RUN (2026-08-06 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
    //   s/next = \{ \.\.\.next, lastAbsorbedRunAt: nowIso\(\) \}/next = { ...next }/ if $. == 273
    //   → 1 red / 14 green:
    //       appends run entries into auto-update-settings.json WITHOUT touching `enabled`
    // i.e. dropping the stamp reds this test and nothing else — the older assertions in it all
    // survive the drop, which is precisely why they were not enough on their own.
    //
    // AC5 — THE STATE FILE MUST BE HONEST AS A WHOLE, not merely per-field. Every assertion
    // above was already true on the day this file reported `enabled: false` + `lastRunAt: null`
    // while this lane was running hourly and making hundreds of network calls: the only evidence
    // was the wall-clock buried inside the summary rows, which a reader has to know to dig for.
    // That is what made a rate-limit investigation take six wrong hypotheses. So the absorbed
    // lane now stamps its OWN timestamp, and the two lanes stay distinguishable:
    expect(saved.lastAbsorbedRunAt).toEqual(expect.any(String))
    expect(Date.parse(saved.lastAbsorbedRunAt)).not.toBeNaN()
    // ...and `lastRunAt` still belongs to the GATED lane alone, which never ran here. If this
    // ever starts passing as a string, the two lanes have been conflated and the file is lying
    // in the other direction.
    expect(saved.lastRunAt).toBeNull()
  })

  it('when the janitor is NOT installed+armed, no run entries are persisted at all', async () => {
    const result = await runAbsorbedDutyTickNow()
    expect(result.ran).toBe(false)
    expect(result.entries).toEqual([])
    expect(fs.existsSync(path.join(tmpHome, '.aimaestro', 'auto-update-settings.json'))).toBe(false)
  })
})

describe('startAbsorbedDutyScheduler / stopAbsorbedDutyScheduler — the always-on timer', () => {
  it('is idempotent and reports its own running state via isAbsorbedDutySchedulerRunning', () => {
    expect(isAbsorbedDutySchedulerRunning()).toBe(false)
    startAbsorbedDutyScheduler()
    startAbsorbedDutyScheduler() // second call must be a no-op, not a second timer
    expect(isAbsorbedDutySchedulerRunning()).toBe(true)
    stopAbsorbedDutyScheduler()
    expect(isAbsorbedDutySchedulerRunning()).toBe(false)
    stopAbsorbedDutyScheduler() // idempotent stop
    expect(isAbsorbedDutySchedulerRunning()).toBe(false)
  })
})

describe('the absorbed lane cadence — 3 hours (TRDD-PE54D95Q, USER ruling 2026-08-05)', () => {
  // Pinned against the REGISTERED INTERVAL, deliberately, per the card: a wall-clock test
  // would take 3 h to run and would still only prove ONE interval. Spying on setInterval
  // reads the constant the scheduler actually arms itself with, which is the claim.
  //
  // WHY THIS MATTERS ENOUGH TO PIN: the lane's traffic is git-protocol, which counts against
  // NO GitHub API quota — so `gh api rate_limit` reads clean while the lane saturates, and a
  // regression here is invisible to every meter an operator would think to check. The test is
  // the only instrument that sees it.
  //
  // NEUTER RUN (2026-08-06 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
  //   s/3 \* 60 \* 60 \* 1000/60 * 60 * 1000/ if $. == 111
  //   → 1 red / 13 green:
  //       arms its timer at exactly 3 hours, never the 1 hour it used to use
  // The `not.toHaveBeenCalledWith(1 h)` line is the half that names that specific regression;
  // the exact-equality line above it is what rejects any OTHER wrong value, since a bare
  // not-1h would pass at 2 h or 24 h.
  it('arms its timer at exactly 3 hours, never the 1 hour it used to use', () => {
    const spy = vi.spyOn(global, 'setInterval')
    try {
      expect(isAbsorbedDutySchedulerRunning()).toBe(false)
      startAbsorbedDutyScheduler()
      expect(isAbsorbedDutySchedulerRunning()).toBe(true) // non-vacuity: it really armed
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 3 * 60 * 60 * 1000)
      expect(spy).not.toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000)
    } finally {
      stopAbsorbedDutyScheduler()
      spy.mockRestore()
    }
  })
})
