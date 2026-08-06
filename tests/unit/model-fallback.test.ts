import { describe, it, expect } from 'vitest'
import {
  planModelFallback,
  modelFamily,
  stuckSuggestsModelFallback,
  FALLBACK_INTERVAL_MS,
  CONFIRM_DELAY_MS,
  ACCOUNT_HEADROOM_PCT,
  type FallbackCandidate,
} from '@/lib/oauth-rotator/model-fallback'

const T0 = 1_770_000_000_000

/** A fleet mixing the exhausted family with others, using the REAL display-string shape the
 *  registry stores (`Agent.model`, types/agent.ts:207) — never bare family tokens. */
const FLEET: FallbackCandidate[] = [
  { agentId: 'a1', name: 'alice', model: 'Fable 5' },
  { agentId: 'a2', name: 'bob', model: 'Opus 4.8' },
  { agentId: 'a3', name: 'carol', model: 'Fable 5' },
  { agentId: 'a4', name: 'dave', model: 'Sonnet 5' },
]

/** Healthy account, exhausted Fable window — the incident's exact shape (5h 42% / 7d 60% / Fable 98%). */
function incidentInputs(over: Partial<Parameters<typeof planModelFallback>[0]> = {}) {
  return {
    scopedModel: 'Fable 5',
    scopedPct: 98,
    account5hPct: 42,
    account7dPct: 60,
    agents: FLEET,
    startAtMs: T0,
    ...over,
  }
}

describe('modelFamily', () => {
  it('reduces a display string to its family, which is the only stable join key to a scoped window', () => {
    expect(modelFamily('Fable 5')).toBe('fable')
    expect(modelFamily('Opus 4.8')).toBe('opus')
    expect(modelFamily('Sonnet 5')).toBe('sonnet')
    // The version moves; the family is what a window is scoped to.
    expect(modelFamily('Opus 5')).toBe(modelFamily('Opus 4.8'))
  })

  it('is not merely lowercasing — a raw compare against the family token would match nothing', () => {
    // This is the whole point. If modelFamily degraded to `s => s.toLowerCase()`, this fails,
    // and so does every plan below: the filter would find zero victims and the sweep would
    // silently no-op, which is indistinguishable from a healthy fleet.
    expect('Fable 5'.toLowerCase()).not.toBe('fable')
    expect(modelFamily('Fable 5')).toBe('fable')
  })
})

describe('planModelFallback — when it acts', () => {
  it('switches exactly the agents on the exhausted family, and no others', () => {
    const plan = planModelFallback(incidentInputs())
    expect(plan.act).toBe(true)
    if (!plan.act) throw new Error('unreachable')
    expect(plan.actions.map(a => a.agentId)).toEqual(['a1', 'a3'])
  })

  it("spaces agents by the USER's 60 seconds, absolute and cumulative", () => {
    const plan = planModelFallback(incidentInputs())
    if (!plan.act) throw new Error('expected a plan')
    expect(FALLBACK_INTERVAL_MS).toBe(60_000)
    expect(plan.actions.map(a => a.dueAtMs)).toEqual([T0, T0 + 60_000])
  })

  it('paces from a fixed origin, so a late dispatch cannot compound its own latency', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ agentId: `x${i}`, model: 'Fable 5' }))
    const plan = planModelFallback(incidentInputs({ agents: many }))
    if (!plan.act) throw new Error('expected a plan')
    // i * interval off ONE origin — not "previous + interval", which would drift by dispatch cost.
    expect(plan.actions.map(a => a.dueAtMs - T0)).toEqual([0, 60_000, 120_000, 180_000, 240_000])
  })

  it('carries a curated command KEY, never a raw command string', () => {
    const plan = planModelFallback(incidentInputs())
    if (!plan.act) throw new Error('expected a plan')
    for (const a of plan.actions) {
      expect(a.commandKey).toBe('model-opus')
      expect(a.commandKey).not.toMatch(/[/\s]/) // a key, not "/model opus"
    }
  })

  it('schedules the confirming ENTER — without it the sweep leaves every agent blocked on a dialog', () => {
    const plan = planModelFallback(incidentInputs())
    if (!plan.act) throw new Error('expected a plan')
    for (const a of plan.actions) {
      expect(a.escapeFirst).toBe(true)
      expect(a.confirmAfterMs).toBe(CONFIRM_DELAY_MS)
      expect(a.confirmAfterMs).toBeGreaterThan(0)
    }
  })

  it('confirms well inside the interval, so two panes are never mid-dialog at once', () => {
    expect(CONFIRM_DELAY_MS).toBeLessThan(FALLBACK_INTERVAL_MS)
  })
})

describe('planModelFallback — when it refuses, and why the reason is named', () => {
  it('does nothing when the model window is not actually exhausted', () => {
    const plan = planModelFallback(incidentInputs({ scopedPct: 40 }))
    expect(plan).toEqual({ act: false, skip: 'no-model-scoped-exhaustion' })
  })

  it('refuses when the ACCOUNT is also spent — switching model cannot escape an account limit', () => {
    // The rotator's error inverted: it rotated the credential to escape a MODEL limit. Switching
    // the model to escape an ACCOUNT limit buys nothing and spends a burst against the very
    // limit already binding.
    const plan = planModelFallback(incidentInputs({ account5hPct: 99 }))
    expect(plan).toEqual({ act: false, skip: 'account-also-exhausted' })
  })

  it('treats an UNKNOWN account window as exhausted, not as healthy', () => {
    // Fail-safe direction. Reading null as "fine" would fire the sweep in exactly the case it
    // cannot reason about — the same fail-open shape that let a stuck rotator report `ok`.
    expect(planModelFallback(incidentInputs({ account5hPct: null }))).toEqual({
      act: false,
      skip: 'account-also-exhausted',
    })
    expect(planModelFallback(incidentInputs({ account7dPct: null }))).toEqual({
      act: false,
      skip: 'account-also-exhausted',
    })
  })

  it('names the boundary rather than straddling it', () => {
    expect(planModelFallback(incidentInputs({ account7dPct: ACCOUNT_HEADROOM_PCT })).act).toBe(false)
    expect(planModelFallback(incidentInputs({ account7dPct: ACCOUNT_HEADROOM_PCT - 1 })).act).toBe(true)
  })

  it('does nothing when no agent is on the exhausted family', () => {
    const plan = planModelFallback(incidentInputs({ scopedModel: 'Haiku 4.5' }))
    expect(plan).toEqual({ act: false, skip: 'no-agents-on-that-model' })
  })
})

describe('stuckSuggestsModelFallback', () => {
  it('fires only on the all-maxed signature, which is what a scoped exhaustion looks like to the rotator', () => {
    expect(stuckSuggestsModelFallback('stuck', 'all-maxed')).toBe(true)
    // cannot-rotate-offline has the OPPOSITE remedy — a model switch does not restore a network.
    expect(stuckSuggestsModelFallback('stuck', 'cannot-rotate-offline')).toBe(false)
    expect(stuckSuggestsModelFallback('ok', 'all-maxed')).toBe(false)
    expect(stuckSuggestsModelFallback('stuck', undefined)).toBe(false)
  })
})
