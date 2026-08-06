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

  it('SKIPS a cooled-down agent and switches the next one instead of stalling', async () => {
    // The first version took actions[0] only, so one agent could block the whole sweep: a switch
    // that FAILED to take leaves that agent still on the exhausted model, still first, and
    // holding a 10-minute cooldown — during which no OTHER agent gets switched. Invisible in the
    // happy case, because a switched agent leaves the candidate list on the next pane read.
    const { d, sent } = deps()
    const out = await runModelFallbackSweep(
      inputs({ lastActuatedAtMs: (id) => (id === 'a1' ? NOW - 1_000 : null) }),
      d,
    )
    expect(out).toMatchObject({ acted: true, agentId: 'a2' })
    expect(new Set(sent.map(s => s.agentId))).toEqual(new Set(['a2']))
  })

  it('does NOT skip past a fleet-wide refusal — that would just re-refuse once per agent', async () => {
    // Cooldown is the only PER-AGENT gate. HID presence, the fire flag, a machine-wide STOP all
    // apply to every candidate equally, so iterating would report the last one having tried N.
    const { d, sent } = deps({ hidPresent: () => true })
    const out = await runModelFallbackSweep(inputs(), d)
    expect(out).toMatchObject({ acted: false, reason: 'refused' })
    if (out.acted) throw new Error('unreachable')
    expect(out.detail).toMatch(/hid_present/)
    expect(sent).toEqual([])
  })

  it('reports the last cooldown when EVERY candidate is cooling down', async () => {
    const { d } = deps()
    const out = await runModelFallbackSweep(inputs({ lastActuatedAtMs: () => NOW - 1_000 }), d)
    expect(out).toMatchObject({ acted: false, reason: 'refused' })
    if (out.acted) throw new Error('unreachable')
    expect(out.detail).toMatch(/cooldown/)
  })
})

/*
 * NEUTER RUNS (2026-08-06 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *
 *   s/if \(input\.lastSweepAtMs !== null && now - input\.lastSweepAtMs < interval\)/if (false)/
 *   → 2 red / 7 green:
 *       names paced separately from every other no-op reason
 *       refuses a second switch inside the interval, whatever the beat cadence is
 *
 *   s/if \(!plan\.act\) return/if (false) return/
 *   → 3 red / 6 green:
 *       names paced separately from every other no-op reason
 *       reports the account-exhausted skip rather than switching anyway
 *       reports the drained state distinctly, not as a generic no-op
 *
 * The FIRST attempt at both produced NO output, and the reason is worth keeping: the file was
 * still untracked, so scripts/dev/neuter REFUSED — there was no committed state to restore to.
 * That is the tool enforcing "commit before neutering", and it is exactly the case where a
 * hand-rolled neuter would have measured nothing and reported green.
 *
 *   s/if \(decision\.reason !== 'cooldown'\) return/if (true) return/   (stall instead of skip)
 *   → 1 red / 11 green:
 *       SKIPS a cooled-down agent and switches the next one instead of stalling
 *
 * That guard exists because a LEG test found the defect, not because it was designed in. The
 * sweep originally took actions[0] only, and the failing test ("proceeds on a later tick") was
 * written expecting a second switch. It could not happen: the per-agent cooldown is 10 minutes.
 * Chasing why exposed the real problem — an agent whose switch FAILED to take stays first in the
 * list holding that cooldown, and blocks every other agent for the whole window. Invisible on the
 * happy path, because a switched agent leaves the candidate list on the next pane read.
 */
