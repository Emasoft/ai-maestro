import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  currentCapabilities,
  writeServerLiveness,
  startServerLiveness,
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
  it("never advertises 'singleton-chores' or 'fleet-recovery' (their chores are not built)", () => {
    const caps = currentCapabilities({ oauthEnabled: () => true })
    expect(caps).not.toContain('singleton-chores')
    expect(caps).not.toContain('fleet-recovery')
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
