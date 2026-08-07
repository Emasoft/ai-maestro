/**
 * Behavioral-parity tests for the oauth-rotator supervisor port (TRDD-7DRSIKVZ) — the faithful TS
 * port of the janitor daemon's oauth_rotator/supervisor.py (the alert-only governance layer).
 *
 * 0-IMPACT: `diagnose` is PURE (hand-built Facts, no I/O). The I/O helpers (trackCannotSelfRenew,
 * tickCompletedAgeS, optInPresent, gatherFacts) run against a throwaway mkdtemp root and inject
 * `readSlotBlob`/`daemonAlive`/`now`, so no real OS keychain and no real rotator state is ever
 * touched. The whole point of the port's design split is that the decision logic is testable with
 * zero network and zero keychain — these tests prove exactly the six finding branches supervisor.py
 * emits, plus the D3 cookie-leg sidecar persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  diagnose, apply, optInPresent, tickCompletedAgeS, trackCannotSelfRenew, gatherFacts,
  PINNING_ENV, SETUP_REMIND_DAYS, TICK_STALL_ALERT_S, COOKIE_LEG_ALERT_S,
  type Facts, type SlotFact,
} from '@/lib/oauth-rotator/supervisor'
import { serverTickAgeS } from '@/lib/oauth-rotator/server-supervisor'
import { DEFAULT_MAX_REFRESH_FAILURES } from '@/lib/oauth-rotator/cascade'
import type { CredentialBlob } from '@/lib/oauth-rotator/slots'

let tmpDir: string
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-oauth-supervisor-'))
  // A pinning env var leaking in from the host would corrupt the pinning-env branch — snapshot + clear.
  for (const v of PINNING_ENV) {
    savedEnv[v] = process.env[v]
    delete process.env[v]
  }
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  for (const v of PINNING_ENV) {
    if (savedEnv[v] === undefined) delete process.env[v]
    else process.env[v] = savedEnv[v]
  }
})

/** A healthy, self-renewable slot (has a refresh token, plenty of runway). */
function healthySlot(email = 'ok@b.com'): SlotFact {
  return { email, hasRefresh: true, expiresDays: 100, refreshFailures: 0, cannotSelfRenewAgeS: null }
}

/** A Facts skeleton: opted-in macOS host, nothing wrong — override fields per test. */
function baseFacts(over: Partial<Facts> = {}): Facts {
  return {
    root: '/tmp/aim-test-rotator-root',
    optIn: true,
    onMacos: true,
    pinningEnv: [],
    slots: [],
    tickCompletedAgeS: 0,
    daemonAlive: true,
    ...over,
  }
}

const codes = (fs_: { code: string }[]) => fs_.map((f) => f.code)

describe('supervisor.diagnose — the opt-in gate + rotation-defeating conditions', () => {
  it('opt-in OFF → no findings at all (silent no-op), even with problems present', () => {
    const f = baseFacts({
      optIn: false,
      pinningEnv: ['ANTHROPIC_API_KEY'],
      onMacos: false,
      slots: [{ email: 'x@b.com', hasRefresh: false, expiresDays: 1, refreshFailures: 0, cannotSelfRenewAgeS: COOKIE_LEG_ALERT_S + 1 }],
    })
    expect(diagnose(f)).toEqual([])
  })

  it('a pinning env var → one pinning-env finding per var', () => {
    const f = baseFacts({ pinningEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] })
    const out = diagnose(f)
    expect(codes(out)).toEqual(['pinning-env', 'pinning-env'])
    expect(out[0].message).toContain('ANTHROPIC_API_KEY')
    expect(out[1].message).toContain('CLAUDE_CODE_OAUTH_TOKEN')
  })

  it('opted-in but NON-macOS → non-macos finding AND short-circuits (no per-slot alerts)', () => {
    // A dying, no-refresh, cookie-leg-stuck slot would normally add two findings — the non-macos
    // early return must suppress them (the keychain swap can't run here anyway).
    const f = baseFacts({
      onMacos: false,
      slots: [{ email: 'x@b.com', hasRefresh: false, expiresDays: 1, refreshFailures: 0, cannotSelfRenewAgeS: COOKIE_LEG_ALERT_S + 1 }],
    })
    expect(codes(diagnose(f))).toEqual(['non-macos'])
  })

  it('pinning-env is reported even on a non-macos host (it precedes the short-circuit)', () => {
    const f = baseFacts({ onMacos: false, pinningEnv: ['ANTHROPIC_AUTH_TOKEN'] })
    expect(codes(diagnose(f))).toEqual(['pinning-env', 'non-macos'])
  })
})

describe('supervisor.diagnose — tick-stalled (daemon-alive gated)', () => {
  it('daemon alive + tick age past the threshold → tick-stalled', () => {
    expect(codes(diagnose(baseFacts({ tickCompletedAgeS: TICK_STALL_ALERT_S + 1 })))).toContain('tick-stalled')
  })

  it('daemon alive + tick NEVER stamped (null age) → tick-stalled', () => {
    expect(codes(diagnose(baseFacts({ tickCompletedAgeS: null })))).toContain('tick-stalled')
  })

  it('daemon alive + tick age within the threshold → NO tick-stalled', () => {
    expect(codes(diagnose(baseFacts({ tickCompletedAgeS: TICK_STALL_ALERT_S - 1 })))).not.toContain('tick-stalled')
  })

  it('daemon DOWN → NO tick-stalled even with a null/stale stamp (a dead daemon is its own problem)', () => {
    expect(codes(diagnose(baseFacts({ daemonAlive: false, tickCompletedAgeS: null })))).not.toContain('tick-stalled')
    expect(codes(diagnose(baseFacts({ daemonAlive: false, tickCompletedAgeS: TICK_STALL_ALERT_S + 999 })))).not.toContain('tick-stalled')
  })

  it('points at the ABSOLUTE shared-log path from the GATHERED root, not a bare filename', () => {
    // The alert used to read "Check rotator.log", which nobody can act on: the file lives under a
    // plugin data dir no one memorises. The root is deliberately distinctive so this fails BOTH
    // ways it can regress — reverting to the bare name (no absolute path), and reaching for the
    // ambient rotatorRoot() instead of the root these facts were actually gathered from.
    const root = '/tmp/aim-distinct-root-for-this-assertion'
    const f = baseFacts({ root, tickCompletedAgeS: TICK_STALL_ALERT_S + 1 })
    const msg = diagnose(f).find((x) => x.code === 'tick-stalled')?.message ?? ''
    expect(msg).toContain(`${root}/rotator.log`)
  })
})

describe('supervisor.diagnose — per-slot credential alerts', () => {
  it('a no-refresh setup token expiring within SETUP_REMIND_DAYS → setup-token-expiring', () => {
    const f = baseFacts({ slots: [{ email: 's@b.com', hasRefresh: false, expiresDays: SETUP_REMIND_DAYS - 1, refreshFailures: 0, cannotSelfRenewAgeS: null }] })
    expect(codes(diagnose(f))).toEqual(['setup-token-expiring'])
  })

  it('a no-refresh token with plenty of runway → NO setup-token-expiring', () => {
    const f = baseFacts({ slots: [{ email: 's@b.com', hasRefresh: false, expiresDays: SETUP_REMIND_DAYS + 1, refreshFailures: 0, cannotSelfRenewAgeS: null }] })
    expect(codes(diagnose(f))).toEqual([])
  })

  it('a token WITH a refresh path → never a setup-token-expiring alert (it can keepalive-refresh)', () => {
    const f = baseFacts({ slots: [{ email: 's@b.com', hasRefresh: true, expiresDays: 1, refreshFailures: 0, cannotSelfRenewAgeS: null }] })
    expect(codes(diagnose(f))).toEqual([])
  })

  it('a slot stuck in the human-only renew leg past COOKIE_LEG_ALERT_S → cookie-leg-stuck', () => {
    const f = baseFacts({ slots: [{ ...healthySlot('c@b.com'), cannotSelfRenewAgeS: COOKIE_LEG_ALERT_S + 1 }] })
    expect(codes(diagnose(f))).toEqual(['cookie-leg-stuck'])
  })

  it('a slot within the cookie-leg grace window → NO cookie-leg-stuck', () => {
    const f = baseFacts({ slots: [{ ...healthySlot('c@b.com'), cannotSelfRenewAgeS: COOKIE_LEG_ALERT_S - 1 }] })
    expect(codes(diagnose(f))).toEqual([])
  })

  it('fully healthy opted-in macOS host → no findings', () => {
    expect(diagnose(baseFacts({ slots: [healthySlot()] }))).toEqual([])
  })
})

describe('supervisor.trackCannotSelfRenew — the D3 cookie-leg sidecar (temp root, 0-IMPACT)', () => {
  const dying = (email: string, over: Partial<SlotFact> = {}): SlotFact => ({
    email, hasRefresh: false, expiresDays: 0, refreshFailures: 0, cannotSelfRenewAgeS: null, ...over,
  })

  it('a no-refresh dying slot is stamped age 0 on first sight, and the first-seen epoch persists', () => {
    const first = trackCannotSelfRenew(tmpDir, [dying('a@b.com')], 1000)
    expect(first[0].cannotSelfRenewAgeS).toBe(0)
    // second pass at a later `now` grows the age off the PERSISTED first-seen, not the new now
    const later = trackCannotSelfRenew(tmpDir, [dying('a@b.com')], 1500)
    expect(later[0].cannotSelfRenewAgeS).toBe(500)
  })

  it('a refresh token that is DEAD (failures ≥ the cascade max) counts as cannot-self-renew', () => {
    const [s] = trackCannotSelfRenew(tmpDir, [dying('a@b.com', { hasRefresh: true, refreshFailures: DEFAULT_MAX_REFRESH_FAILURES })], 2000)
    expect(s.cannotSelfRenewAgeS).toBe(0)
  })

  it('a healthy self-renewable slot stays null AND is pruned from the sidecar', () => {
    // seed the sidecar with a stuck slot, then re-run with it now healthy
    trackCannotSelfRenew(tmpDir, [dying('a@b.com')], 1000)
    const healthy = trackCannotSelfRenew(tmpDir, [healthySlot('a@b.com')], 2000)
    expect(healthy[0].cannotSelfRenewAgeS).toBeNull()
    const sidecar = JSON.parse(fs.readFileSync(path.join(tmpDir, 'cookie-leg-since.json'), 'utf8'))
    expect(sidecar['a@b.com']).toBeUndefined()
  })

  it('a no-refresh token with runway (a healthy ~1y setup token) does NOT trip the login age', () => {
    const [s] = trackCannotSelfRenew(tmpDir, [dying('a@b.com', { expiresDays: 300 })], 1000)
    expect(s.cannotSelfRenewAgeS).toBeNull() // dying-clause requires expiresDays < 1
  })
})

describe('supervisor — filesystem helpers (temp root)', () => {
  it('optInPresent reflects the opt-in.flag', () => {
    expect(optInPresent(tmpDir)).toBe(false)
    fs.writeFileSync(path.join(tmpDir, 'opt-in.flag'), '')
    expect(optInPresent(tmpDir)).toBe(true)
  })

  it('tickCompletedAgeS reads the stamp; missing/garbage → null (which diagnose treats as stalled)', () => {
    expect(tickCompletedAgeS(tmpDir, 5000)).toBeNull()
    fs.writeFileSync(path.join(tmpDir, 'tick-completed.ts'), '4700')
    expect(tickCompletedAgeS(tmpDir, 5000)).toBe(300)
    fs.writeFileSync(path.join(tmpDir, 'tick-completed.ts'), 'not-a-number')
    expect(tickCompletedAgeS(tmpDir, 5000)).toBeNull()
  })
})

describe('supervisor.gatherFacts — the I/O wiring (injected deps, temp root, 0-IMPACT)', () => {
  const NOW = 1_800_000_000 // fixed epoch seconds

  function armRoot(stateSlots: Record<string, unknown>): void {
    fs.writeFileSync(path.join(tmpDir, 'opt-in.flag'), '')
    fs.writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify({ slots: stateSlots }))
    fs.writeFileSync(path.join(tmpDir, 'tick-completed.ts'), String(NOW - 120))
  }

  it('assembles Facts from the root + injected blob reader + daemonAlive + now', () => {
    armRoot({ 'a@b.com': { refresh_failures: 0 } })
    // a no-refresh token 10 days from expiry (a setup-token-expiring candidate)
    const blob: CredentialBlob = { claudeAiOauth: { expiresAt: (NOW + 10 * 86400) * 1000 } } as CredentialBlob
    const facts = gatherFacts({
      root: tmpDir,
      deps: { readSlotBlob: () => blob, daemonAlive: () => true, now: () => NOW },
    })
    expect(facts.optIn).toBe(true)
    expect(facts.daemonAlive).toBe(true)
    expect(facts.tickCompletedAgeS).toBe(120)
    expect(facts.pinningEnv).toEqual([]) // cleared in beforeEach
    expect(facts.slots).toHaveLength(1)
    expect(facts.slots[0].email).toBe('a@b.com')
    expect(facts.slots[0].hasRefresh).toBe(false)
    expect(Math.round(facts.slots[0].expiresDays as number)).toBe(10)
    // and the assembled facts drive the expected finding (force onMacos so the test is platform-independent)
    expect(codes(diagnose({ ...facts, onMacos: true }))).toContain('setup-token-expiring')
  })

  it('opt-in flag ABSENT → no keychain access, empty slots, null tick age, daemonAlive false', () => {
    fs.writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify({ slots: { 'a@b.com': {} } }))
    let readCalls = 0
    const facts = gatherFacts({
      root: tmpDir,
      deps: { readSlotBlob: () => { readCalls++; return null }, daemonAlive: () => true, now: () => NOW },
    })
    expect(facts.optIn).toBe(false)
    expect(facts.slots).toEqual([])
    expect(facts.tickCompletedAgeS).toBeNull()
    expect(facts.daemonAlive).toBe(false) // gated off with opt-in
    expect(readCalls).toBe(0) // the keychain reader was never called
    expect(diagnose(facts)).toEqual([])
  })
})

describe('supervisor.apply', () => {
  it('records every finding code and logs each once', () => {
    const logs: string[] = []
    const res = apply(
      [{ code: 'pinning-env', message: 'm1' }, { code: 'tick-stalled', message: 'm2' }],
      (m) => logs.push(m),
    )
    expect(res.alerts).toEqual(['pinning-env', 'tick-stalled'])
    expect(logs).toHaveLength(2)
    expect(logs[0]).toContain('pinning-env')
    expect(logs[1]).toContain('tick-stalled')
  })

  it('is a no-op on an empty finding list', () => {
    expect(apply([]).alerts).toEqual([])
  })
})

/**
 * TRDD-IGCSDTIU — the server must judge its OWN tick's liveness, not the janitor's stamp.
 *
 * The bug these pin: `tick-completed.ts` is written ONLY by the janitor's rotator, and the janitor
 * daemon exits while a server owns the host — so on a server-owned host it freezes, `diagnose` reads
 * "armed + stale", and `tick-stalled` fires forever claiming `rotation is effectively OFF` while the
 * tick beats every 60 s. Measured on the live host: 368930 s claimed, matching the frozen stamp's
 * age to the second.
 *
 * The pair is deliberately COMPLEMENTARY. One neuter certifies only half a conditional, and this
 * bug lives entirely in the half nothing exercised — so "the false alarm is gone" is pinned
 * alongside "a genuinely hung tick STILL alerts". Silencing a false alarm must not silence the
 * true one; that is the failure mode of a careless fix here.
 */
describe('supervisor — server tick-liveness probe (TRDD-IGCSDTIU)', () => {
  const NOW = 1_800_000_000 // fixed epoch SECONDS

  let savedControlDir: string | undefined
  beforeEach(() => {
    savedControlDir = process.env.JANITOR_CONTROL_DIR
    // Redirect the machine-global chore-stamp dir into the throwaway root: 0-IMPACT, and without
    // this the probe would read (and the suite would depend on) the developer's real stamp.
    process.env.JANITOR_CONTROL_DIR = path.join(tmpDir, 'janitor-control')
    fs.mkdirSync(process.env.JANITOR_CONTROL_DIR, { recursive: true })
  })
  afterEach(() => {
    if (savedControlDir === undefined) delete process.env.JANITOR_CONTROL_DIR
    else process.env.JANITOR_CONTROL_DIR = savedControlDir
  })

  function stampOwnTick(epochSeconds: number): void {
    fs.writeFileSync(
      path.join(process.env.JANITOR_CONTROL_DIR as string, 'oauth-rotator-tick.last-run.ts'),
      String(epochSeconds),
      'utf8',
    )
  }

  it('serverTickAgeS reads OUR tick stamp and converts ms→s; absent → null', () => {
    expect(serverTickAgeS(tmpDir, NOW)).toBeNull() // never stamped
    stampOwnTick(NOW - 42)
    // The units trap: readChoreStamp returns MILLISECONDS while `now` is SECONDS. Undivided this
    // reads ~1.8e12 and every tick looks stalled — the exact alarm this change removes.
    expect(serverTickAgeS(tmpDir, NOW)).toBe(42)
  })

  it('gatherFacts CONSULTS an injected tickAgeS instead of tick-completed.ts', () => {
    fs.writeFileSync(path.join(tmpDir, 'opt-in.flag'), '')
    fs.writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify({ slots: {} }))
    // A deliberately ANCIENT janitor stamp — the live-host condition.
    fs.writeFileSync(path.join(tmpDir, 'tick-completed.ts'), String(NOW - 400_000))
    const facts = gatherFacts({
      root: tmpDir,
      deps: { daemonAlive: () => true, now: () => NOW, tickAgeS: () => 5 },
    })
    // 5, not 400000: the injected probe won. Neuter `(deps.tickAgeS ?? tickCompletedAgeS)` back to
    // `tickCompletedAgeS` and this is the test that reds.
    expect(facts.tickCompletedAgeS).toBe(5)
  })

  it('gatherFacts still reads tick-completed.ts when NO probe is injected (the janitor path)', () => {
    fs.writeFileSync(path.join(tmpDir, 'opt-in.flag'), '')
    fs.writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify({ slots: {} }))
    fs.writeFileSync(path.join(tmpDir, 'tick-completed.ts'), String(NOW - 120))
    const facts = gatherFacts({ root: tmpDir, deps: { daemonAlive: () => true, now: () => NOW } })
    // The complement: drop the `?? tickCompletedAgeS` fallback and this reds while the one above
    // stays green — which is what proves the two halves are pinned independently.
    expect(facts.tickCompletedAgeS).toBe(120)
  })

  it('a frozen janitor stamp no longer alerts, and a genuinely hung tick still does', () => {
    fs.writeFileSync(path.join(tmpDir, 'opt-in.flag'), '')
    fs.writeFileSync(path.join(tmpDir, 'state.json'), JSON.stringify({ slots: {} }))
    fs.writeFileSync(path.join(tmpDir, 'tick-completed.ts'), String(NOW - 400_000)) // frozen, as live
    const gather = () =>
      gatherFacts({
        root: tmpDir,
        deps: { daemonAlive: () => true, now: () => NOW, tickAgeS: serverTickAgeS },
      })

    // (a) OUR tick is beating → the false alarm is gone even though the janitor stamp is ancient.
    stampOwnTick(NOW - 60)
    expect(diagnose(gather()).map((f) => f.code)).not.toContain('tick-stalled')

    // (b) POSITIVE CONTROL — the same wiring must still catch a real stall, or (a) would pass just
    // as well against a fix that disabled the alert outright.
    stampOwnTick(NOW - (TICK_STALL_ALERT_S + 60))
    expect(diagnose(gather()).map((f) => f.code)).toContain('tick-stalled')
  })
})
