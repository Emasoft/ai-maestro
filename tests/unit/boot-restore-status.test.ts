/**
 * TRDD-JAU1ES1C — the boot-restore ↔ continuity-`status` bridge.
 *
 * WHY THIS FILE READS AND WRITES A REAL FILE. The bridge exists BECAUSE an in-memory flag cannot
 * cross from `server.mjs`'s runtime-imported service to the `.next`-bundled route (see the module
 * header). Mocking `fs` here would test the mock, not the property — so these drive the real
 * writer and the real reader, against a REDIRECTED `$HOME`.
 *
 * That redirection works only because `bootRestoreStatusPath()` re-resolves on every call. A
 * module that captured its path at import time would keep writing to the developer's real
 * `~/.aimaestro/` no matter what this file sets, and every assertion below would still pass — it
 * would just be asserting about the wrong directory. `containment` (last test) is what proves the
 * redirect actually took, so none of the others can be quietly measuring the real store.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  markBootRestoreInFlight,
  clearBootRestore,
  isBootRestoreInFlight,
} from '@/lib/boot-restore-status'

const REAL_HOME = os.homedir()
const REAL_STATE = path.join(REAL_HOME, '.aimaestro')
let tmpHome: string
let savedHome: string | undefined

/** The stamp path under the redirected HOME — spelled out rather than imported, so a change to
 *  the module's own path helper reddens these tests instead of silently moving them with it. */
function stampPath(): string {
  return path.join(process.env.HOME as string, '.aimaestro', 'boot-restore-in-flight.json')
}

function writeStamp(body: string): void {
  fs.mkdirSync(path.dirname(stampPath()), { recursive: true })
  fs.writeFileSync(stampPath(), body)
}

beforeEach(() => {
  savedHome = process.env.HOME
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-boot-restore-'))
  process.env.HOME = tmpHome
})

afterEach(() => {
  process.env.HOME = savedHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe('boot-restore in-flight stamp (TRDD-JAU1ES1C)', () => {
  it('POSITIVE CONTROL: a written stamp reads back true — writer and reader agree on the file', () => {
    // Also the proof that the $HOME redirect reached the module. Without this, every `false`
    // assertion below would pass for the uninteresting reason that the module is looking at a
    // directory this test never touches.
    expect(isBootRestoreInFlight()).toBe(false)
    markBootRestoreInFlight()
    expect(fs.existsSync(stampPath())).toBe(true)
    expect(isBootRestoreInFlight()).toBe(true)
  })

  it('absent → false (the steady-state answer; the file exists only during a restore)', () => {
    expect(isBootRestoreInFlight()).toBe(false)
  })

  it('a STALE stamp → false, so a crashed restore self-heals instead of claiming forever', () => {
    // The failure this bound exists for: the server dies mid-walk, the `finally` never runs, and
    // the stamp is left up. Without the age check the status verb answers `restoring` for the
    // rest of the host's life — a permanent "wait" nobody can tell from a real one.
    markBootRestoreInFlight()
    const t0 = Date.parse(JSON.parse(fs.readFileSync(stampPath(), 'utf8')).at)
    expect(isBootRestoreInFlight({ now: () => t0 + 120_000 })).toBe(true) // at the bound: still fresh
    expect(isBootRestoreInFlight({ now: () => t0 + 120_001 })).toBe(false) // past it: aged out
  })

  it('garbage, a non-object, and a bad timestamp all → false (never an error)', () => {
    // `JSON.parse` SUCCEEDS on `42`, `null`, `[]` and `"str"` — so a reader that only try/catches
    // the parse would sail past every one of these into a property read on a number.
    for (const body of ['not json at all', '42', 'null', '[]', '"str"', '{}', '{"at":123}', '{"at":"never"}']) {
      writeStamp(body)
      expect(isBootRestoreInFlight(), `body=${body}`).toBe(false)
    }
  })

  it('clear removes OUR stamp', () => {
    markBootRestoreInFlight()
    clearBootRestore()
    expect(fs.existsSync(stampPath())).toBe(false)
    expect(isBootRestoreInFlight()).toBe(false)
  })

  it('clear LEAVES a stamp written by another process — the pid guard', () => {
    // The clear runs in a `finally`. Ungoverned, a process finishing its own restore would delete
    // a stamp another process is still heartbeating, and `status` would answer `ok` in the middle
    // of a live restore — exactly the dishonesty this bridge removes. Failing this direction is
    // safe: a foreign stamp ages out on its own; a wrongly-deleted one never comes back.
    writeStamp(JSON.stringify({ pid: process.pid + 1, at: new Date().toISOString() }))
    clearBootRestore()
    expect(fs.existsSync(stampPath()), 'a foreign-pid stamp must survive our clear').toBe(true)
    expect(isBootRestoreInFlight()).toBe(true)
  })

  it('clear on an absent or unreadable stamp is a silent no-op', () => {
    expect(() => clearBootRestore()).not.toThrow()
    writeStamp('not json')
    expect(() => clearBootRestore()).not.toThrow()
  })

  it('re-stamping refreshes the timestamp — the heartbeat a long fleet restore rides', () => {
    // A single start-of-walk marker would age out mid-restore on a large fleet, and the verb
    // would start reporting the host live while it was still coming up.
    markBootRestoreInFlight()
    const first = Date.parse(JSON.parse(fs.readFileSync(stampPath(), 'utf8')).at)
    const late = first + 119_000 // still fresh, but nearly aged out
    expect(isBootRestoreInFlight({ now: () => late })).toBe(true)
    markBootRestoreInFlight() // the per-session re-stamp
    const second = Date.parse(JSON.parse(fs.readFileSync(stampPath(), 'utf8')).at)
    expect(second).toBeGreaterThanOrEqual(first)
    // Whatever `late` was measuring, it is now well inside the window again.
    expect(isBootRestoreInFlight({ now: () => second + 1_000 })).toBe(true)
  })

  it('CONTAINMENT: none of the above touched the developer real ~/.aimaestro', () => {
    // Without this, a module that resolved its path at import time would have written the real
    // store on every test above and reported success. Counted rather than asserted-absent: the
    // real dir legitimately holds this machine's state, so the property is "unchanged", not "empty".
    const before = fs.existsSync(REAL_STATE) ? fs.readdirSync(REAL_STATE).length : -1
    markBootRestoreInFlight()
    isBootRestoreInFlight()
    clearBootRestore()
    const after = fs.existsSync(REAL_STATE) ? fs.readdirSync(REAL_STATE).length : -1
    expect(after).toBe(before)
    expect(
      fs.existsSync(path.join(REAL_STATE, 'boot-restore-in-flight.json')),
      'the real state dir must never receive a test stamp',
    ).toBe(false)
  })
})
