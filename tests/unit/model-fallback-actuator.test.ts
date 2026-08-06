import { describe, it, expect, vi } from 'vitest'
import {
  actuateModelFallback,
  type FallbackInjection,
  type ModelFallbackDeps,
} from '@/lib/oauth-rotator/model-fallback-actuator'
import type { FallbackAction } from '@/lib/oauth-rotator/model-fallback'
import type { InjectResult } from '@/lib/fleet-recovery-actuator'

const ACTION: FallbackAction = {
  agentId: 'a1',
  name: 'alice',
  commandKey: 'model-opus',
  escapeFirst: true,
  confirmAfterMs: 3_000,
  dueAtMs: 0,
}

/** All gates OPEN, injector records every keystroke. `sleep` is faked so the 3s settle costs
 *  nothing — a real wait would make this suite the slowest file in the repo for no signal. */
function deps(
  over: Partial<ModelFallbackDeps> = {},
  /** Per-step outcome. Kept SEPARATE from `over` because overriding `inject` wholesale would
   *  replace the recorder, leaving `sent` empty — which reads exactly like "nothing was injected"
   *  and made the two failed-step tests assert against an empty array. */
  result: (i: FallbackInjection) => InjectResult = () => ({ ok: true }),
) {
  const sent: FallbackInjection[] = []
  const d: ModelFallbackDeps = {
    fireEnabled: true,
    actuationBlocked: () => ({ blocked: false, reason: null }),
    hidPresent: () => false,
    now: () => 1_000_000,
    commandExists: () => true,
    sleep: async () => {},
    ...over,
    // AFTER the spread: recording is not overridable, only its outcome is.
    inject: async (i) => {
      sent.push(i)
      return result(i)
    },
  }
  return { d, sent }
}

describe('actuateModelFallback — the happy path', () => {
  it('sends ESC, then the command, then the confirming ENTER, in that order', async () => {
    const { d, sent } = deps()
    const out = await actuateModelFallback(ACTION, null, d)
    expect(out).toMatchObject({ fired: true, steps: ['esc', 'command', 'confirm'] })
    expect(sent.map(s => s.step)).toEqual(['esc', 'command', 'confirm'])
  })

  it('names a curated KEY on the command step and sends no command text anywhere', async () => {
    const { d, sent } = deps()
    await actuateModelFallback(ACTION, null, d)
    const cmd = sent.find(s => s.step === 'command')!
    expect(cmd.commandKey).toBe('model-opus')
    // The injection boundary: nothing in any step may look like a typed command.
    for (const s of sent) expect(JSON.stringify(s)).not.toContain('/model')
  })

  it('waits the settle delay before confirming, so the dialog is drawn first', async () => {
    const sleep = vi.fn(async () => {})
    const { d } = deps({ sleep })
    await actuateModelFallback(ACTION, null, d)
    expect(sleep).toHaveBeenCalledWith(3_000)
  })
})

describe('actuateModelFallback — refusals happen BEFORE any keystroke', () => {
  const cases: Array<[string, Partial<ModelFallbackDeps>, string]> = [
    ['the master fire flag is off', { fireEnabled: false }, 'fire_flag_off'],
    [
      'a machine-wide STOP is in force',
      { actuationBlocked: () => ({ blocked: true, reason: 'janitor stop' }) },
      'actuation_blocked',
    ],
    ['the owner is at the keyboard', { hidPresent: () => true }, 'hid_present'],
  ]

  for (const [label, over, reason] of cases) {
    it(`refuses and injects NOTHING when ${label}`, async () => {
      const { d, sent } = deps(over)
      const out = await actuateModelFallback(ACTION, null, d)
      expect(out).toMatchObject({ fired: false, reason })
      expect(sent).toEqual([]) // the point: a refusal is silent on the wire
    })
  }

  it('respects the per-agent cooldown shared with the recovery ladder', async () => {
    const { d, sent } = deps({ now: () => 1_000_000, cooldownMs: 600_000 })
    const out = await actuateModelFallback(ACTION, 1_000_000 - 60_000, d)
    expect(out).toMatchObject({ fired: false, reason: 'cooldown' })
    expect(sent).toEqual([])
  })

  it('reports an unknown command key even while the fire flag is OFF', async () => {
    // A configuration defect must surface while the subsystem is still dark. Caught only after
    // arming, a typo first shows up as a fleet silently receiving nothing, in production.
    const { d, sent } = deps({ fireEnabled: false, commandExists: () => false })
    const out = await actuateModelFallback(ACTION, null, d)
    expect(out).toMatchObject({ fired: false, reason: 'unknown_command_key', detail: 'model-opus' })
    expect(sent).toEqual([])
  })
})

describe('actuateModelFallback — a failed command must NOT be confirmed', () => {
  it('stops after a failed command rather than sending a bare ENTER', async () => {
    // THE hazard. No command landed ⇒ no dialog exists ⇒ a bare ENTER goes to a live prompt and
    // SUBMITS whatever text is sitting in it. A failed model switch would become the agent being
    // handed an arbitrary instruction — worse than the switch simply not happening.
    const { d, sent } = deps({}, (i) =>
      i.step === 'command' ? { ok: false, detail: 'tmux gone' } : { ok: true },
    )
    const out = await actuateModelFallback(ACTION, null, d)
    expect(sent.map(s => s.step)).toEqual(['esc', 'command'])
    expect(sent.some(s => s.step === 'confirm')).toBe(false)
    expect(out).toMatchObject({ fired: true, confirmed: null })
    if (!out.fired) throw new Error('unreachable')
    expect(out.detail).toMatch(/command failed/)
  })

  it('stops after a failed ESC for the same reason', async () => {
    const { d, sent } = deps({}, (i) => (i.step === 'esc' ? { ok: false } : { ok: true }))
    const out = await actuateModelFallback(ACTION, null, d)
    expect(sent.map(s => s.step)).toEqual(['esc'])
    expect(out).toMatchObject({ fired: true, confirmed: null })
  })
})

describe('actuateModelFallback — the post-condition', () => {
  it('reports confirmed when the pane is no longer asking', async () => {
    const { d } = deps({ verify: async () => ({ blocked: false, reason: 'idle' }) })
    const out = await actuateModelFallback(ACTION, null, d)
    expect(out).toMatchObject({ fired: true, confirmed: true })
  })

  it('reports NOT confirmed when the agent is still parked on the dialog', async () => {
    // Every keystroke reported ok and the switch still did not happen. Without the post-condition
    // this is indistinguishable from success — which is the whole failure mode.
    const { d } = deps({ verify: async () => ({ blocked: true, reason: 'ask_user' }) })
    const out = await actuateModelFallback(ACTION, null, d)
    expect(out).toMatchObject({ fired: true, confirmed: false })
    if (!out.fired) throw new Error('unreachable')
    expect(out.detail).toMatch(/still blocked: ask_user/)
  })

  it('reports UNKNOWN, never success, when no verifier was supplied', async () => {
    const { d } = deps()
    const out = await actuateModelFallback(ACTION, null, d)
    expect(out).toMatchObject({ fired: true, confirmed: null })
  })

  it('reports UNKNOWN when the pane could not be read', async () => {
    const { d } = deps({ verify: async () => null })
    const out = await actuateModelFallback(ACTION, null, d)
    expect(out).toMatchObject({ fired: true, confirmed: null, detail: 'pane unreadable' })
  })
})

/*
 * NEUTER RUNS (2026-08-06 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *
 *   s/if \(!cmdRes\.ok\)/if (false)/          (a failed command gets confirmed anyway)
 *   → 1 red / 13 green:
 *       stops after a failed command rather than sending a bare ENTER
 *
 *   s/if \(!entry\.ok\) return/if (false) return/
 *   → 2 red / 12 green:
 *       refuses and injects NOTHING when a machine-wide STOP is in force
 *       refuses and injects NOTHING when the master fire flag is off
 *
 *   s/const stillAsking = verdict\.blocked/const stillAsking = false && verdict.blocked/
 *   → 1 red / 13 green:
 *       reports NOT confirmed when the agent is still parked on the dialog
 *
 * FIXTURE NOTE, because it produced two failures that looked like code failures. `deps()` first
 * spread `over` AFTER `inject`, so a test supplying its own injector replaced the RECORDER and
 * `sent` stayed empty — which reads exactly like "nothing was injected", i.e. like the guard
 * under test working. The per-step outcome is now a separate parameter and recording is not
 * overridable, only its result is.
 */
