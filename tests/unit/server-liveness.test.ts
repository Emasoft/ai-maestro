import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  it('advertises marketplace-refresh + version-update only when the absorbed-duty scheduler runs (ai-maestro#102)', () => {
    expect(currentCapabilities({ ...noop, singletonChoresLive: () => true })).toEqual([
      'marketplace-refresh',
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
    expect(readLiveness().absorbed_chores).toEqual([
      'marketplace-refresh',
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
})
