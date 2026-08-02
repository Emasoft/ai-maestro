import { describe, it, expect, vi } from 'vitest'
import { dueForDelivery, deliveryText, BACKOFF_LADDER_S, type AlertRecord } from '@/lib/oauth-rotator/alert-delivery'
import { runOneSupervisorBeat } from '@/lib/oauth-rotator/server-supervisor'

const rec = (over: Partial<AlertRecord> = {}): AlertRecord =>
  ({ firstSeenAt: 1000, lastDeliveredAt: 1000, message: 'm', seen: 1, ...over })

describe('dueForDelivery — the backoff ladder (TRDD-RFQFCCU4)', () => {
  it('the ONSET always delivers — a never-seen code goes out at once', () => {
    // The moment of onset is the most actionable moment there will ever be.
    expect(dueForDelivery(undefined, 5_000)).toBe(true)
  })

  it('does NOT re-deliver on the next beat — this is the 4506-lines defect', () => {
    // A beat is 60s. Same code, one beat later, must stay silent: an alert that repeats every
    // minute forever is how `a human must re-login` became furniture over four days.
    expect(dueForDelivery(rec({ lastDeliveredAt: 1000 }), 1060)).toBe(false)
  })

  it('re-delivers once the rung elapses, and the rung WIDENS as it stays outstanding', () => {
    // Rung 1 is 15 min after the onset delivery.
    expect(dueForDelivery(rec({ firstSeenAt: 1000, lastDeliveredAt: 1000 }), 1000 + 899)).toBe(false)
    expect(dueForDelivery(rec({ firstSeenAt: 1000, lastDeliveredAt: 1000 }), 1000 + 900)).toBe(true)

    // Having been outstanding for 15 min at the last delivery, the NEXT gap is the wider rung —
    // so 15 min later is NOT yet due.
    const later = rec({ firstSeenAt: 1000, lastDeliveredAt: 1000 + 900 })
    expect(dueForDelivery(later, 1000 + 900 + 900)).toBe(false)
    expect(dueForDelivery(later, 1000 + 900 + 3600)).toBe(true)
  })

  it('NEVER goes permanently silent — the widest rung still fires', () => {
    // An outstanding credential problem that has gone quiet is indistinguishable from one that was
    // fixed, and that ambiguity is what let the incident run for four days.
    const old = rec({ firstSeenAt: 0, lastDeliveredAt: 100_000 })
    const widest = BACKOFF_LADDER_S[BACKOFF_LADDER_S.length - 1]
    expect(dueForDelivery(old, 100_000 + widest)).toBe(true)
  })
})

describe('deliveryText — the age is the part a log line cannot carry', () => {
  it('states how long the alert has been OUTSTANDING once it is not brand new', () => {
    // "stuck" and "stuck since Tuesday" are different emergencies.
    expect(deliveryText('cookie-leg-stuck', 'x@y needs a login', 4 * 3600)).toMatch(/OUTSTANDING 4\.0h/)
  })
  it('omits the age at onset, where it would read as a stale alert', () => {
    expect(deliveryText('cookie-leg-stuck', 'x@y needs a login', 5)).toBe('[cookie-leg-stuck] x@y needs a login')
  })
})

describe('the beat DELIVERS, and delivery can never take the beat down', () => {
  const facts = { optIn: true, onMacos: true, pinningEnv: [], daemonAlive: true, tickCompletedAgeS: 1, slots: [] }

  it('a finding reaches the DELIVERY channel, not only the log', () => {
    // The whole defect: findings were perfect and reached only console.warn.
    const delivered: Array<ReadonlyArray<{ code: string }>> = []
    const codes = runOneSupervisorBeat({
      optInCheck: () => true,
      tickArmedCheck: () => true,
      gatherFactsImpl: () => ({ ...facts, pinningEnv: ['ANTHROPIC_API_KEY'] }) as never,
      log: () => {},
      deliver: f => { delivered.push(f) },
    })
    expect(codes).toContain('pinning-env')
    expect(delivered).toHaveLength(1)
    expect(delivered[0].map(f => f.code)).toContain('pinning-env')
  })

  it('a THROWING delivery leaves the beat’s verdict intact — a guardian must not remove itself', () => {
    const codes = runOneSupervisorBeat({
      optInCheck: () => true,
      tickArmedCheck: () => true,
      gatherFactsImpl: () => ({ ...facts, pinningEnv: ['ANTHROPIC_API_KEY'] }) as never,
      log: () => {},
      deliver: () => { throw new Error('notifier exploded') },
    })
    // POSITIVE CONTROL is the assertion itself: an empty array here would mean the beat was taken
    // down by its own notifier, which is the failure this test exists to forbid.
    expect(codes).toContain('pinning-env')
  })

  it('NO findings ⇒ NO delivery call — silence must stay silent', () => {
    const deliver = vi.fn()
    const codes = runOneSupervisorBeat({
      optInCheck: () => true,
      tickArmedCheck: () => true,
      gatherFactsImpl: () => facts as never,
      log: () => {},
      deliver,
    })
    expect(codes).toEqual([])
    expect(deliver).not.toHaveBeenCalled()
  })
})
