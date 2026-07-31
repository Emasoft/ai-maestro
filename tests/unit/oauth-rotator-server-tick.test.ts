import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { statePath } from '@/lib/ecosystem-constants'
import { globalStateDir } from '@/lib/oauth-rotator/global-state'
import { oauthTickEnabled, runOneTick } from '@/lib/oauth-rotator/server-tick'
import type { RepairResult } from '@/lib/oauth-rotator/reauth-repair'

// 0-IMPACT / R16 SAFETY (copied from oauth-rotator-tick.test.ts). The gate is a FLAG FILE under
// ~/.aimaestro and the tick lock lives under the janitor global-state dir — BOTH anchored on
// os.homedir(). Forced-off backend + HOME→temp route every write into the temp dir; XDG_STATE_HOME
// and JANITOR_GLOBAL_STATE_DIR are cleared so globalStateDir() cannot climb OUT of temp; and
// runOneTick always gets a STUB runTickImpl, so tick.ts::runTick (the real credential/network I/O)
// never runs. Hard-guarded: we assert both the credentials path AND the lock dir land inside temp.

const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA', 'XDG_STATE_HOME', 'JANITOR_GLOBAL_STATE_DIR'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-srvtick-'))
  process.env.HOME = tmpDir
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  delete process.env.CLAUDE_PLUGIN_DATA
  delete process.env.XDG_STATE_HOME // else globalStateDir() → $XDG_STATE_HOME/janitor, outside temp
  delete process.env.JANITOR_GLOBAL_STATE_DIR // test-only-env would honor it → outside temp
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json')
  if (!credFile.startsWith(tmpDir)) throw new Error(`refusing to run: credentials path ${credFile} escaped tmp ${tmpDir}`)
  const lockDir = globalStateDir()
  if (!lockDir.startsWith(tmpDir)) throw new Error(`refusing to run: lock dir ${lockDir} escaped tmp ${tmpDir}`)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

/** Create the opt-in flag file under the temp statedir (mirrors the human's deliberate opt-in). */
function createFlag(): void {
  const flag = statePath('oauth-rotator-tick.enabled')
  fs.mkdirSync(path.dirname(flag), { recursive: true })
  fs.writeFileSync(flag, '')
}
function removeFlag(): void {
  fs.rmSync(statePath('oauth-rotator-tick.enabled'), { force: true })
}

describe('server-tick — the flag-file gate (R16 default OFF)', () => {
  it('oauthTickEnabled: false when the flag file is absent', () => {
    expect(oauthTickEnabled()).toBe(false)
  })

  it('oauthTickEnabled: true after the flag is created, false again after removal', () => {
    expect(oauthTickEnabled()).toBe(false)
    createFlag()
    expect(oauthTickEnabled()).toBe(true)
    removeFlag()
    expect(oauthTickEnabled()).toBe(false)
  })
})

describe('server-tick — runOneTick gating (never actuates when it should not)', () => {
  it('does NOT run the tick when the flag is disabled', async () => {
    const runTickImpl = vi.fn(async () => {})
    await runOneTick({ enabledCheck: () => false, claudeRunningCheck: async () => true, runTickImpl })
    expect(runTickImpl).not.toHaveBeenCalled()
  })

  it('does NOT run the tick when no claude client is alive', async () => {
    const runTickImpl = vi.fn(async () => {})
    await runOneTick({ enabledCheck: () => true, claudeRunningCheck: async () => false, runTickImpl })
    expect(runTickImpl).not.toHaveBeenCalled()
  })

  it('runs the tick exactly once when enabled AND a client is alive', async () => {
    const runTickImpl = vi.fn(async () => {})
    await runOneTick({ enabledCheck: () => true, claudeRunningCheck: async () => true, runTickImpl })
    expect(runTickImpl).toHaveBeenCalledTimes(1)
  })

  it('resolves (never rejects) when the tick throws — a beat must not crash the server', async () => {
    const runTickImpl = vi.fn(async () => { throw new Error('boom') })
    await expect(
      runOneTick({ enabledCheck: () => true, claudeRunningCheck: async () => true, runTickImpl }),
    ).resolves.toBeUndefined()
    expect(runTickImpl).toHaveBeenCalledTimes(1)
  })
})

describe('server-tick — the REPAIR leg is wired, and inherits every gate the beat has (TRDD-CVQJNW3A)', () => {
  const ok = (over: Partial<RepairResult> = {}): RepairResult => ({ outcome: 'nothing-to-do', ...over })
  const armed = { enabledCheck: () => true, claudeRunningCheck: async () => true }

  it('runs it once after a beat that actually ran', async () => {
    const repairImpl = vi.fn(async () => ok())
    await runOneTick({ ...armed, runTickImpl: async () => {}, repairImpl })
    expect(repairImpl).toHaveBeenCalledTimes(1)
  })

  it('does NOT run it when the tick flag is off — one flag off is enough to stop everything', async () => {
    const repairImpl = vi.fn(async () => ok())
    await runOneTick({ ...armed, enabledCheck: () => false, runTickImpl: async () => {}, repairImpl })
    // The repair has its OWN flag too, but BOTH must be on: a re-capture only makes sense as part
    // of an armed rotator, so the tick's gate is a necessary condition, not a parallel one.
    expect(repairImpl).not.toHaveBeenCalled()
  })

  it('does NOT run it when no claude client is alive', async () => {
    const repairImpl = vi.fn(async () => ok())
    await runOneTick({ ...armed, claudeRunningCheck: async () => false, runTickImpl: async () => {}, repairImpl })
    expect(repairImpl).not.toHaveBeenCalled()
  })

  it('does NOT run it when the beat produced no result — that is the lock-held case', async () => {
    // withTickLock returns null when another process holds the lock. Repairing anyway would mean
    // two processes opening two browser windows at once, so the leg reuses the beat's existing
    // serialisation rather than inventing a second lock for the same invariant.
    const repairImpl = vi.fn(async () => ok())
    await runOneTick({ ...armed, runTickImpl: async () => null, repairImpl })
    expect(repairImpl).not.toHaveBeenCalled()
  })

  it('a repair that THROWS neither rejects nor gets misreported as a tick failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(
        runOneTick({ ...armed, runTickImpl: async () => {}, repairImpl: async () => { throw new Error('unbrowse died') } }),
      ).resolves.toBeUndefined()
      const lines = warn.mock.calls.map((c) => String(c[0]))
      // The attribution is the assertion. The outer catch says "server tick failed", and on a
      // credential subsystem a false attribution sends the next reader to the wrong file entirely.
      expect(lines.some((l) => /reauth-repair failed/.test(l) && /unbrowse died/.test(l))).toBe(true)
      expect(lines.some((l) => /server tick failed/.test(l))).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('stays SILENT on the two outcomes that say nothing an operator needs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const outcome of ['disabled', 'nothing-to-do'] as const) {
        await runOneTick({ ...armed, runTickImpl: async () => {}, repairImpl: async () => ok({ outcome }) })
      }
      // Logging these every 60 s is how a line becomes noise, and a noisy line is scrolled past on
      // the one day it finally reports a real repair.
      expect(warn.mock.calls.filter((c) => /reauth-repair/.test(String(c[0])))).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('reports a real outcome with its detail — and never the email', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await runOneTick({
        ...armed,
        runTickImpl: async () => {},
        repairImpl: async () => ok({ outcome: 'drive-failed', email: 'someone@example.com', detail: 'not_logged_in' }),
      })
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => /reauth-repair/.test(l))
      expect(line).toMatch(/drive-failed/)
      expect(line).toMatch(/not_logged_in/)
      // The beat's log surface is counts-and-outcomes only. The email is carried in the RESULT for
      // a UI that tells the owner which of their OWN accounts was touched — a log file is not that.
      expect(line).not.toMatch(/someone@example\.com/)
    } finally {
      warn.mockRestore()
    }
  })
})
