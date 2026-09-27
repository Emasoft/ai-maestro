import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/** Synchronous busy-wait — guarantees real clock time elapses between two beats. */
function busyWaitMs(ms: number): void {
  const end = performance.now() + ms
  while (performance.now() < end) { /* spin */ }
}
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  currentCapabilities,
  writeServerLiveness,
  startServerLiveness,
  computeBuildSha,
  SERVER_LIVENESS_FILE,
  type ServerLiveness,
} from '@/lib/server-liveness'
import { markChoreLive, unmarkChoreLive } from '@/lib/janitor-chore-stamp'

// TRDD-P7RPOR5O — the auth-free liveness+capability probe file both janitor backends read.
// 0-IMPACT: HOME is repointed at a fresh temp dir per test, so statePath() resolves the file
// under the temp HOME and nothing touches the real ~/.aimaestro. The capability logic is pure
// and driven through injected deps — no real OAuth flag, no clock, no process id needed.

let tmpHome: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.HOME
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-liveness-'))
  process.env.HOME = tmpHome
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

/** Read the written file (resolved under the temp HOME) as a parsed ServerLiveness. */
function readLiveness(): ServerLiveness {
  const dest = path.join(tmpHome, '.aimaestro', path.basename(SERVER_LIVENESS_FILE))
  return JSON.parse(fs.readFileSync(dest, 'utf8')) as ServerLiveness
}

describe('currentCapabilities — advertises ONLY exact chore names the janitor honours (rev-8 contract)', () => {
  const noop = {
    oauthEnabled: () => false,
    singletonChoresLive: () => false,
    githubConfigAuditLive: () => false,
    cachePruneLive: () => false,
    fleetPluginsUpdateLive: () => false,
    liveConditionalChores: () => [],
  }
  it('is empty when nothing is live', () => {
    expect(currentCapabilities(noop)).toEqual([])
  })
  it('advertises the oauth pair only when the OAuth rotator tick is enabled — no legacy family-a (TRDD-X9VLHBFZ)', () => {
    expect(currentCapabilities({ ...noop, oauthEnabled: () => true })).toEqual([
      'oauth-rotator-tick',
      'oauth-rotator-supervisor',
    ])
  })
  it('advertises version-update only when the absorbed-duty scheduler runs (ai-maestro#102)', () => {
    // marketplace-refresh dropped 2026-09-17 (duty retired) — the scheduler ran both, now only
    // version-update.
    expect(currentCapabilities({ ...noop, singletonChoresLive: () => true })).toEqual([
      'version-update',
    ])
  })
  it('advertises github-config-audit only when its own scheduler liveness check is true (TRDD-X9VLHBFZ)', () => {
    expect(currentCapabilities({ ...noop, githubConfigAuditLive: () => true })).toEqual(['github-config-audit'])
  })
  it('advertises cache-prune only when its own scheduler liveness check is true (TRDD-X9VLHBFZ)', () => {
    expect(currentCapabilities({ ...noop, cachePruneLive: () => true })).toEqual(['cache-prune'])
  })
  it('advertises fleet-plugins-update only when its own scheduler liveness check is true (TRDD-X9VLHBFZ)', () => {
    expect(currentCapabilities({ ...noop, fleetPluginsUpdateLive: () => true })).toEqual(['fleet-plugins-update'])
  })
  it('passes through whichever conditional chores are reported live', () => {
    expect(currentCapabilities({ ...noop, liveConditionalChores: () => ['memory-guard', 'fleet-stop'] })).toEqual([
      'memory-guard',
      'fleet-stop',
    ])
  })
  it("NEVER advertises the retired 'family-a', 'singleton-chores', or the unbuilt 'fleet-recovery' token", () => {
    const caps = currentCapabilities({
      oauthEnabled: () => true,
      singletonChoresLive: () => true,
      githubConfigAuditLive: () => true,
      cachePruneLive: () => true,
      fleetPluginsUpdateLive: () => true,
    })
    expect(caps).not.toContain('family-a')
    expect(caps).not.toContain('singleton-chores')
    expect(caps).not.toContain('fleet-recovery')
  })
  it('defaults every dep to the real checks (non-vacuity) — reads honestly empty in a plain unit-test process', () => {
    // No injected deps at all — the real oauthTickEnabled/isAbsorbedDutySchedulerRunning/
    // isGithubConfigAuditSchedulerRunning/isCachePruneSchedulerRunning/
    // isFleetPluginsUpdateSchedulerRunning/activeAbsorbedChores checks must be consulted. None
    // of their lanes are armed in a plain unit-test process.
    expect(currentCapabilities()).toEqual([])
  })
  it('defaults liveConditionalChores to activeAbsorbedChores() filtered to CONDITIONAL_CHORES (non-vacuity)', () => {
    markChoreLive('memory-guard')
    try {
      expect(currentCapabilities({ oauthEnabled: () => false, singletonChoresLive: () => false })).toEqual([
        'memory-guard',
      ])
    } finally {
      unmarkChoreLive('memory-guard')
    }
  })
})

describe('writeServerLiveness — atomic write of the 3-field shape', () => {
  it('writes ts (epoch seconds), pid, and the capability list', () => {
    writeServerLiveness({ now: () => 1752750000, pid: 4242, capabilities: () => ['family-a'] })
    const l = readLiveness()
    expect(l.ts).toBe(1752750000)
    expect(l.pid).toBe(4242)
    expect(l.capabilities).toEqual(['family-a'])
  })
  it('defaults capabilities to [] when nothing is live', () => {
    writeServerLiveness({ now: () => 1, pid: 1, capabilities: () => [] })
    expect(readLiveness().capabilities).toEqual([])
  })

  // ai-maestro#111 asked us to publish WHICH chores the server claims, so the janitor can narrow
  // its all-or-nothing daemon suppression instead of hardcoding the boundary. These names are a
  // CROSS-PROCESS WIRE CONTRACT with another project's registry, so the expectation below is
  // written out literally ON PURPOSE rather than read back from `ABSORBED_CHORES`: comparing the
  // payload against the very constant that produced it would pass through any rename, which is the
  // one change that actually breaks the consumer.
  it('publishes absorbed_chores as the exact janitor registry names (ai-maestro#111)', () => {
    writeServerLiveness({ now: () => 1, pid: 1, capabilities: () => [] })
    // `user-plugins-update` is deliberately ABSENT since 2026-08-19 (TRDD-PE54D95Q AC6): the
    // per-plugin loop was deleted, so publishing the claim would tell the janitor to yield a
    // chore nobody performs. The un-claim and the loop removal are one change — a re-add here
    // without the loop makes this beat lie in the FXPV7L4D direction.
    // marketplace-refresh dropped 2026-09-17 (duty retired) — same FXPV7L4D-avoidance rule as
    // the user-plugins-update note above.
    expect(readLiveness().absorbed_chores).toEqual([
      'version-update',
      'oauth-rotator-supervisor',
      'oauth-rotator-tick',
      'github-config-audit',
      // joined 2026-08-19 (TRDD-B8B6D56P): the lane (lib/cache-prune.ts scheduler in
      // server.mjs) landed in the SAME change as this claim — the claim-when-live rule.
      'cache-prune',
      // joined 2026-08-20 (TRDD-JBFM8XR0): lib/fleet-plugins-update.ts scheduler landed in
      // the SAME change — non-destructive, ships ON. (memory-guard is CONDITIONAL and never
      // appears here unarmed — pinned below.)
      'fleet-plugins-update',
    ])
    expect(readLiveness().absorbed_chores).not.toContain('user-plugins-update')
  })

  it('a CONDITIONAL (default-OFF) chore is claimed ONLY while its lane is marked live — memory-guard, TRDD-4QOWVSLU', () => {
    writeServerLiveness({ now: () => 1, pid: 1, capabilities: () => [] })
    expect(readLiveness().absorbed_chores).not.toContain('memory-guard')
    markChoreLive('memory-guard')
    try {
      writeServerLiveness({ now: () => 2, pid: 1, capabilities: () => [] })
      expect(readLiveness().absorbed_chores).toContain('memory-guard')
    } finally {
      unmarkChoreLive('memory-guard')
    }
    writeServerLiveness({ now: () => 3, pid: 1, capabilities: () => [] })
    expect(readLiveness().absorbed_chores).not.toContain('memory-guard')
  })

  it('serialises absorbed_chores as a COPY, so a consumer cannot mutate the module constant', () => {
    writeServerLiveness({ now: () => 1, pid: 1, capabilities: () => [] })
    const first = readLiveness().absorbed_chores
    first.push('kill-switch')
    // A second beat must be unaffected — if the payload had shipped the `as const` tuple itself,
    // a caller holding the returned array could poison every later heartbeat.
    writeServerLiveness({ now: () => 2, pid: 1, capabilities: () => [] })
    expect(readLiveness().absorbed_chores).not.toContain('kill-switch')
  })
  it('leaves no .tmp partial file behind after a successful write', () => {
    writeServerLiveness({ now: () => 1, pid: 7, capabilities: () => [] })
    const dir = path.join(tmpHome, '.aimaestro')
    const stray = fs.readdirSync(dir).filter((f) => f.includes('.tmp.'))
    expect(stray).toEqual([])
  })
  it('NEVER throws even when the state dir cannot be created (a failed heartbeat must not crash the server)', () => {
    // Make ~/.aimaestro a FILE so mkdirSync of the dir throws — the write must swallow it.
    fs.writeFileSync(path.join(tmpHome, '.aimaestro'), 'not a dir')
    expect(() => writeServerLiveness({ now: () => 1, pid: 1, capabilities: () => [] })).not.toThrow()
  })
  it('writes the build sha/sha_full/dirty from the resolver seam (TRDD-T2DVNWVI)', () => {
    writeServerLiveness({
      now: () => 1,
      pid: 1,
      capabilities: () => [],
      buildSha: () => ({ sha: 'abcdef012345', sha_full: 'abcdef0123456789', dirty: true }),
    })
    const l = readLiveness()
    expect(l.sha).toBe('abcdef012345')
    expect(l.sha_full).toBe('abcdef0123456789')
    expect(l.dirty).toBe(true)
  })
})

describe('computeBuildSha — env stamp wins, else git, else unknown (TRDD-T2DVNWVI)', () => {
  const noGit = () => {
    throw new Error('git unavailable')
  }
  it('prefers AIM_BUILD_SHA (a packaged build), truncating sha to 12 with dirty=false', () => {
    const b = computeBuildSha((n) => (n === 'AIM_BUILD_SHA' ? '0123456789abcdef' : undefined), noGit)
    expect(b).toEqual({ sha: '0123456789ab', sha_full: '0123456789abcdef', dirty: false })
  })
  it('falls back to git HEAD with dirty=false on a clean tree', () => {
    const b = computeBuildSha(
      () => undefined,
      (a) => (a.startsWith('rev-parse') ? 'feedface0000' : ''),
    )
    expect(b).toEqual({ sha: 'feedface0000', sha_full: 'feedface0000', dirty: false })
  })
  it('reports dirty=true when git status --porcelain is non-empty', () => {
    const b = computeBuildSha(
      () => undefined,
      (a) => (a.startsWith('rev-parse') ? 'feedface0000' : ' M lib/x.ts'),
    )
    expect(b.dirty).toBe(true)
  })
  it("returns 'unknown' when neither env nor git is available", () => {
    expect(computeBuildSha(() => undefined, noGit)).toEqual({ sha: 'unknown', sha_full: 'unknown', dirty: false })
  })
})

describe('startServerLiveness — writes once immediately, returns a stop fn', () => {
  it('creates the file on start (before any interval fires) and stops cleanly', () => {
    const stop = startServerLiveness({ intervalMs: 1_000_000 })
    try {
      const l = readLiveness()
      expect(typeof l.ts).toBe('number')
      expect(Array.isArray(l.capabilities)).toBe(true)
    } finally {
      stop()
    }
  })

  // TRDD-OUAQARPL: attribute a stale liveness file to a LATE WRITER (event loop descheduled)
  // vs a misjudging reader. The gap check uses its own injected `now` seam (never the fake-timer
  // Date) so the test can simulate a stall deterministically without fighting sinon's "catch up
  // overdue timers at their originally-scheduled time" behaviour.
  it('logs a late-beat warning only once a gap exceeds 2x the interval — silent on normal beats', () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let simulatedNowMs = 0
    try {
      const stop = startServerLiveness({ intervalMs: 1000, now: () => simulatedNowMs })
      try {
        simulatedNowMs = 1000
        vi.advanceTimersByTime(1000) // normal beat — gap 1000ms
        expect(warnSpy).not.toHaveBeenCalled()

        simulatedNowMs = 2000
        vi.advanceTimersByTime(1000) // normal beat — gap 1000ms
        expect(warnSpy).not.toHaveBeenCalled()

        simulatedNowMs = 7000 // event loop stalled 5s before this beat could run
        vi.advanceTimersByTime(1000)
        expect(warnSpy).toHaveBeenCalledTimes(1)
        expect(warnSpy.mock.calls[0]?.[0]).toContain('late beat')
      } finally {
        stop()
      }
    } finally {
      warnSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  // TRDD-8148P30S: the late-beat line must CARRY ATTRIBUTION, not just a gap. This test drives
  // the late-beat BRANCH itself (fake timers + the injected now seam — the branch really
  // executes, so a dropped field reddens the format check) and asserts every attribution field
  // is present and well-formed on the emitted line.
  it('the late-beat line carries every attribution field: load1 freemem lagMs clockDriftMs writeMs (TRDD-8148P30S)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // os.loadavg/freemem are non-configurable ESM exports — vi.spyOn cannot redefine them.
    // Stubbing via vi.mock is module-wide, so instead assert WELL-FORMEDNESS: load1 is a finite
    // loadavg (any host), freemem a non-negative byte count. Values are real; the contract is
    // that the fields are present and parseable.
    let simulatedNowMs = 0
    try {
      const stop = startServerLiveness({ intervalMs: 1000, now: () => simulatedNowMs })
      try {
        simulatedNowMs = 7000 // one huge gap straight off — straight into the late-beat branch
        vi.advanceTimersByTime(1000)
        expect(warnSpy).toHaveBeenCalledTimes(1)
        const line = String(warnSpy.mock.calls[0]?.[0])

        // Field presence AND well-formedness — presence alone would pass an empty-value line.
        const field = (name: string) => {
          const m = line.match(new RegExp(`${name}=([^ ]+)`))
          expect(m, `line missing ${name}: ${line}`).not.toBeNull()
          return m![1]
        }
        // load1: a finite load average (real value from the test host).
        expect(Number.isFinite(Number(field('load1')))).toBe(true)
        // freemem: a non-negative byte count (real value from the test host).
        expect(Number(field('freemem'))).toBeGreaterThanOrEqual(0)
        // lagMs: actual fire (7000) minus scheduled (lastBeatMs 0 + interval 1000) = 6000.
        expect(field('lagMs')).toBe('6000')
        // clockDriftMs at the FIRST late beat is ~0 BY CONSTRUCTION (the anchor
        // calibrates to the current clock) — presence-only here. The discriminating
        // assertion is the second beat below.
        expect(Math.abs(Number(field('clockDriftMs')))).toBeLessThan(1000)
        // writeMs: the write really ran — a non-negative number.
        expect(Number(field('writeMs'))).toBeGreaterThanOrEqual(0)
        // Single line, still greppable by the original prefix.
        expect(line).not.toMatch(/\n/)
        expect(line.startsWith('[server-liveness] late beat: gap')).toBe(true)

        // Second late beat with a DIFFERENTIAL clock advance: fake Date advances 1000ms
        // while process.hrtime stays REAL (excluded from toFake below — sinon fakes it by
        // default, which would advance both clocks in lockstep and make drift ≡ 0). The
        // module's drift computation reads raw Date.now() (faked) against real hrtime, so
        // clockDriftMs must move to ≈1000. This is the assertion that fails for the two
        // wrong implementations an always-~0 band would pass: a detector that returns ~0
        // unconditionally, and one that RE-ANCHORS on every beat (re-anchoring makes the
        // drift 0 at every beat by the same construction as the first beat). It caught the
        // shipped /1_000n µs-unit bug on its first run (drift2 was −999000).
        //
        // Discrimination margin note (review round on 9bc1c55f): drift_buggy = fake_adv −
        // real_elapsed_IN_µS and drift_correct = fake_adv − real_elapsed_IN_MS, so the gap
        // between them is the real elapsed time itself — widening the FAKE advance does
        // not widen it (±30s bounds would pass the µs bug: 59436 ∈ [30000, 90000]). The
        // busy-wait below guarantees ≥3ms of real elapsed time, so the buggy value loses
        // ≥3000 while the correct one loses ≤3+preemption — bounds (950, 1005) separate
        // them by ~2.9s on any host, independent of host speed.
        busyWaitMs(3)
        simulatedNowMs = 14000 // gap 7000ms — a second late beat
        vi.advanceTimersByTime(1000) // fake Date.now += 1000; real hrtime moves ~3ms
        expect(warnSpy).toHaveBeenCalledTimes(2)
        const line2 = String(warnSpy.mock.calls[1]?.[0])
        const drift2 = Number(line2.match(/clockDriftMs=([^ ]+)/)![1])
        expect(drift2).toBeGreaterThan(950) // correct ≈ 997 (1000 − ~3ms busy-wait)
        expect(drift2).toBeLessThan(1000) // correct is strictly < 1000 — a sign-flip (+3) lands at 1003 and must red
      } finally {
        stop()
      }
    } finally {
      warnSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
