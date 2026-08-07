/**
 * The absorbed lane's BOOT CATCH-UP (TRDD-PE54D95Q).
 *
 * A bare `setInterval` fires first at boot+INTERVAL, so a host restarted more often than
 * the interval never runs this lane at all — and raising the cadence 1 h → 3 h tripled
 * that window. The fix decides the first fire from the PERSISTED `lastAbsorbedRunAt`
 * rather than from process uptime, which also makes it safe under a restart LOOP: the
 * first catch-up stamps the field, so every reboot inside the interval is "not overdue".
 *
 * Coverage split, stated honestly rather than implied:
 *   - the DECISION is `absorbedDutyIsOverdue`, pure, pinned exhaustively below;
 *   - the WIRING (a catch-up is armed, it consults the persisted stamp, and `stop()`
 *     clears it) is pinned with fake timers;
 *   - the overdue→actually-refresh path is `runAbsorbedDutyTickSafely`, which is the
 *     same function the interval already calls and which
 *     `auto-update-absorbed-duty.test.ts` covers. It is deliberately NOT re-driven here,
 *     because reaching it needs the real `isJanitorInstalledAndArmed()` disk read.
 *
 * 0-IMPACT: `@/services/element-management-service` and `@/lib/marketplace-lock` are
 * mocked, so no real `claude` CLI call and no real lockfile under the developer's
 * `~/.aimaestro`. `loadSettings` is stubbed per-test, so no real settings read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const refreshAllMarketplaces = vi.fn(async () => ({ success: true }))
const changePlugin = vi.fn(async () => ({ success: true }))
vi.mock('@/services/element-management-service', () => ({
  RefreshAllMarketplaces: (...a: unknown[]) => (refreshAllMarketplaces as any)(...a),
  ChangePlugin: (...a: unknown[]) => (changePlugin as any)(...a),
}))

vi.mock('@/lib/marketplace-lock', () => ({
  withMarketplaceLock: async (fn: () => Promise<unknown>) => fn(),
}))

const loadSettingsMock = vi.fn()
vi.mock('@/lib/auto-update-settings', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/auto-update-settings')>()
  return { ...actual, loadSettings: (...a: unknown[]) => (loadSettingsMock as any)(...a) }
})

import {
  absorbedDutyIsOverdue,
  startAbsorbedDutyScheduler,
  stopAbsorbedDutyScheduler,
} from '@/services/auto-update-service'
import { DEFAULT_SETTINGS } from '@/lib/auto-update-settings'

// 3 h → 4 h by USER directive 2026-08-07. The two tests below straddle the interval BOUNDARY on
// purpose (exactly-at → overdue; one minute short → not), so the constant must track the real
// cadence or the pair stops discriminating anything.
const FOUR_HOURS = 4 * 60 * 60 * 1000
const SETTLE = 2 * 60 * 1000
const NOW = Date.parse('2026-08-06T12:00:00+0200')

describe('absorbedDutyIsOverdue — the pure decision', () => {
  it('is overdue when the lane has NEVER run on this host (null stamp)', () => {
    expect(absorbedDutyIsOverdue(null, NOW)).toBe(true)
  })

  it('is overdue when the field is absent entirely (undefined)', () => {
    expect(absorbedDutyIsOverdue(undefined, NOW)).toBe(true)
  })

  it('treats an UNPARSEABLE stamp as never-run, never as fresh', () => {
    // Failing the other way would silently starve the lane forever on one bad write.
    expect(absorbedDutyIsOverdue('not-a-date', NOW)).toBe(true)
  })

  it('is overdue once a full interval has elapsed', () => {
    const last = new Date(NOW - FOUR_HOURS).toISOString()
    expect(absorbedDutyIsOverdue(last, NOW)).toBe(true)
  })

  it('is NOT overdue one minute short of the interval — this is the restart-loop guard', () => {
    const last = new Date(NOW - FOUR_HOURS + 60_000).toISOString()
    expect(absorbedDutyIsOverdue(last, NOW)).toBe(false)
  })

  it('is NOT overdue for a FUTURE stamp (clock moved backwards) rather than storming', () => {
    const last = new Date(NOW + 60 * 60 * 1000).toISOString()
    expect(absorbedDutyIsOverdue(last, NOW)).toBe(false)
  })
})

describe('boot catch-up wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    loadSettingsMock.mockReset()
    refreshAllMarketplaces.mockClear()
  })

  afterEach(() => {
    stopAbsorbedDutyScheduler()
    vi.useRealTimers()
  })

  it('consults the PERSISTED stamp after the settle delay, not process uptime', async () => {
    loadSettingsMock.mockResolvedValue({ ...DEFAULT_SETTINGS, lastAbsorbedRunAt: new Date().toISOString() })
    startAbsorbedDutyScheduler()

    // Nothing before the settle delay — a catch-up that fired instantly would storm on boot.
    await vi.advanceTimersByTimeAsync(SETTLE - 1000)
    expect(loadSettingsMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2000)
    expect(loadSettingsMock).toHaveBeenCalled()
  })

  it('does NOT refresh when the persisted stamp says the lane is still fresh', async () => {
    loadSettingsMock.mockResolvedValue({ ...DEFAULT_SETTINGS, lastAbsorbedRunAt: new Date().toISOString() })
    startAbsorbedDutyScheduler()

    await vi.advanceTimersByTimeAsync(SETTLE + 1000)
    expect(loadSettingsMock).toHaveBeenCalled() // positive control: the branch was reached
    expect(refreshAllMarketplaces).not.toHaveBeenCalled()
  })

  it('stop() clears the PENDING catch-up — a stopped scheduler must not tick after SIGTERM', async () => {
    loadSettingsMock.mockResolvedValue({ ...DEFAULT_SETTINGS, lastAbsorbedRunAt: null })
    startAbsorbedDutyScheduler()
    stopAbsorbedDutyScheduler()

    await vi.advanceTimersByTimeAsync(SETTLE * 2)
    expect(loadSettingsMock).not.toHaveBeenCalled()
    expect(refreshAllMarketplaces).not.toHaveBeenCalled()
  })

  it('a settings read that THROWS does not prevent the repeating interval from being armed', async () => {
    loadSettingsMock.mockRejectedValue(new Error('settings unreadable'))
    startAbsorbedDutyScheduler()

    await vi.advanceTimersByTimeAsync(SETTLE + 1000)
    expect(loadSettingsMock).toHaveBeenCalled()
    // The scheduler survives its own catch-up failing — the interval is what must not die.
    const { isAbsorbedDutySchedulerRunning } = await import('@/services/auto-update-service')
    expect(isAbsorbedDutySchedulerRunning()).toBe(true)
  })
})
