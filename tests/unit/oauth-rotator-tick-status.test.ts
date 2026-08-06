import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { statePath } from '@/lib/ecosystem-constants'
import { writeTickStatus, readTickStatus, readTickWindows } from '@/lib/oauth-rotator/tick-status'

// 0-IMPACT: HOME → temp so statePath() writes the stamp inside the temp dir; no credential, no
// network, no real state dir touched. Mirrors oauth-rotator-server-tick.test.ts's HOME guard, and
// hard-asserts the resolved stamp path lands inside temp before any write.
let saved: string | undefined
let tmpDir: string

beforeEach(() => {
  saved = process.env.HOME
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-tickstatus-'))
  process.env.HOME = tmpDir
  const f = statePath('oauth-rotator-tick-status.json')
  if (!f.startsWith(tmpDir)) throw new Error(`refusing to run: stamp path ${f} escaped tmp ${tmpDir}`)
})

afterEach(() => {
  if (saved === undefined) delete process.env.HOME
  else process.env.HOME = saved
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

describe('tick-status — writeTickStatus / readTickStatus (PERSIST-THEN-READ, TRDD-1GGQ4HWY)', () => {
  it('persists a valid cascade result and reads it back', () => {
    writeTickStatus({ nextAction: 'rotating', switched: true })
    expect(readTickStatus()).toBe('rotating')
  })

  it('round-trips each valid cascade state', () => {
    for (const s of ['ok', 'rotating', 'reauth-needed', 'stuck'] as const) {
      writeTickStatus({ nextAction: s })
      expect(readTickStatus()).toBe(s)
    }
  })

  // ── `stuck` must SURVIVE the write (measured outage, 2026-08-06) ──────────────
  //
  // The tick already computed `stuck`, already logged it, and already raised
  // `rotator-stuck:all-maxed` in the alert store. What it did NOT do was put it anywhere
  // the persisted status could carry — so through a 3.7-day rotation outage this file said
  // `{"nextAction":"ok"}`, which is what the dashboard and any script read. The owner found
  // out by hitting a rate limit and rotating accounts by hand.
  //
  // Hence a round-trip test rather than a write-only one: the failure was not that the value
  // was computed wrong, it was that it never reached disk.
  //
  // NEUTER RUNS (2026-08-06 — OBSERVED via scripts/dev/neuter, restores blob-verified). Two
  // mutations, aimed at the gate's two independent halves — WHICH state persists, and WHETHER
  // its reason rides along:
  //   s|if \(typeof sk === 'string' && VALID_STUCK\.has\(sk\)\) payload\.stuck = sk as StuckReason|// NEUTERED|
  //     → 1 red / 12 green:
  //         carries WHY it is stuck, because the two reasons have opposite remedies
  //   s|'reauth-needed', 'stuck'\]|'reauth-needed']|
  //     → 4 red / 9 green:
  //         carries WHY it is stuck … / DROPS an unrecognised stuck reason … /
  //         persists a stuck tick AS stuck — never as ok / round-trips each valid cascade state
  // The second is deliberately coarse: dropping 'stuck' from VALID makes the whole write a
  // no-op, so every stuck assertion falls. The first isolates the reason alone, which is the
  // half a reader needs in order to know whether to WAIT or to go re-login.

  it('persists a stuck tick AS stuck — never as ok', () => {
    writeTickStatus({ nextAction: 'stuck', stuck: 'all-maxed', switched: false })
    expect(readTickStatus()).toBe('stuck')
    // The literal the outage produced. Asserting `!== 'ok'` alone would also pass on null.
    expect(readTickStatus()).not.toBe('ok')
  })

  it('carries WHY it is stuck, because the two reasons have opposite remedies', () => {
    // `all-maxed` means wait for a window; `cannot-rotate-offline` means a human is needed.
    // A bare `stuck` cannot tell a reader which, so the reason rides along like `reason` does
    // for reauth-needed.
    const file = statePath('oauth-rotator-tick-status.json')
    writeTickStatus({ nextAction: 'stuck', stuck: 'cannot-rotate-offline' })
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).stuck).toBe('cannot-rotate-offline')
  })

  it('DROPS an unrecognised stuck reason rather than writing a value the reader rejects', () => {
    // Same discipline as `reason`: the stamp must never carry a token the read side would
    // refuse, or the file becomes a second vocabulary that disagrees with the type.
    const file = statePath('oauth-rotator-tick-status.json')
    writeTickStatus({ nextAction: 'stuck', stuck: 'invented-reason' })
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(parsed.stuck).toBeUndefined()
    expect(readTickStatus()).toBe('stuck') // the state itself still persists
  })

  it('is a no-op on a lock-held null result — the last good value is not clobbered', () => {
    writeTickStatus({ nextAction: 'reauth-needed' })
    writeTickStatus(null) // withTickLock returned null: a concurrent beat held the lock
    expect(readTickStatus()).toBe('reauth-needed')
  })

  it('is a no-op on an undefined / shapeless / invalid result', () => {
    writeTickStatus(undefined) // stubbed beat (server-tick tests use `async () => {}`)
    expect(readTickStatus()).toBeNull()
    writeTickStatus({ nextAction: 'bogus' })
    expect(readTickStatus()).toBeNull()
    writeTickStatus({ notNextAction: 'ok' })
    expect(readTickStatus()).toBeNull()
  })

  it('returns null (safe default) when the stamp file is absent', () => {
    expect(readTickStatus()).toBeNull()
  })

  it('returns null when the stamp is unparseable garbage', () => {
    const f = statePath('oauth-rotator-tick-status.json')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'not json{')
    expect(readTickStatus()).toBeNull()
  })

  it('ignores a STALE stamp (older than the freshness window) but honours a fresh one', () => {
    writeTickStatus({ nextAction: 'rotating' })
    // now() is seconds-since-epoch (matching tick.ts); 10 min in the future is beyond MAX_AGE_S.
    const tenMinAhead = () => Date.now() / 1000 + 600
    expect(readTickStatus({ now: tenMinAhead })).toBeNull()
    expect(readTickStatus()).toBe('rotating') // still fresh when read at ~now
  })
})

describe('tick-status — the reason field (why a reauth-needed is needed)', () => {
  it('persists a valid reason alongside nextAction', () => {
    writeTickStatus({ nextAction: 'reauth-needed', reason: 'slot-unreadable' })
    const raw = JSON.parse(fs.readFileSync(statePath('oauth-rotator-tick-status.json'), 'utf8'))
    expect(raw.nextAction).toBe('reauth-needed')
    expect(raw.reason).toBe('slot-unreadable')
  })

  it('DROPS an unrecognised reason rather than writing a value the reader would reject', () => {
    writeTickStatus({ nextAction: 'reauth-needed', reason: 'something-invented' })
    const raw = JSON.parse(fs.readFileSync(statePath('oauth-rotator-tick-status.json'), 'utf8'))
    expect(raw.nextAction).toBe('reauth-needed') // the action still lands
    expect(raw.reason).toBeUndefined() // the bogus attribution does not
  })

  it('omits reason entirely for a healthy tick, and readTickStatus is unaffected by it', () => {
    writeTickStatus({ nextAction: 'ok' })
    const raw = JSON.parse(fs.readFileSync(statePath('oauth-rotator-tick-status.json'), 'utf8'))
    expect('reason' in raw).toBe(false)
    expect(readTickStatus()).toBe('ok') // the existing 5-field contract is untouched
  })
})

describe('tick-status — the persisted WINDOW snapshot (the cross-beat join)', () => {
  const raw = () => JSON.parse(fs.readFileSync(statePath('oauth-rotator-tick-status.json'), 'utf8'))

  const WINDOWS = { fiveHourPct: 42, sevenDayPct: 60, scopedModel: 'Fable 5', scopedPct: 98 }

  it('persists the windows so a beat with no credential access can see them', () => {
    // The whole point: the fleet watchdog has agents and no credential data; this tick has
    // credential data and no agents. Before this the stamp carried neither percentage.
    writeTickStatus({ nextAction: 'stuck', stuck: 'all-maxed', windows: WINDOWS })
    expect(raw().windows).toEqual(WINDOWS)
  })

  it('writes NO windows key when the tick never probed — the old stamp shape is unchanged', () => {
    writeTickStatus({ nextAction: 'ok' })
    expect(raw()).not.toHaveProperty('windows')
  })

  it('voids the snapshot when a scoped percentage names no model', () => {
    // The sweep JOINS on the model, so a percentage naming nothing cannot reach any agent.
    writeTickStatus({ nextAction: 'ok', windows: { ...WINDOWS, scopedModel: null } })
    expect(raw()).not.toHaveProperty('windows')
  })

  it('voids the snapshot when nothing was measured at all', () => {
    // A snapshot of nulls would make an unprobed tick look probed.
    writeTickStatus({
      nextAction: 'ok',
      windows: { fiveHourPct: null, sevenDayPct: null, scopedModel: 'Fable 5', scopedPct: null },
    })
    expect(raw()).not.toHaveProperty('windows')
  })

  it('drops an out-of-range or non-numeric percentage to UNKNOWN, keeping the rest', () => {
    // Safe ONLY because the consumer fails safe on null: planModelFallback treats an unknown
    // account window as EXHAUSTED and refuses to act, so a half-known snapshot can prevent a
    // switch but never cause one.
    writeTickStatus({
      nextAction: 'ok',
      windows: { ...WINDOWS, fiveHourPct: 999, sevenDayPct: 'sixty' },
    })
    expect(raw().windows).toEqual({
      fiveHourPct: null,
      sevenDayPct: null,
      scopedModel: 'Fable 5',
      scopedPct: 98,
    })
  })

  it('never lets a malformed windows value break the rest of the stamp', () => {
    writeTickStatus({ nextAction: 'rotating', windows: 'not an object' })
    expect(readTickStatus()).toBe('rotating')
    expect(raw()).not.toHaveProperty('windows')
  })
})

describe('tick-status — readTickWindows (what the fleet watchdog consumes)', () => {
  const WINDOWS = { fiveHourPct: 42, sevenDayPct: 60, scopedModel: 'Fable 5', scopedPct: 98 }
  const stampPath = () => statePath('oauth-rotator-tick-status.json')
  /** Hand-write a stamp with an arbitrary age/shape, bypassing writeTickStatus. Must mkdir: the
   *  temp HOME starts empty and only writeTickStatus creates the state dir. */
  const putStamp = (obj: Record<string, unknown>) => {
    fs.mkdirSync(path.dirname(stampPath()), { recursive: true })
    fs.writeFileSync(stampPath(), JSON.stringify(obj))
  }

  it('reads back a fresh snapshot', () => {
    writeTickStatus({ nextAction: 'stuck', stuck: 'all-maxed', windows: WINDOWS })
    expect(readTickWindows()).toEqual(WINDOWS)
  })

  it('REFUSES a stale snapshot — an old "Fable 98%" may describe a window that has since reset', () => {
    // This matters more than it does for readTickStatus: that one degrades to a heuristic, this
    // one feeds a decision to type into a live pane.
    putStamp({ nextAction: 'ok', at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), windows: WINDOWS })
    expect(readTickWindows()).toBeNull()
  })

  it('returns null when the stamp carries no windows at all', () => {
    writeTickStatus({ nextAction: 'ok' })
    expect(readTickWindows()).toBeNull()
  })

  it('RE-VALIDATES on read, not just on write', () => {
    // The file is on disk: it can be hand-edited, truncated, or written by an older build whose
    // rules differed. A reader that trusts its own writer is correct only while exactly one
    // version has ever run. Here: a scoped percentage naming no model, which the sweep cannot join.
    putStamp({
      nextAction: 'ok',
      at: new Date().toISOString(),
      windows: { ...WINDOWS, scopedModel: null },
    })
    expect(readTickWindows()).toBeNull()
  })

  it('still yields windows when nextAction is UNRECOGNISED', () => {
    // Pins the decoupling from readTickStatus: tying the windows' validity to whether the ACTION
    // parsed would discard perfectly good measurements over an unrelated vocabulary mismatch.
    putStamp({ nextAction: 'a-verb-from-a-future-build', at: new Date().toISOString(), windows: WINDOWS })
    expect(readTickStatus()).toBeNull()
    expect(readTickWindows()).toEqual(WINDOWS)
  })
})

/*
 * NEUTER RUNS for the window snapshot (2026-08-06 — OBSERVED via scripts/dev/neuter,
 * restore verified by blob hash):
 *
 *   s/if \(scopedPct !== null && scopedModel === null\) return null/if (false) return null/
 *   → 1 red / 18 green:  voids the snapshot when a scoped percentage names no model
 *
 *   s/if \(fiveHourPct === null && sevenDayPct === null && scopedPct === null\) return null/if (false) return null/
 *   → 1 red / 18 green:  voids the snapshot when nothing was measured at all
 *
 *   s/ && v >= 0 && v <= 100//
 *   → 1 red / 18 green:  drops an out-of-range or non-numeric percentage to UNKNOWN, keeping the rest
 *
 * A note on what is NOT pinned here, because it is a property of the CONSUMER and not of this
 * file: dropping a percentage to null is safe only while `planModelFallback` treats an unknown
 * account window as EXHAUSTED. Nothing in this file would redden if that changed, so the
 * requirement is stated in `windowsFor`'s comment rather than claimed as tested.
 */
