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

const updateMarketplace = vi.fn(async (_arg: { name: string }) => ({ success: true }))
const changePlugin = vi.fn(async (_agentId: unknown, _desired: unknown) => ({ success: true }))

vi.mock('@/services/element-management-service', () => ({
  UpdateMarketplace: (...args: unknown[]) => (updateMarketplace as any)(...args),
  ChangePlugin: (...args: unknown[]) => (changePlugin as any)(...args),
}))

vi.mock('@/lib/marketplace-lock', () => ({
  withMarketplaceLock: async <T>(fn: () => Promise<T>) => fn(),
}))

import {
  runAbsorbedDutyTick,
  runAbsorbedDutyTickNow,
  startAbsorbedDutyScheduler,
  stopAbsorbedDutyScheduler,
  isAbsorbedDutySchedulerRunning,
  type CandidateReaders,
} from '@/services/auto-update-service'
import { MARKETPLACE_NAME, LOCAL_MARKETPLACE_NAME, CUSTOM_MARKETPLACE_NAME } from '@/lib/ecosystem-constants'

const JANITOR = 'ai-maestro-janitor'

function fakeReaders(userScope: Array<{ name: string; marketplace: string }> = []): CandidateReaders {
  return {
    listUserScopePlugins: async () => userScope,
    listAgentLocalScopePlugins: async () => [],
    listInstalledPluginsInMarketplace: async () => [],
  }
}

beforeEach(() => {
  updateMarketplace.mockClear()
  changePlugin.mockClear()
  updateMarketplace.mockResolvedValue({ success: true })
  changePlugin.mockResolvedValue({ success: true })
})

describe('runAbsorbedDutyTick — gated on isJanitorInstalledAndArmed, NOT on settings.enabled', () => {
  it('does nothing at all when the janitor is not installed+armed (the gate, non-vacuity)', async () => {
    const entries = await runAbsorbedDutyTick({
      isJanitorInstalledAndArmed: () => false,
      readers: fakeReaders(),
    })
    expect(entries).toEqual([])
    expect(updateMarketplace).not.toHaveBeenCalled()
    expect(changePlugin).not.toHaveBeenCalled()
  })

  it('refreshes every registered marketplace, argless-equivalent, when installed+armed', async () => {
    await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders() })

    const refreshedNames = updateMarketplace.mock.calls.map((c) => (c[0] as { name: string }).name)
    // The 3 always-registered marketplaces, at minimum — the pre-absorption daemon called
    // `claude plugin marketplace update` with no name filter at all.
    expect(refreshedNames).toContain(MARKETPLACE_NAME)
    expect(refreshedNames).toContain(LOCAL_MARKETPLACE_NAME)
    expect(refreshedNames).toContain(CUSTOM_MARKETPLACE_NAME)
  })

  it('self-updates the janitor plugin specifically, at user scope', async () => {
    await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders() })

    const janitorCall = changePlugin.mock.calls.find((c) => (c[1] as { name: string }).name === JANITOR)
    expect(janitorCall).toBeDefined()
    expect(janitorCall![1]).toMatchObject({ name: JANITOR, marketplace: MARKETPLACE_NAME, scope: 'user', action: 'update' })
  })

  it('updates every user-scope plugin (the user-plugins-update duty)', async () => {
    const readers = fakeReaders([
      { name: 'ai-maestro-plugin', marketplace: MARKETPLACE_NAME },
      { name: 'some-other-plugin', marketplace: 'some-marketplace' },
    ])
    const entries = await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers })

    const updatedNames = changePlugin.mock.calls.map((c) => (c[1] as { name: string }).name)
    expect(updatedNames).toContain('ai-maestro-plugin')
    expect(updatedNames).toContain('some-other-plugin')
    expect(entries.some((e) => e.target.includes('some-other-plugin'))).toBe(true)
  })

  it('a single failed candidate does not abort the rest of the tick', async () => {
    updateMarketplace.mockImplementation(async ({ name }: { name: string }) =>
      name === MARKETPLACE_NAME ? { success: false, error: 'boom' } : { success: true },
    )
    const entries = await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders() })

    const failed = entries.find((e) => e.target === `absorbed:marketplace:${MARKETPLACE_NAME}`)
    expect(failed).toMatchObject({ status: 'failed', detail: 'boom' })
    // The janitor self-update (a DIFFERENT candidate) still ran despite the marketplace failure.
    expect(changePlugin).toHaveBeenCalled()
  })

  it('a thrown exception from one candidate is caught and recorded, never propagated', async () => {
    changePlugin.mockRejectedValueOnce(new Error('pipeline exploded'))
    const entries = await runAbsorbedDutyTick({ isJanitorInstalledAndArmed: () => true, readers: fakeReaders() })
    expect(entries.some((e) => e.status === 'failed' && e.detail === 'pipeline exploded')).toBe(true)
  })

  it('defaults to the REAL isJanitorInstalledAndArmed when no dep is injected (non-vacuity)', async () => {
    // No override at all — must consult the real lib/janitor-presence check, which reads
    // this process's real $HOME. We don't assert a specific outcome (host-dependent); we
    // only assert it does not throw and returns an array either way.
    const entries = await runAbsorbedDutyTick({ readers: fakeReaders() })
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
