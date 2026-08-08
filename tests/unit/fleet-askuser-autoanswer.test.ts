import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  runAskUserAutoAnswerTick,
  menuSignature,
  type AskUserAgentRef,
  type AskUserAnswerDeps,
  type AskUserState,
  type AskUserVerdict,
} from '@/lib/fleet-askuser-autoanswer'
import { runFleetLivenessTick, resetAskUserStore, resetRecoveryStore } from '@/lib/fleet-liveness-watchdog'
import type { FleetLivenessSnapshot } from '@/lib/fleet-liveness'

// ── shared fixtures ─────────────────────────────────────────────────────────────

const ASK: AskUserVerdict = {
  reason: 'ask_user',
  question: 'Which approach should we take?',
  choices: [
    { key: '1', label: 'Proceed now (Recommended)' },
    { key: '2', label: 'Hold for later' },
  ],
}
const ASK_OTHER: AskUserVerdict = {
  reason: 'ask_user',
  question: 'A different question entirely?',
  choices: [{ key: '1', label: 'Yes' }],
}
const PERMISSION: AskUserVerdict = {
  reason: 'permission',
  question: 'Do you want to allow Bash to run rm?',
  choices: [
    { key: '1', label: 'Yes' },
    { key: '2', label: 'No' },
  ],
}
const IDLE: AskUserVerdict = { reason: 'idle', question: '', choices: [] }

const AGENT: AskUserAgentRef = { id: 'a1', name: 'alice' }

/** readVerdict stub: serves the given verdicts in call order, repeating the last forever. */
function seqVerdicts(...vs: (AskUserVerdict | null)[]) {
  let i = 0
  return vi.fn(async (_a: AskUserAgentRef) => (i < vs.length ? vs[i++] : vs[vs.length - 1]))
}

function makeDeps(over: Partial<AskUserAnswerDeps> = {}): AskUserAnswerDeps & { inject: ReturnType<typeof vi.fn> } {
  return {
    fireEnabled: true,
    actuationBlocked: () => ({ blocked: false, reason: null }),
    hidPresent: () => false,
    now: () => 1_000_000,
    lastActuatedAtMs: () => null,
    readVerdict: seqVerdicts(ASK),
    inject: vi.fn(async () => ({ ok: true })),
    sleep: async () => {},
    settleMs: 0,
    dwellMs: 100,
    lockoutMs: 60_000,
    ...over,
  } as AskUserAnswerDeps & { inject: ReturnType<typeof vi.fn> }
}

/** A store pre-seeded so the menu has already dwelled long enough to be answerable NOW. */
function dwelledStore(sig = menuSignature(ASK), atMs = 1_000_000 - 1_000): Map<string, AskUserState> {
  return new Map([[AGENT.id, { signature: sig, firstSeenAtMs: atMs, answeredSignature: null, answeredAtMs: 0 }]])
}

// ── the decision ladder ─────────────────────────────────────────────────────────

describe('runAskUserAutoAnswerTick — the decision ladder', () => {
  it('never answers a menu on first sight — the dwell clock starts instead', async () => {
    const deps = makeDeps()
    const store = new Map<string, AskUserState>()
    const r = await runAskUserAutoAnswerTick([AGENT], store, deps)
    expect(deps.inject).not.toHaveBeenCalled()
    expect(r.skipped).toEqual([{ agentId: 'a1', name: 'alice', reason: 'dwell' }])
    expect(store.get('a1')?.signature).toBe(menuSignature(ASK))
  })

  it('answers with ENTER once the same menu has dwelled, and confirms the dismissal', async () => {
    // Reads: scan (ask) → re-verify (ask) → post-condition (idle ⇒ confirmed).
    const deps = makeDeps({ readVerdict: seqVerdicts(ASK, ASK, IDLE) })
    const r = await runAskUserAutoAnswerTick([AGENT], dwelledStore(), deps)
    expect(deps.inject).toHaveBeenCalledTimes(1)
    expect(r.answered).toHaveLength(1)
    expect(r.answered[0]).toMatchObject({
      agentId: 'a1',
      defaultLabel: 'Proceed now (Recommended)',
      confirmed: true,
    })
  })

  it('reports confirmed=false when the menu is still open after ENTER', async () => {
    const deps = makeDeps({ readVerdict: seqVerdicts(ASK, ASK, ASK) })
    const r = await runAskUserAutoAnswerTick([AGENT], dwelledStore(), deps)
    expect(r.answered[0].confirmed).toBe(false)
    expect(r.answered[0].detail).toMatch(/still open after ENTER/)
  })

  it('NEVER answers a permission prompt — it is reported, not touched', async () => {
    // The security invariant. Two assertions carry it: the skip ROW pins the explicit guard
    // (deleting the guard drops the row — permission then falls through the not-a-menu branch),
    // and the inject count pins the worse mutation (treating `permission` like `ask_user`).
    const deps = makeDeps({ readVerdict: seqVerdicts(PERMISSION) })
    const store = dwelledStore(menuSignature(PERMISSION))
    const r = await runAskUserAutoAnswerTick([AGENT], store, deps)
    expect(deps.inject).not.toHaveBeenCalled()
    expect(r.skipped).toEqual([{ agentId: 'a1', name: 'alice', reason: 'permission_menu' }])
  })

  it('a CHANGED menu restarts the dwell clock instead of inheriting the old one', async () => {
    // The store dwelled on ASK; the pane now shows a different question.
    const deps = makeDeps({ readVerdict: seqVerdicts(ASK_OTHER) })
    const store = dwelledStore()
    const r = await runAskUserAutoAnswerTick([AGENT], store, deps)
    expect(deps.inject).not.toHaveBeenCalled()
    expect(r.skipped[0].reason).toBe('dwell')
    expect(store.get('a1')?.signature).toBe(menuSignature(ASK_OTHER))
  })

  it('locks out the same menu after answering it — ENTER is never hammered at a stuck dialog', async () => {
    const deps = makeDeps({ readVerdict: seqVerdicts(ASK, ASK, ASK) })
    const store = dwelledStore()
    await runAskUserAutoAnswerTick([AGENT], store, deps)
    expect(deps.inject).toHaveBeenCalledTimes(1)
    // Next tick: same menu still open, per-agent cooldown deliberately clear — only the
    // lockout can refuse, so this pins the lockout and not the cooldown.
    const deps2 = makeDeps({ readVerdict: seqVerdicts(ASK), now: () => 1_030_000 })
    const r2 = await runAskUserAutoAnswerTick([AGENT], store, deps2)
    expect(deps2.inject).not.toHaveBeenCalled()
    expect(r2.skipped[0].reason).toBe('lockout')
  })

  it('re-verifies immediately before ENTER: a menu the human just answered is left alone', async () => {
    // Scan says ask_user, the re-verify read says idle — the bare-ENTER hazard case. Nothing sent.
    const deps = makeDeps({ readVerdict: seqVerdicts(ASK, IDLE) })
    const r = await runAskUserAutoAnswerTick([AGENT], dwelledStore(), deps)
    expect(deps.inject).not.toHaveBeenCalled()
    expect(r.skipped[0].reason).toBe('menu_gone')
  })

  it('re-verify seeing a DIFFERENT menu answers nothing and restarts its dwell', async () => {
    const deps = makeDeps({ readVerdict: seqVerdicts(ASK, ASK_OTHER) })
    const store = dwelledStore()
    const r = await runAskUserAutoAnswerTick([AGENT], store, deps)
    expect(deps.inject).not.toHaveBeenCalled()
    expect(r.skipped[0].reason).toBe('menu_changed')
    expect(store.get('a1')?.signature).toBe(menuSignature(ASK_OTHER))
  })

  it('answers AT MOST ONE agent per tick — the second eligible agent waits for the next beat', async () => {
    const b: AskUserAgentRef = { id: 'b2', name: 'bob' }
    const store = new Map<string, AskUserState>([
      ['a1', { signature: menuSignature(ASK), firstSeenAtMs: 900_000, answeredSignature: null, answeredAtMs: 0 }],
      ['b2', { signature: menuSignature(ASK), firstSeenAtMs: 900_000, answeredSignature: null, answeredAtMs: 0 }],
    ])
    const deps = makeDeps({ readVerdict: vi.fn(async () => ASK) })
    const r = await runAskUserAutoAnswerTick([AGENT, b], store, deps)
    expect(deps.inject).toHaveBeenCalledTimes(1)
    expect(r.answered).toHaveLength(1)
    expect(r.answered[0].agentId).toBe('a1')
  })

  it('the per-agent cooldown (shared with the recovery ladder) refuses a fresh actuation', async () => {
    const deps = makeDeps({ lastActuatedAtMs: () => 1_000_000 - 5_000 })
    const r = await runAskUserAutoAnswerTick([AGENT], dwelledStore(), deps)
    expect(deps.inject).not.toHaveBeenCalled()
    expect(r.skipped[0].reason).toBe('cooldown')
  })

  it('defers to a human at the keyboard (HID gate)', async () => {
    const deps = makeDeps({ hidPresent: () => true })
    const r = await runAskUserAutoAnswerTick([AGENT], dwelledStore(), deps)
    expect(deps.inject).not.toHaveBeenCalled()
    expect(r.skipped[0].reason).toBe('hid_present')
  })

  it('with the fire flag OFF it performs no I/O at all', async () => {
    const readVerdict = seqVerdicts(ASK)
    const deps = makeDeps({ fireEnabled: false, readVerdict })
    const r = await runAskUserAutoAnswerTick([AGENT], dwelledStore(), deps)
    expect(r.blocked).toBe('fire_flag_off')
    expect(readVerdict).not.toHaveBeenCalled()
  })

  it('a machine-wide STOP blocks the whole leg before any read', async () => {
    const readVerdict = seqVerdicts(ASK)
    const deps = makeDeps({ actuationBlocked: () => ({ blocked: true, reason: 'janitor STOP' }), readVerdict })
    const r = await runAskUserAutoAnswerTick([AGENT], dwelledStore(), deps)
    expect(r.blocked).toBe('actuation_blocked')
    expect(readVerdict).not.toHaveBeenCalled()
  })

  it('an unreadable pane is reported, never guessed at', async () => {
    const deps = makeDeps({ readVerdict: seqVerdicts(null) })
    const r = await runAskUserAutoAnswerTick([AGENT], dwelledStore(), deps)
    expect(deps.inject).not.toHaveBeenCalled()
    expect(r.skipped[0].reason).toBe('unreadable')
  })
})

// ── the watchdog leg (ship-dark wiring) ─────────────────────────────────────────

const sendKeys = vi.fn(async (..._a: unknown[]) => {})
const capturePane = vi.fn(async (): Promise<string> => '')

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({
    sendKeys: (...a: unknown[]) => sendKeys(...(a as [])),
    capturePane: (...a: unknown[]) => capturePane(...(a as [])),
  }),
}))

// The real default deps read the pane through this service; the holder lets each test choose
// what the fleet's panes say without re-mocking the module.
const paneVerdict: { current: AskUserVerdict } = { current: ASK }
vi.mock('@/services/block-state-service', () => ({
  readPaneVerdict: async () => ({
    ok: true,
    verdict: {
      blocked: paneVerdict.current.reason === 'ask_user' || paneVerdict.current.reason === 'permission',
      reason: paneVerdict.current.reason,
      excerpt: [paneVerdict.current.question],
      choices: paneVerdict.current.choices,
    },
  }),
}))

const SNAP = {
  scannedAt: 0,
  agents: [{ agentId: 'a1', name: 'alice', class: 'healthy' }],
  recoveryTargets: [],
} as unknown as FleetLivenessSnapshot

let saved: string | undefined
let tmpDir: string

beforeEach(() => {
  saved = process.env.HOME
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-askuser-leg-'))
  process.env.HOME = tmpDir
  sendKeys.mockReset()
  sendKeys.mockImplementation(async () => {})
  capturePane.mockReset()
  capturePane.mockImplementation(async () => '')
  paneVerdict.current = ASK
  resetAskUserStore()
  resetRecoveryStore()
})

afterEach(() => {
  if (saved === undefined) delete process.env.HOME
  else process.env.HOME = saved
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

const tick = (over: Record<string, unknown> = {}) =>
  runFleetLivenessTick({
    scan: async () => SNAP,
    log: () => {},
    nudgeEnabled: false,
    now: () => 2_000_000,
    ...over,
  })

describe('fleet watchdog — the AskUser auto-answer leg', () => {
  it('is OFF by default: a fleet parked on a menu produces NO keystroke', async () => {
    // The ship-dark guarantee, same as the model-fallback leg's: nothing here can prove the
    // ENTER dismissed a real menu, so arming AIM_FLEET_ASKUSER_AUTOANSWER is a human act.
    await tick()
    await tick({ now: () => 2_000_000 + 10 * 60_000 })
    expect(sendKeys).not.toHaveBeenCalled()
  })

  it('when enabled, answers a dwelled menu with exactly one Enter key NAME (never text)', async () => {
    await tick({ askUserAutoAnswerEnabled: true })                          // dwell starts
    expect(sendKeys).not.toHaveBeenCalled()
    await tick({ askUserAutoAnswerEnabled: true, now: () => 2_000_000 + 5 * 60_000 })
    expect(sendKeys.mock.calls.map((c) => [c[1], c[2]])).toEqual([['Enter', undefined]])
  })

  it('when enabled, a fleet parked on a PERMISSION prompt still gets nothing', async () => {
    paneVerdict.current = PERMISSION
    await tick({ askUserAutoAnswerEnabled: true })
    await tick({ askUserAutoAnswerEnabled: true, now: () => 2_000_000 + 10 * 60_000 })
    expect(sendKeys).not.toHaveBeenCalled()
  })

  it('never lets a leg failure discard the liveness snapshot', async () => {
    const snap = await tick({
      askUserAutoAnswerEnabled: true,
      runAskUser: async () => {
        throw new Error('leg exploded')
      },
    })
    expect(snap).not.toBeNull()
  })
})

/*
 * NEUTER RUNS (2026-08-08 — feature committed as 8e03e32f FIRST, each mutation reverted by
 * AIM_ALLOW_DIRTY_RESTORE checkout to the committed blob):
 *
 *   1. s/process.env.AIM_FLEET_ASKUSER_AUTOANSWER === '1'/true/   (leg defaults ON)
 *      → 1 red / 17 green: "is OFF by default: a fleet parked on a menu produces NO keystroke"
 *   2. permission guard `=== 'permission'` → `=== 'never-matches'`
 *      → red: "NEVER answers a permission prompt" (the skip ROW disappears — permission then
 *        falls through the not-a-menu branch, so the row assertion is what pins the guard)
 *   3. lockout condition → `false && …`
 *      → red: "locks out the same menu after answering it"
 *      (2+3 ran combined; independent by fixture — each test reaches only its own guard)
 *   4a. re-verify reason check → null-check only   4b. signature check → `false && …`
 *      → 2 red: "re-verifies immediately before ENTER" (4a — IDLE re-read now injects) and
 *        "re-verify seeing a DIFFERENT menu" (4b — ASK_OTHER passes the surviving null check)
 *
 * What none of this can prove, stated so nobody reads the green as more than it is: that a real
 * Claude Code menu is DISMISSED by the ENTER. The tests prove the keystroke is sent and every
 * refusal path refuses. Arming AIM_FLEET_ASKUSER_AUTOANSWER stays a deliberate human act.
 */
