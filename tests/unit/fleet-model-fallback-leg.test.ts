import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { statePath } from '@/lib/ecosystem-constants'
import { runFleetLivenessTick, resetModelFallbackState, resetRecoveryStore } from '@/lib/fleet-liveness-watchdog'
import type { FleetLivenessSnapshot } from '@/lib/fleet-liveness'

const sendKeys = vi.fn(async (..._a: unknown[]) => {})
const capturePane = vi.fn(async (_n?: unknown, _l?: unknown): Promise<string> => '')

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({
    sendKeys: (...a: unknown[]) => sendKeys(...(a as [])),
    capturePane: (...a: unknown[]) => capturePane(...(a as [])),
  }),
}))
vi.mock('@/services/block-state-service', () => ({
  readPaneVerdict: async () => ({ ok: true, verdict: { blocked: false, reason: 'idle' } }),
}))

const FABLE_PANE = 'work\n  🤖 Fable 5 v2.1.223 ·xhigh 🧠 | 📁 alice | 📊 400k/1.0m'

/** A snapshot with one agent and nothing for the OTHER legs to do (no recovery targets). */
const SNAP = {
  scannedAt: 0,
  agents: [{ agentId: 'a1', name: 'alice', class: 'healthy' }],
  recoveryTargets: [],
} as unknown as FleetLivenessSnapshot

let saved: string | undefined
let tmpDir: string

/** Write a FRESH stamp carrying an exhausted Fable window over a healthy account. */
function putWindows(windows: unknown) {
  const f = statePath('oauth-rotator-tick-status.json')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify({ nextAction: 'stuck', at: new Date().toISOString(), windows }))
}

const EXHAUSTED = { fiveHourPct: 42, sevenDayPct: 60, scopedModel: 'Fable 5', scopedPct: 98 }

beforeEach(() => {
  saved = process.env.HOME
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-fallback-leg-'))
  process.env.HOME = tmpDir
  const f = statePath('oauth-rotator-tick-status.json')
  if (!f.startsWith(tmpDir)) throw new Error(`refusing to run: stamp path ${f} escaped tmp ${tmpDir}`)
  sendKeys.mockReset()
  sendKeys.mockImplementation(async () => {})
  capturePane.mockReset()
  capturePane.mockImplementation(async () => FABLE_PANE)
  resetModelFallbackState()
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
    now: () => 1_000_000,
    ...over,
  })

describe('fleet watchdog — the model-fallback leg', () => {
  it('is OFF by default: an exhausted Fable window produces NO keystroke', async () => {
    // The guarantee that matters most. No test can prove the confirming ENTER dismissed Claude
    // Code's dialog, so this ships dark until a human has watched one switch on a real pane.
    putWindows(EXHAUSTED)
    await tick()
    expect(sendKeys).not.toHaveBeenCalled()
  })

  it('switches an agent when explicitly enabled', async () => {
    putWindows(EXHAUSTED)
    await tick({ modelFallbackEnabled: true })
    // ESC, the command, the confirming ENTER.
    expect(sendKeys.mock.calls.map(c => c[1])).toEqual(['Escape', '/model opus', 'Enter'])
  })

  it('does nothing when the stamp carries NO window snapshot', async () => {
    putWindows(undefined)
    await tick({ modelFallbackEnabled: true })
    expect(sendKeys).not.toHaveBeenCalled()
  })

  it('does nothing when the stamp is STALE, however exhausted it says the window is', async () => {
    const f = statePath('oauth-rotator-tick-status.json')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify({
      nextAction: 'stuck',
      at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      windows: EXHAUSTED,
    }))
    await tick({ modelFallbackEnabled: true })
    expect(sendKeys).not.toHaveBeenCalled()
  })

  it('does nothing when the ACCOUNT is exhausted too — that needs a rotation, not a model switch', async () => {
    putWindows({ ...EXHAUSTED, sevenDayPct: 99 })
    await tick({ modelFallbackEnabled: true })
    expect(sendKeys).not.toHaveBeenCalled()
  })

  it('does nothing when no agent is on the exhausted model', async () => {
    capturePane.mockImplementation(async () => '  🤖 Opus 5 (1M) v2.1.223 ·xhigh 🧠 | 📁 alice')
    putWindows(EXHAUSTED)
    await tick({ modelFallbackEnabled: true })
    expect(sendKeys).not.toHaveBeenCalled()
  })

  it('paces itself across ticks — a second tick in the same minute switches nobody', async () => {
    putWindows(EXHAUSTED)
    await tick({ modelFallbackEnabled: true })
    const afterFirst = sendKeys.mock.calls.length
    expect(afterFirst).toBe(3)
    await tick({ modelFallbackEnabled: true }) // same injected clock ⇒ 0s elapsed
    expect(sendKeys.mock.calls.length).toBe(afterFirst)
  })

  it('does NOT re-switch the same agent on the next tick — the shared cooldown holds it', async () => {
    // Written first as "proceeds on a later tick" expecting 6 keystrokes, and it found a real
    // defect instead: the per-agent cooldown is 10 minutes, so 60s later this agent is still
    // gated. In production it has also left the candidate list (its pane now says Opus). What
    // the sweep must NOT do is stall on it — see the sibling sweep test for the skip.
    putWindows(EXHAUSTED)
    await tick({ modelFallbackEnabled: true })
    expect(sendKeys.mock.calls.length).toBe(3)
    await tick({ modelFallbackEnabled: true, now: () => 1_000_000 + 60_000 })
    expect(sendKeys.mock.calls.length).toBe(3)
  })

  it('never lets a fallback failure discard the liveness snapshot', async () => {
    // Every leg runs in its own try for this reason: detection is the watchdog's core job.
    capturePane.mockImplementation(async () => {
      throw new Error('tmux exploded')
    })
    putWindows(EXHAUSTED)
    const snap = await tick({ modelFallbackEnabled: true })
    expect(snap).not.toBeNull()
  })
})
