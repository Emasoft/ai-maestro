import { describe, it, expect } from 'vitest'
import { runModelFallbackSweep, type SweepInputs } from '@/lib/oauth-rotator/model-fallback-sweep'
import type { ModelFallbackDeps } from '@/lib/oauth-rotator/model-fallback-actuator'
import type { FallbackInjection } from '@/lib/oauth-rotator/model-fallback-actuator'

const NOW = 1_770_000_000_000

const FLEET = [
  { agentId: 'a1', name: 'alice', model: 'Fable 5' },
  { agentId: 'a2', name: 'bob', model: 'Fable 5 (1M)' },
  { agentId: 'a3', name: 'carol', model: 'Opus 5' },
]

function inputs(over: Partial<SweepInputs> = {}): SweepInputs {
  return {
    scopedModel: 'Fable 5',
    scopedPct: 98,
    account5hPct: 42,
    account7dPct: 60,
    candidates: FLEET,
    lastSweepAtMs: null,
    lastActuatedAtMs: () => null,
    ...over,
  }
}

function deps(over: Partial<ModelFallbackDeps> = {}) {
  const sent: FallbackInjection[] = []
  const d: ModelFallbackDeps = {
    fireEnabled: true,
    actuationBlocked: () => ({ blocked: false, reason: null }),
    hidPresent: () => false,
    now: () => NOW,
    commandExists: () => true,
    sleep: async () => {},
    ...over,
    inject: async (i) => {
      sent.push(i)
      return { ok: true }
    },
  }
  return { d, sent }
}

describe('runModelFallbackSweep — one agent per invocation', () => {
  it('switches exactly ONE agent even though two are on the exhausted model', async () => {
    const { d, sent } = deps()
    const out = await runModelFallbackSweep(inputs(), d)
    expect(out).toMatchObject({ acted: true, agentId: 'a1' })
    expect(new Set(sent.map(s => s.agentId))).toEqual(new Set(['a1']))
  })

  it('takes the next agent once the first has left the list — the list drains itself', async () => {
    // This is the whole pacing design: no persisted plan. Once a1 is on Opus its pane no longer
    // reports Fable, so the next sweep re-derives a shorter list and picks up a2.
    const { d } = deps()
    const after = await runModelFallbackSweep(
      inputs({ candidates: FLEET.filter(a => a.agentId !== 'a1'), lastSweepAtMs: null }),
      d,
    )
    expect(after).toMatchObject({ acted: true, agentId: 'a2' })
  })

  it('reports the drained state distinctly, not as a generic no-op', async () => {
    const { d } = deps()
    const out = await runModelFallbackSweep(inputs({ candidates: [FLEET[2]!] }), d)
    expect(out).toEqual({ acted: false, reason: 'no-agents-on-that-model' })
  })
})

describe("runModelFallbackSweep — the USER's 60s, enforced here", () => {
  it('refuses a second switch inside the interval, whatever the beat cadence is', async () => {
    // Enforced in the sweep rather than trusted to the beat: a faster beat would otherwise
    // switch the fleet in a burst, which is the rate-limit ban the interval exists to avoid.
    const { d, sent } = deps()
    const out = await runModelFallbackSweep(inputs({ lastSweepAtMs: NOW - 30_000 }), d)
    expect(out).toMatchObject({ acted: false, reason: 'paced' })
    expect(sent).toEqual([]) // nothing on the wire
  })

  it('proceeds once the interval has elapsed', async () => {
    const { d } = deps()
    const out = await runModelFallbackSweep(inputs({ lastSweepAtMs: NOW - 60_000 }), d)
    expect(out).toMatchObject({ acted: true })
  })

  it('names paced separately from every other no-op reason', async () => {
    // A caller that logged one "no action" for both could not tell a working sweep from a
    // stalled one, which is how a 3.7-day rotator outage stayed invisible.
    const { d } = deps()
    const paced = await runModelFallbackSweep(inputs({ lastSweepAtMs: NOW - 1_000 }), d)
    const drained = await runModelFallbackSweep(inputs({ candidates: [] }), d)
    if (paced.acted || drained.acted) throw new Error('expected both to be no-ops')
    expect(paced.reason).not.toBe(drained.reason)
  })
})

describe('runModelFallbackSweep — refusals propagate with their reason', () => {
  it('reports the account-exhausted skip rather than switching anyway', async () => {
    const { d, sent } = deps()
    const out = await runModelFallbackSweep(inputs({ account7dPct: 99 }), d)
    expect(out).toEqual({ acted: false, reason: 'account-also-exhausted' })
    expect(sent).toEqual([])
  })

  it('surfaces a gate refusal, naming the gate', async () => {
    const { d, sent } = deps({ fireEnabled: false })
    const out = await runModelFallbackSweep(inputs(), d)
    expect(out).toMatchObject({ acted: false, reason: 'refused' })
    if (out.acted) throw new Error('unreachable')
    expect(out.detail).toMatch(/fire_flag_off/)
    expect(sent).toEqual([])
  })

  it("honours the per-agent cooldown shared with the recovery ladder", async () => {
    const { d } = deps()
    const out = await runModelFallbackSweep(
      inputs({ lastActuatedAtMs: () => NOW - 60_000, lastSweepAtMs: null }),
      d,
    )
    expect(out).toMatchObject({ acted: false, reason: 'refused' })
    if (out.acted) throw new Error('unreachable')
    expect(out.detail).toMatch(/cooldown/)
  })
})
