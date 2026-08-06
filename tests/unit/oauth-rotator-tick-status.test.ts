import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { statePath } from '@/lib/ecosystem-constants'
import { writeTickStatus, readTickStatus } from '@/lib/oauth-rotator/tick-status'

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
