import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

describe('currentCapabilities — advertises ONLY what is live (janitor#100 rule)', () => {
  it('is empty when the OAuth rotator flag is absent (the R16-safe default today)', () => {
    expect(currentCapabilities({ oauthEnabled: () => false })).toEqual([])
  })
  it("advertises 'family-a' only when the OAuth rotator tick is enabled", () => {
    expect(currentCapabilities({ oauthEnabled: () => true })).toEqual(['family-a'])
  })
  it("never advertises 'fleet-recovery' (that chore is not built yet)", () => {
    const caps = currentCapabilities({ oauthEnabled: () => true, singletonChoresLive: () => true })
    expect(caps).not.toContain('fleet-recovery')
  })
  it("'singleton-chores' is absent when the absorbed-duty scheduler isn't running", () => {
    expect(currentCapabilities({ oauthEnabled: () => false, singletonChoresLive: () => false })).toEqual([])
  })
  it("advertises 'singleton-chores' only when the absorbed-duty scheduler IS running (ai-maestro#102)", () => {
    const caps = currentCapabilities({ oauthEnabled: () => false, singletonChoresLive: () => true })
    expect(caps).toEqual(['singleton-chores'])
  })
  it('defaults singletonChoresLive to the real isAbsorbedDutySchedulerRunning check (non-vacuity)', () => {
    // No injected dep at all — the real check must be consulted. In a plain unit-test process
    // the absorbed-duty scheduler was never started, so this reads honestly as absent.
    expect(currentCapabilities({ oauthEnabled: () => false })).toEqual([])
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
    expect(readLiveness().absorbed_chores).toEqual([
      'marketplace-refresh',
      'user-plugins-update',
      'version-update',
      'oauth-rotator-supervisor',
      'oauth-rotator-tick',
      'github-config-audit',
    ])
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
})
