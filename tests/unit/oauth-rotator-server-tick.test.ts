import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { statePath } from '@/lib/ecosystem-constants'
import { globalStateDir } from '@/lib/oauth-rotator/global-state'
import { oauthTickEnabled, runOneTick, alertableTick } from '@/lib/oauth-rotator/server-tick'
import type { RepairResult } from '@/lib/oauth-rotator/reauth-repair'
import { deriveDecision } from '@/lib/oauth-rotator/tick'

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

/**
 * The TICK's OWN ALARMS REACH A HUMAN (TRDD-RFQFCCU4).
 *
 * The delivery channel was built for the SUPERVISOR beat, whose diagnose() emits pinning-env /
 * non-macos / tick-stalled / setup-token-expiring / cookie-leg-stuck. **None of those is the alarm
 * that fired during the 2026-08-02 incident.** `reauth-needed` and the stuck states are emitted
 * HERE, in the 60s rotation beat, and reached only pm2-out.log — `a human must re-login` logged
 * 4506 times over 4 days while every session on the host walked into the rate limit.
 *
 * No assertion on the tick's RETURN VALUE could ever have caught that: the finding was already
 * perfect. Only an assertion that it reached a CHANNEL can, which is what `deliverImpl` is for.
 */
describe('server-tick — the beat DELIVERS its own alarms (TRDD-RFQFCCU4)', () => {
  const armed = { enabledCheck: () => true, claudeRunningCheck: async () => true }

  it('delivers on reauth-needed, carrying the SPECIFIC reason in the code', async () => {
    const sent: Array<ReadonlyArray<{ code: string; message: string }>> = []
    await runOneTick({
      ...armed,
      runTickImpl: async () => ({
        nextAction: 'reauth-needed', reason: 'refresh-dead', refreshed: [], switched: false,
        // Kept byte-identical to what deriveDecision actually emits — a fixture that drifts from
        // the real message tests a string nothing produces (corrected 2026-08-07, TRDD-XV9BLQC5).
        decision: 'reauth-needed: 2 alternate slot(s) have a dead refresh and are expiring — the OAuth rung is dead, but a live claude.ai cookie can still mint these with NO human; check the cookie layer before re-logging in',
      }),
      deliverImpl: (f) => { sent.push(f) },
    })
    expect(sent).toHaveLength(1)
    // The code is per-FAULT, not a generic bucket: backoff and resolve-detection are keyed on it,
    // so collapsing refresh-dead into a shared code would make a still-dead credential look
    // resolved the moment an unrelated condition cleared.
    expect(sent[0][0].code).toBe('reauth-needed:refresh-dead')
    expect(sent[0][0].message).toContain('dead refresh')
  })

  it('delivers when the fleet is STUCK — the state that used to report itself as healthy', async () => {
    // THE BUG. `all paid accounts maxed` was a decide() call inside autoRotate, which returns a
    // bare boolean, so it never reached TickResult: runTick computed `nextAction: 'ok'` and
    // `decision: 'no action needed'` for a fleet with nothing left to rotate to.
    const sent: Array<ReadonlyArray<{ code: string; message: string }>> = []
    await runOneTick({
      ...armed,
      runTickImpl: async () => ({
        nextAction: 'ok', stuck: 'all-maxed', refreshed: [], switched: false,
        decision: 'STUCK: live account is exhausted and no alternate is healthy + below the safe threshold — all paid accounts maxed',
      }),
      deliverImpl: (f) => { sent.push(f) },
    })
    expect(sent, 'a fully exhausted fleet must reach a human').toHaveLength(1)
    expect(sent[0][0].code).toBe('rotator-stuck:all-maxed')
  })

  it('picks a STABLE code when reason AND stuck are both set (TRDD-X4RK1NUW) — no flapping', async () => {
    // `runTick` can set BOTH on the same result: a dead-refresh alternate survey and the live-
    // account exhaustion check run independently inside runTick/autoRotate. `stuck` alone flickers
    // beat-to-beat near a window threshold; `reason` does not. The code MUST follow `reason` first
    // (matching deriveDecision's own precedence), or the alert channel toggles between two codes
    // for one unchanged condition — measured live: 40/46 vs 275/289 ONSET/CLEARED, same message.
    const sent: Array<ReadonlyArray<{ code: string; message: string }>> = []
    await runOneTick({
      ...armed,
      runTickImpl: async () => ({
        nextAction: 'reauth-needed', reason: 'refresh-dead', stuck: 'all-maxed', refreshed: [], switched: false,
        decision: 'reauth-needed: 2 alternate slot(s) have a dead refresh and are expiring — the OAuth rung is dead, but a live claude.ai cookie can still mint these with NO human; check the cookie layer before re-logging in',
      }),
      deliverImpl: (f) => { sent.push(f) },
    })
    expect(sent).toHaveLength(1)
    expect(sent[0][0].code).toBe('reauth-needed:refresh-dead')
  })

  it('stays SILENT on a healthy tick — an alert that always fires is furniture', async () => {
    const deliverImpl = vi.fn()
    await runOneTick({
      ...armed,
      runTickImpl: async () => ({ nextAction: 'ok', refreshed: [], switched: false, decision: 'no action needed' }),
      deliverImpl,
    })
    expect(deliverImpl).not.toHaveBeenCalled()
  })

  it('a THROWING delivery never takes the beat down', async () => {
    // A guardian that removes itself is worse than the silence this fix exists to end.
    await expect(runOneTick({
      ...armed,
      runTickImpl: async () => ({
        nextAction: 'reauth-needed', reason: 'slot-unreadable', refreshed: [], switched: false, decision: 'x',
      }),
      deliverImpl: () => { throw new Error('notifier exploded') },
    })).resolves.toBeUndefined()
  })
})

describe('alertableTick — as tolerant as writeTickStatus, or a legal stub would throw', () => {
  // runTickImpl is deliberately `Promise<unknown>` so a test can stub a shapeless value, and
  // writeTickStatus treats that as a silent no-op. The alert path must be EXACTLY as tolerant:
  // four tests above this file already stub `async () => {}`, so an intolerant narrowing would
  // have broken them rather than the new code.
  it('answers null for the shapes that mean "nothing to deliver"', () => {
    expect(alertableTick(null), 'lock held by another process').toBeNull()
    expect(alertableTick(undefined), 'stubbed beat').toBeNull()
    expect(alertableTick({}), 'shapeless stub — the existing tests use exactly this').toBeNull()
    expect(alertableTick({ nextAction: 'reauth-needed' }), 'no decision line ⇒ nothing worth sending').toBeNull()
    expect(alertableTick({ nextAction: 'ok', decision: 'no action needed' }), 'healthy').toBeNull()
  })

  it('answers the payload for the two alarm shapes', () => {
    expect(alertableTick({ nextAction: 'reauth-needed', reason: 'refresh-dead', decision: 'd' })?.reason).toBe('refresh-dead')
    expect(alertableTick({ nextAction: 'ok', stuck: 'cannot-rotate-offline', decision: 'd' })?.stuck).toBe('cannot-rotate-offline')
  })
})

/**
 * deriveDecision — THE SITE OF THE BUG (TRDD-RFQFCCU4).
 *
 * `all paid accounts maxed` was a decide() call inside autoRotate, which returns a bare boolean, so
 * it never reached TickResult and runTick emitted `'no action needed'` for a fleet with nothing
 * left to rotate to. Extracted from runTick precisely so this can be asserted: driving it through
 * runTick needs real credential I/O, so every other test in this file stubs the whole tick and the
 * derivation was pinned by nothing.
 *
 * It stayed hidden through the 2026-08-02 incident only by luck — two slots were dead-refresh, so
 * `reason` forced `reauth-needed` anyway. Three HEALTHY-but-maxed accounts would have read `ok`.
 */
describe('deriveDecision — a stuck fleet must never report itself healthy', () => {
  const base = { switched: false, unreadable: 0, deadRefresh: 0, refreshedCount: 0 }

  it('THE REGRESSION: all-maxed does NOT say "no action needed"', () => {
    const d = deriveDecision({ ...base, stuck: 'all-maxed' })
    expect(d).not.toBe('no action needed')
    expect(d).toContain('STUCK')
    expect(d).toContain('all paid accounts maxed')
  })

  // ── all-maxed must not claim an exhaustion that is not there (USER-reported, measured live) ──
  //
  // 2026-08-07 11:42, on the owner's host: this printed "live account is exhausted … all paid
  // accounts maxed" while that account read 5h 8% / 7d 72% and the ONLY spent window was Fable at
  // 100%. `isNearLimit` trips on ANY window >= SWITCH(97), model-scoped included, so a fleet with
  // 92% of its 5h free was reported out of capacity. The remedies DIFFER — account-exhausted means
  // wait/rotate, model-exhausted means move agents off that model and keep working — so this is a
  // wrong instruction, not just clumsy wording.
  //
  // COMPLEMENTARY PAIR, because one mutation certifies half a conditional:
  //   drop the `accountWindowsOk && modelSpent` branch  -> the first test reds (the lie returns)
  //   make that branch UNCONDITIONAL                    -> the second reds (a REAL exhaustion
  //                                                       would be told to switch models instead
  //                                                       of waiting, which is the mirror defect)
  const WINDOWS_MODEL_ONLY = { fiveHourPct: 8, sevenDayPct: 72, scopedModel: 'Fable', scopedPct: 100 }
  const WINDOWS_REALLY_MAXED = { fiveHourPct: 99, sevenDayPct: 98, scopedModel: 'Fable', scopedPct: 100 }

  it('all-maxed with a HEALTHY account says the MODEL is spent, and names the real remedy', () => {
    const d = deriveDecision({ ...base, stuck: 'all-maxed', windows: WINDOWS_MODEL_ONLY })
    expect(d).toContain('NOT exhausted') // it must contradict the old claim outright
    expect(d).toContain('5h 8%')
    expect(d).toContain('Fable')
    expect(d).toContain('not to rotate the credential')
    // The specific false sentence must be GONE, not merely accompanied by a correction.
    expect(d).not.toContain('live account is exhausted')
    expect(d).not.toContain('all paid accounts maxed')
  })

  it('all-maxed with a GENUINELY maxed account still says exhausted — the complement', () => {
    // Without this, a fix that always blames the model would pass the test above while telling an
    // operator whose 5h really IS at 99% to go switch models. Same bug, opposite direction.
    const d = deriveDecision({ ...base, stuck: 'all-maxed', windows: WINDOWS_REALLY_MAXED })
    expect(d).toContain('all paid accounts maxed')
    expect(d).not.toContain('NOT exhausted')
  })

  it('all-maxed with NO windows keeps the original wording — never invents a number', () => {
    // A message that fabricates "5h undefined%" is worse than one that is merely vague.
    const d = deriveDecision({ ...base, stuck: 'all-maxed' })
    expect(d).toContain('all paid accounts maxed')
    expect(d).not.toContain('undefined')
    expect(d).not.toContain('null')
  })

  it('cannot-rotate-offline is distinct from all-maxed — the OWNER differs', () => {
    // One waits for a window; the other needs a human. Collapsing them re-creates exactly the
    // ambiguity TickReason already exists to avoid.
    const offline = deriveDecision({ ...base, stuck: 'cannot-rotate-offline' })
    expect(offline).not.toBe(deriveDecision({ ...base, stuck: 'all-maxed' }))
    expect(offline).toContain('manual re-auth needed')
  })

  it('reason OUTRANKS stuck — an actionable chore beats a wait', () => {
    const d = deriveDecision({ ...base, reason: 'refresh-dead', deadRefresh: 2, stuck: 'all-maxed' })
    // Asserts the BRANCH, not the blame. This used to read `toContain('a human must re-login')`,
    // which welded a precedence test to a claim that turned out to be false — so the phrase could
    // not be corrected without reddening a test about something else entirely.
    expect(d).toContain('dead refresh')
    expect(d).not.toContain('STUCK')
  })

  // THE REGRESSION GUARD for TRDD-XV9BLQC5. `refresh-dead` means the OAuth rung is dead and
  // NOTHING MORE: rung 2 of the cascade mints a fresh refresh from a live claude.ai cookie with no
  // human, and that cookie lives in the janitor's keychain where this process cannot see it.
  // MEASURED 2026-08-07: of two slots this message called human-blocked, one held a healthy cookie
  // and minted itself unattended. The same phrase had already been logged 4 506 times over 4 days
  // (see alert-delivery.ts) — a false alarm that frequent stops being read at all.
  //
  // NEUTER RUN (2026-08-07 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
  //   s|the OAuth rung is dead, but a live claude\.ai cookie can still mint these with NO human; check the cookie layer before re-logging in|a human must re-login|
  //   → 1 red / 50 green:
  //       never claims a human is required — this process cannot see the cookie rung
  // Exactly this test, and only this test — so the precedence/attribution tests above are NOT
  // propping it up, and it is not propping them up either.
  it('never claims a human is required — this process cannot see the cookie rung', () => {
    const d = deriveDecision({ ...base, reason: 'refresh-dead', deadRefresh: 2 })
    expect(d).not.toMatch(/human must re-login/i)
    // Positive control: without this the assertion above passes for ANY message, including an
    // empty one or a message from a branch that never ran.
    expect(d).toContain('dead refresh')
    // And it must still say what a human COULD do — silence about the cookie rung is what sent
    // the owner to a re-login for an account that would have minted itself.
    expect(d).toMatch(/cookie/i)
  })

  it('stuck OUTRANKS refreshed — a rotation that could not happen beats routine upkeep', () => {
    expect(deriveDecision({ ...base, stuck: 'all-maxed', refreshedCount: 3 })).toContain('STUCK')
  })

  it('the healthy paths are unchanged — this must not turn quiet ticks noisy', () => {
    expect(deriveDecision({ ...base })).toBe('no action needed')
    expect(deriveDecision({ ...base, refreshedCount: 2 })).toBe('refreshed 2 slot(s)')
    expect(deriveDecision({ ...base, switched: true, stuck: 'all-maxed' })).toBe('rotated the live account')
  })
})
