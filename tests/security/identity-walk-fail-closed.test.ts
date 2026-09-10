/**
 * TRDD-9JUEJFY3 — the pid-ancestry-to-pane identity walk must fail closed, never fall back.
 *
 * `lib/identity-walk.ts::walkToPane` has no live caller yet (see that file's header — this card
 * constrains the design before one is written). This suite pins the one property the card exists
 * to guarantee: on a SEVERED chain (reparented to pid 1 before ever matching a known pane), the
 * walk REFUSES — it does not silently resolve identity by any other means.
 *
 * NON-VACUITY, VERIFIED BY NEUTER (per `~/.claude/rules/lessons-verification.md`): a test
 * asserting only `result.ok === false` would pass just as happily with a fallback bolted onto the
 * 'severed' branch that resolves SOME pane but returns `ok: false` alongside it, or with the
 * refusal reason silently downgraded — so this suite asserts the exact `reason` on every refusal
 * path, not merely truthiness. Verified by neuter: temporarily changed the 'severed' return in
 * `walkToPane` from `{ ok: false, reason: 'severed', hops }` to
 * `{ ok: true, panePid: pid, hops }` (i.e. "reached init, so just claim the last pid we saw is the
 * pane" — the exact forgeable-fallback shape the card forbids). Result: 'a severed chain refuses,
 * naming the reason, never resolving a pane' went red (expected `ok: false`, got `ok: true`), the
 * 'unreadable' and 'hop-limit' refusal tests and the successful-match positive control stayed
 * green (they exercise different branches), confirming the assertion is specific to the severed
 * path and not a tautology. Reverted immediately after.
 */
import { describe, it, expect } from 'vitest'
import { walkToPane, type WalkDeps } from '@/lib/identity-walk'

/** Builds a linear ppid chain `chain[0] -> chain[1] -> ... -> chain[N-1] -> 1`. */
function linearChain(chain: number[], knownPanePid: number | null): WalkDeps {
  const parentOf = new Map<number, number>()
  for (let i = 0; i < chain.length - 1; i++) parentOf.set(chain[i], chain[i + 1])
  return {
    getParentPid: (pid) => parentOf.get(pid) ?? (chain.includes(pid) ? 1 : null),
    isKnownPanePid: (pid) => pid === knownPanePid,
  }
}

describe('identity-walk: walkToPane fails closed (TRDD-9JUEJFY3)', () => {
  it('resolves a pane when the chain reaches a known pane_pid — POSITIVE CONTROL', () => {
    // 500 -> 400 -> 300(pane) -> 1, and 300 is a known pane. Proves the walk can succeed at all,
    // so the refusal tests below are refusals of a real check, not of a walk that never matches.
    const deps = linearChain([500, 400, 300], 300)
    const result = walkToPane(500, deps)
    expect(result).toEqual({ ok: true, panePid: 300, hops: 2 })
  })

  it('a severed chain refuses, naming the reason, never resolving a pane', () => {
    // 700 -> 600 -> 1, and NEITHER 700 nor 600 nor 1 is a known pane. The intermediate that once
    // connected this pid to a real pane already died; the chain now dead-ends at init.
    const deps = linearChain([700, 600], 555 /* the real pane_pid, never reached */)
    const result = walkToPane(700, deps)
    expect(result.ok).toBe(false)
    expect(result).toEqual({ ok: false, reason: 'severed', hops: 2 })
  })

  it('a pid that vanishes mid-walk refuses as unreadable, not as a silent skip', () => {
    const deps: WalkDeps = {
      getParentPid: (pid) => (pid === 900 ? null : 1),
      isKnownPanePid: () => false,
    }
    const result = walkToPane(900, deps)
    expect(result).toEqual({ ok: false, reason: 'unreadable', hops: 0 })
  })

  it('a forged/cyclical chain refuses at the hop limit rather than looping forever', () => {
    // 1 -> 2 -> 1 -> 2 -> ... : a pathological getParentPid that never reaches pid 1's REFUSAL
    // branch (it keeps answering "2") and never matches — must terminate, not hang.
    const deps: WalkDeps = {
      getParentPid: (pid) => (pid === 2 ? 3 : 2),
      isKnownPanePid: () => false,
    }
    const result = walkToPane(2, deps, { maxHops: 5 })
    expect(result).toEqual({ ok: false, reason: 'hop-limit', hops: 5 })
  })

  it('never returns ok:true without isKnownPanePid having matched the returned panePid', () => {
    // A structural guard against a future edit accidentally decoupling the match from the
    // result: for every ok:true this function can produce, panePid must be a pid the deps
    // object itself calls "known".
    const deps = linearChain([10, 20, 30], 30)
    const result = walkToPane(10, deps)
    expect(result.ok).toBe(true)
    if (result.ok) expect(deps.isKnownPanePid(result.panePid)).toBe(true)
  })
})
