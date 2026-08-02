/**
 * TRDD-GY0LJV6S — the rotation-attempt floor that bounds the statusline push-trigger.
 *
 * The trigger's entire safety claim is "it cannot raise the rate at which the rotator runs; it only
 * lets a beat happen sooner inside a window the timer would have used anyway." That claim is FALSE
 * unless two things hold, and each has a named way to get it wrong:
 *
 *   1. the floor is stamped on ATTEMPT, not on success — else a rotation that finds no healthy
 *      candidate (exactly the state a struggling fleet is in) advances nothing and the next attempt
 *      is unbounded. `state.last_switch_at` is the obvious-looking source and is wrong for this
 *      reason: `switchLiveTo` writes it only after a switch actually lands.
 *   2. the cell is shared across module instances — in FULL mode this module is loaded twice, so a
 *      module-level `let` gives the timer and the ingest route a floor each, i.e. double the rate,
 *      invisibly, because each instance's own accounting looks correct.
 *
 * NEUTERS RECORDED — MEASURED, each reverted after. See the tail of this file.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  TICK_ATTEMPT_FLOOR_MS,
  lastTickAttemptMs,
  runOneTick,
  stampTickAttempt,
  tickAttemptAllowed,
} from '@/lib/oauth-rotator/server-tick'

const CELL = Symbol.for('aimaestro.oauth-rotator.lastTickAttemptMs')
const T0 = 1_780_000_000_000

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CELL]
})

describe('the attempt floor', () => {
  it('allows the first attempt and blocks a second inside the window', () => {
    expect(tickAttemptAllowed(T0)).toBe(true) // nothing stamped yet
    stampTickAttempt(T0)
    expect(tickAttemptAllowed(T0 + 1)).toBe(false)
    expect(tickAttemptAllowed(T0 + TICK_ATTEMPT_FLOOR_MS - 1)).toBe(false)
    // Straddles the boundary in BOTH directions. Asserting only the block half would pass equally
    // against a floor that never opens — which would silently disable the trigger for good.
    expect(tickAttemptAllowed(T0 + TICK_ATTEMPT_FLOOR_MS)).toBe(true)
  })

  it('lives in the cross-realm symbol registry, not a module-level binding', () => {
    // The failure this pins is invisible from inside either module instance: each would see its own
    // floor behaving perfectly while the pair fired at double the rate. Reaching the cell through a
    // FRESHLY-resolved `Symbol.for` is the closest a single-realm test can get to proving the two
    // loaded copies address one cell — a module-local `let` is unreachable this way by definition.
    stampTickAttempt(T0)
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('aimaestro.oauth-rotator.lastTickAttemptMs')]).toBe(T0)
    // …and the reverse direction: a write through the registry is visible to the accessor.
    ;(globalThis as Record<symbol, unknown>)[CELL] = T0 + 5_000
    expect(lastTickAttemptMs()).toBe(T0 + 5_000)
  })

  it('treats a missing or non-numeric cell as "never attempted" rather than throwing', () => {
    expect(lastTickAttemptMs()).toBe(0)
    ;(globalThis as Record<symbol, unknown>)[CELL] = 'not-a-number'
    expect(lastTickAttemptMs()).toBe(0)
    ;(globalThis as Record<symbol, unknown>)[CELL] = NaN
    expect(lastTickAttemptMs()).toBe(0)
    expect(tickAttemptAllowed(T0)).toBe(true) // fail-OPEN: a corrupt cell must not wedge rotation
  })
})

describe('runOneTick stamps the floor', () => {
  it('stamps on ENTRY even when the R16 gate is off and no work is done', async () => {
    // THE test that separates "on attempt" from "on success". With the flag off, runOneTick returns
    // before doing anything at all — no lock, no tick, no switch. The floor must still advance,
    // because the trigger's rate bound has to hold for attempts that accomplish nothing. A stamp
    // placed after the gates, or derived from `state.last_switch_at`, leaves this at 0.
    expect(lastTickAttemptMs()).toBe(0)
    await runOneTick({ enabledCheck: () => false })
    expect(lastTickAttemptMs()).toBeGreaterThan(0)
    expect(tickAttemptAllowed()).toBe(false) // …and the floor is now closed to the trigger
  })

  it('stamps even when the beat runs and rotates nothing', async () => {
    // The other half of the same claim, one gate deeper: enabled + a live client, but the tick
    // reports no action. `switchLiveTo` never runs, so `state.last_switch_at` never moves — and the
    // floor still must.
    const runTickImpl = vi.fn(async () => ({ decision: 'no action needed', nextAction: 'ok' }))
    await runOneTick({
      enabledCheck: () => true,
      claudeRunningCheck: async () => true,
      runTickImpl,
      deliverImpl: () => {},
    })
    expect(runTickImpl).toHaveBeenCalledTimes(1)
    expect(lastTickAttemptMs()).toBeGreaterThan(0)
  })
})

/**
 * NEUTERS — MEASURED 2026-08-02, each reverted after. Counts are what the runs printed.
 *
 *   1. move `stampTickAttempt()` from before the gates to the end of the `try` block
 *      (i.e. "stamp on success") → REDS 1 of 5: "stamps on ENTRY even when the R16 gate is off and
 *      no work is done". The other four stay GREEN, which is the point: every test that merely
 *      exercises a WORKING rotation still passes, so this one test is the only thing standing
 *      between the design and a floor that evaporates on a struggling fleet.
 *   2. `Symbol.for(...)` → a module-level `let lastAttempt = 0`
 *      → REDS 2 of 5: "lives in the cross-realm symbol registry, not a module-level binding"
 *                     "treats a missing or non-numeric cell as 'never attempted'"
 *      (the second because the `beforeEach` delete no longer resets the module's own binding —
 *      itself a demonstration that a module-local floor is not externally observable).
 *   3. `>=` → `>` in `tickAttemptAllowed` → REDS 1 of 5: "allows the first attempt and blocks a
 *      second inside the window" — the exact-boundary assertion. Off-by-one at the boundary is the
 *      whole reason that fixture straddles it rather than testing one side.
 */
