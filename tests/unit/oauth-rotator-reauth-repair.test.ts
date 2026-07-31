/**
 * The REPAIR leg re-captures a dead slot with nobody at the keyboard (TRDD-CVQJNW3A).
 *
 * That is a bigger promise than anything else in the rotator: every attempt OPENS A VISIBLE
 * BROWSER WINDOW on the owner's screen. So most of what follows is not about the happy path — it
 * is about the three gates that decide whether a window opens AT ALL, and each is asserted so that
 * removing it turns a test red rather than turning the fleet into a window-per-minute machine.
 *
 * Every collaborator is injected. Nothing here reads the developer's real keychain, real state
 * dir, or opens a real browser — except the one test that exercises the real flag reader, which
 * points HOME at a temp dir first (0-IMPACT).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  repairOneDeadSlot,
  reauthRepairEnabled,
  REAUTH_REPAIR_FLAG,
  REPAIR_COOLDOWN_MS,
  __resetRepairCooldownForTest,
  type RepairDeps,
} from '@/lib/oauth-rotator/reauth-repair'
import type { AlternateSurvey } from '@/lib/oauth-rotator/tick'

const DEAD = 'dead@example.com'
const DEAD2 = 'dead2@example.com'
const URL = 'https://claude.ai/oauth/authorize?client_id=x&state=STATE123'

/** A drive/complete pair that always succeeds, plus recorders so a test can assert WHAT was asked
 *  for — the hint, the absence of a pinned browser — not merely that something was called. */
function harness(over: Partial<RepairDeps> = {}) {
  const driveCalls: unknown[] = []
  const hints: (string | null | undefined)[] = []
  // The recorders WRAP whatever the test supplied, and are installed AFTER the spread. Putting
  // them inside the defaults instead is a trap I walked into: a test that overrode `drive` to
  // return a failure lost the recorder with it, so its `driveCalls` assertion compared an empty
  // array to an empty array while the outcome assertion above it passed. A recorder that only
  // records the path a test replaced records nothing about that test.
  const innerStart: NonNullable<RepairDeps['start']> =
    over.start ?? (() => ({ authorizeUrl: URL, state: 'STATE123' }))
  const innerDrive: NonNullable<RepairDeps['drive']> =
    over.drive ?? (async () => ({ ok: true, code: 'thecode', via: null }))
  const deps: RepairDeps = {
    enabledCheck: () => true,
    survey: () => ({ unreadable: [], refreshDead: [DEAD] }),
    now: () => 1_000_000,
    complete: async () => ({ ok: true, email: DEAD, hasRefreshToken: true, expiresInH: 8 }),
    ...over,
    start: (opts) => {
      hints.push(opts?.emailHint)
      return innerStart(opts)
    },
    drive: async (opts, d) => {
      driveCalls.push(opts)
      return innerDrive(opts, d)
    },
  }
  return { deps, driveCalls, hints }
}

beforeEach(() => __resetRepairCooldownForTest())

describe('gate 1 — the flag is absent by default, and it is checked FIRST', () => {
  it('returns disabled WITHOUT surveying: an unarmed server pays nothing, not even a keychain read', async () => {
    const survey = vi.fn<() => AlternateSurvey>(() => ({ unreadable: [], refreshDead: [DEAD] }))
    const { deps, driveCalls } = harness({ enabledCheck: () => false, survey })
    expect(await repairOneDeadSlot(deps)).toEqual({ outcome: 'disabled' })
    // The survey assertion is the load-bearing one. Were the gate merely LAST, the outcome would
    // still be 'disabled' and this test would pass while every unarmed beat read the keychain.
    expect(survey).not.toHaveBeenCalled()
    expect(driveCalls).toHaveLength(0)
  })
})

describe('reauthRepairEnabled — the real reader, against a temp HOME (0-IMPACT)', () => {
  const saved: Record<string, string | undefined> = {}
  let tmpDir: string
  beforeEach(() => {
    for (const k of ['HOME', 'XDG_STATE_HOME']) saved[k] = process.env[k]
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-repairflag-'))
    process.env.HOME = tmpDir
    delete process.env.XDG_STATE_HOME
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('is false with no flag file, and true once the human creates one', () => {
    expect(reauthRepairEnabled()).toBe(false)
    // Re-derive the path under the TEMP home the same way the function does — asserting against
    // the module-load const would write the developer's real ~/.aimaestro.
    const flag = path.join(tmpDir, '.aimaestro', path.basename(REAUTH_REPAIR_FLAG))
    fs.mkdirSync(path.dirname(flag), { recursive: true })
    fs.writeFileSync(flag, '')
    expect(reauthRepairEnabled()).toBe(true)
  })

  it('is a DIFFERENT file from the tick flag — one switch must never arm both', () => {
    expect(path.basename(REAUTH_REPAIR_FLAG)).not.toBe('oauth-rotator-tick.enabled')
  })
})

describe('what it will and will not try to repair', () => {
  it('does nothing when no alternate has a dead refresh', async () => {
    const { deps, driveCalls } = harness({ survey: () => ({ unreadable: [], refreshDead: [] }) })
    expect(await repairOneDeadSlot(deps)).toEqual({ outcome: 'nothing-to-do' })
    expect(driveCalls).toHaveLength(0)
  })

  it('IGNORES unreadable slots — a re-login cannot fix a keychain this process cannot reach', async () => {
    const { deps, driveCalls } = harness({
      survey: () => ({ unreadable: ['locked@example.com', 'locked2@example.com'], refreshDead: [] }),
    })
    expect(await repairOneDeadSlot(deps)).toEqual({ outcome: 'nothing-to-do' })
    // Driving one would spend a human-visible browser window and then file the result somewhere
    // still unreadable — worse than doing nothing, because it looks like progress.
    expect(driveCalls).toHaveLength(0)
  })

  it('repairs a dead-refresh slot and reports that the repair HOLDS', async () => {
    const { deps, driveCalls } = harness()
    expect(await repairOneDeadSlot(deps)).toEqual({ outcome: 'repaired', email: DEAD })
    expect(driveCalls).toHaveLength(1)
  })

  it('passes the dead account as the hint', async () => {
    const { deps, hints } = harness()
    await repairOneDeadSlot(deps)
    expect(hints).toEqual([DEAD])
  })

  it('pins NO browser — the auto-sweep is WIDER than naming one', async () => {
    const { deps, driveCalls } = harness()
    await repairOneDeadSlot(deps)
    // Measured live: passing --browser DISABLES unbrowse's own multi-browser cookie sweep. Profile
    // targeting is an escalation inside the drive, only after the default lands on a sign-in page.
    expect(driveCalls[0]).toEqual({ authorizeUrl: URL })
  })

  it('reports the account the TOKEN resolved to, not the hint we guessed', async () => {
    // The human at the consent screen may sign in as somebody else; completeReauth files under
    // whoever the token actually belongs to, and the result must say so or the operator is misled.
    const { deps } = harness({
      complete: async () => ({ ok: true, email: 'someoneelse@example.com', hasRefreshToken: true, expiresInH: 8 }),
    })
    expect(await repairOneDeadSlot(deps)).toEqual({ outcome: 'repaired', email: 'someoneelse@example.com' })
  })

  it('does NOT call a refresh-less grant "repaired" — it will die again in hours', async () => {
    const { deps } = harness({
      complete: async () => ({ ok: true, email: DEAD, hasRefreshToken: false, expiresInH: 8 }),
    })
    // Collapsing this into 'repaired' is the false success the whole flow exists to end: the
    // rotator would report the fault fixed and hit the identical wall on the next expiry.
    expect(await repairOneDeadSlot(deps)).toEqual({ outcome: 'repaired-weak', email: DEAD })
  })
})

describe('failures are RESULTS, not exceptions — and they stay diagnosable', () => {
  it('a drive that cannot find the consent control reports why, without re-running it', async () => {
    const { deps } = harness({
      drive: async () => ({ ok: false, reason: 'consent_ambiguous', detail: '2 unrankable controls' }),
    })
    expect(await repairOneDeadSlot(deps)).toEqual({
      outcome: 'drive-failed',
      email: DEAD,
      detail: 'consent_ambiguous: 2 unrankable controls',
    })
  })

  it('a drive failure with no detail still names its reason', async () => {
    const { deps } = harness({ drive: async () => ({ ok: false, reason: 'not_logged_in' }) })
    expect(await repairOneDeadSlot(deps)).toEqual({ outcome: 'drive-failed', email: DEAD, detail: 'not_logged_in' })
  })

  it('a code that the token endpoint refuses is reported as an EXCHANGE failure, not a drive one', async () => {
    // Distinguishing them is the point: a drive failure means the page could not be worked, an
    // exchange failure means it WAS worked and Anthropic said no — opposite next moves.
    const { deps } = harness({ complete: async () => ({ ok: false, reason: 'exchange_failed', status: 400 }) })
    expect(await repairOneDeadSlot(deps)).toEqual({ outcome: 'exchange-failed', email: DEAD, detail: 'exchange_failed' })
  })
})

describe('gate 2 — ONE repair per beat', () => {
  it('drives exactly ONE of three dead slots', async () => {
    const { deps, driveCalls } = harness({
      survey: () => ({ unreadable: [], refreshDead: [DEAD, DEAD2, 'dead3@example.com'] }),
    })
    await repairOneDeadSlot(deps)
    // Three dead slots must not open three windows at once. The next beat takes the next one.
    expect(driveCalls).toHaveLength(1)
  })
})

describe('gate 3 — the per-email cooldown, the only thing between armed and a window per minute', () => {
  it('refuses a second attempt on the same account inside the window', async () => {
    const { deps, driveCalls } = harness({ drive: async () => ({ ok: false, reason: 'timeout' }) })
    expect((await repairOneDeadSlot(deps)).outcome).toBe('drive-failed')
    expect((await repairOneDeadSlot(deps)).outcome).toBe('cooling-down')
    expect(driveCalls).toHaveLength(1)
  })

  it('distinguishes cooling-down from nothing-to-do — a slot that never repairs must stay visible', async () => {
    // Collapsing the two would report a permanently broken account as a healthy fleet.
    const { deps } = harness({ drive: async () => ({ ok: false, reason: 'timeout' }) })
    await repairOneDeadSlot(deps)
    expect((await repairOneDeadSlot(deps)).outcome).toBe('cooling-down')
  })

  it('tries again once the window has elapsed', async () => {
    let clock = 1_000_000
    const { deps, driveCalls } = harness({
      now: () => clock,
      drive: async () => ({ ok: false, reason: 'timeout' }),
    })
    await repairOneDeadSlot(deps)
    clock += REPAIR_COOLDOWN_MS
    expect((await repairOneDeadSlot(deps)).outcome).toBe('drive-failed')
    expect(driveCalls).toHaveLength(2)
  })

  it('is PER-EMAIL: a cooling-down account does not shield a different dead one', async () => {
    let refreshDead = [DEAD]
    const { deps, hints } = harness({
      survey: () => ({ unreadable: [], refreshDead }),
      drive: async () => ({ ok: false, reason: 'timeout' }),
    })
    await repairOneDeadSlot(deps)
    refreshDead = [DEAD, DEAD2]
    expect((await repairOneDeadSlot(deps)).outcome).toBe('drive-failed')
    expect(hints).toEqual([DEAD, DEAD2])
  })

  it('BURNS the cooldown even when the drive THROWS', async () => {
    // Stamping after the attempt instead of before is the difference between one window and a
    // window on every single beat forever, and only a throwing drive can tell the two apart.
    let calls = 0
    const { deps } = harness({
      drive: async () => {
        calls++
        throw new Error('unbrowse exploded')
      },
    })
    await expect(repairOneDeadSlot(deps)).rejects.toThrow('unbrowse exploded')
    expect((await repairOneDeadSlot(deps)).outcome).toBe('cooling-down')
    expect(calls).toBe(1)
  })
})
