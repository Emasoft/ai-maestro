/**
 * TRDD-9JUEJFY3 + TRDD-7YRXXKE8 — the pid-ancestry-to-pane identity walk must fail closed,
 * never fall back, and must match on (pid, start-time) PAIRS, never bare pids.
 *
 * `lib/identity-walk.ts::walkToPane` has no live caller yet (see that file's header — those
 * cards constrain the design before one is written). This suite pins the properties the cards
 * exist to guarantee:
 *
 *   TRDD-9JUEJFY3 — on a SEVERED chain (reparented to pid 1 before ever matching a known pane),
 *   the walk REFUSES — it does not silently resolve identity by any other means.
 *
 *   TRDD-7YRXXKE8 — a bare-pid match would let a RECYCLED pid resolve to a dead pane's
 *   identity. The race was demonstrated LIVE on macOS (a fork/wait hammer handed a dead
 *   child's pid to a new process with a later p_starttime), so the walk's match is pairwise:
 *   recorded (pid, starttime) must equal the CURRENT process's pair. This suite seeds a
 *   recycled-pid record (same pid, later start time) and asserts resolution REFUSES it.
 *
 * NON-VACUITY, VERIFIED BY NEUTER (per `~/.claude/rules/lessons-verification.md`): a test
 * asserting only `result.ok === false` would pass just as happily with a fallback bolted onto a
 * refusal branch that resolves SOME pane but returns `ok: false` alongside it, or with the
 * refusal reason silently downgraded — so this suite asserts the exact `reason` on every refusal
 * path, not merely truthiness. Verified by neuter for 9JUEJFY3: temporarily changed the
 * 'severed' return in `walkToPane` to `{ ok: true, panePid: pid, hops }` ("reached init, so just
 * claim the last pid we saw" — the exact forgeable-fallback shape the card forbids). Result: the
 * severed-chain test went red (expected `ok: false`, got `ok: true`), while the 'unreadable',
 * 'hop-limit' and positive-control tests stayed green (different branches), confirming the
 * assertion is specific to the severed path and not a tautology. Reverted immediately after.
 * The same neuter discipline applies to the recycled assertions below: they pin `reason:
 * 'recycled'` AND `ok: false`, so bolting a fallback onto the recycle branch reddens them.
 */
import { describe, it, expect } from 'vitest'
import { walkToPane, type WalkDeps } from '@/lib/identity-walk'
import { sameProcess, type ProcIdentity } from '@/lib/proc-identity'

/** Builds a linear ppid chain `chain[0] -> chain[1] -> ... -> chain[N-1] -> 1`. */
function linearChain(chain: number[], knownPanePid: number | null): WalkDeps {
  const parentOf = new Map<number, number>()
  for (let i = 0; i < chain.length - 1; i++) parentOf.set(chain[i], chain[i + 1])
  return {
    getParentPid: (pid) => parentOf.get(pid) ?? (chain.includes(pid) ? 1 : null),
    readRecordedPane: (pid) => (pid === knownPanePid ? { pid, startSeconds: 100, startMicroseconds: 0 } : null),
    // The simulated kernel: every pid exists with a FIXED start time (no reuse in-flight).
    readProcIdentity: (pid) => ({ pid, startSeconds: 100, startMicroseconds: 0 }),
  }
}

describe('identity-walk: walkToPane fails closed (TRDD-9JUEJFY3)', () => {
  it('resolves a pane when the chain reaches a recorded pane whose pair matches — POSITIVE CONTROL', () => {
    // 500 -> 400 -> 300(pane) -> 1, and 300 is a recorded pane with a matching start time.
    // Proves the walk can succeed at all, so the refusal tests below are refusals of a real
    // check, not of a walk that never matches.
    const deps = linearChain([500, 400, 300], 300)
    const result = walkToPane(500, deps)
    expect(result).toEqual({ ok: true, panePid: 300, hops: 2 })
  })

  it('a severed chain refuses, naming the reason, never resolving a pane', () => {
    // 700 -> 600 -> 1, and NEITHER 700 nor 600 nor 1 is a recorded pane. The intermediate that
    // once connected this pid to a real pane already died; the chain now dead-ends at init.
    const deps = linearChain([700, 600], 555 /* the real pane_pid, never reached */)
    const result = walkToPane(700, deps)
    expect(result.ok).toBe(false)
    expect(result).toEqual({ ok: false, reason: 'severed', hops: 2 })
  })

  it('a pid that vanishes mid-walk refuses as unreadable, not as a silent skip', () => {
    const deps: WalkDeps = {
      getParentPid: (pid) => (pid === 900 ? null : 1),
      readRecordedPane: () => null,
      readProcIdentity: () => null,
    }
    const result = walkToPane(900, deps)
    expect(result).toEqual({ ok: false, reason: 'unreadable', hops: 0 })
  })

  it('a forged/cyclical chain refuses at the hop limit rather than looping forever', () => {
    // 2 -> 3 -> 2 -> 3 -> ... : a pathological getParentPid that never reaches pid 1's REFUSAL
    // branch (it keeps answering "3") and never matches — must terminate, not hang.
    const deps: WalkDeps = {
      getParentPid: (pid) => (pid === 2 ? 3 : 2),
      readRecordedPane: () => null,
      readProcIdentity: () => null,
    }
    const result = walkToPane(2, deps, { maxHops: 5 })
    expect(result).toEqual({ ok: false, reason: 'hop-limit', hops: 5 })
  })

  it('never returns ok:true without the returned panePid carrying the recorded (pid, start-time) pair', () => {
    // A structural guard against a future edit accidentally decoupling the match from the
    // result: for every ok:true this function can produce, panePid must be a pid the deps
    // object itself records AND whose current identity equals the record.
    const deps = linearChain([10, 20, 30], 30)
    const result = walkToPane(10, deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const recorded = deps.readRecordedPane(result.panePid)
      const current = deps.readProcIdentity(result.panePid)
      expect(recorded).not.toBeNull()
      expect(current).not.toBeNull()
      expect(sameProcess(recorded!, current!)).toBe(true)
    }
  })
})

describe('identity-walk: pid reuse is refused at every hop (TRDD-7YRXXKE8)', () => {
  /**
   * The recycled-pid fixture: a pane record for pid P captured at start time S; the CURRENT
   * process at P started LATER (startSeconds 9000). This is the exact kernel state TRDD-
   * 7YRXXKE8 produced live on macOS: same pid, different lifetime.
   */
  function recycledChain(chain: number[], recordedPanePid: number): WalkDeps {
    const parentOf = new Map<number, number>()
    for (let i = 0; i < chain.length - 1; i++) parentOf.set(chain[i], chain[i + 1])
    return {
      getParentPid: (pid) => parentOf.get(pid) ?? (chain.includes(pid) ? 1 : null),
      readRecordedPane: (pid) =>
        pid === recordedPanePid ? { pid, startSeconds: 100, startMicroseconds: 0 } : null,
      readProcIdentity: (pid) => ({ pid, startSeconds: 9000, startMicroseconds: 500000 }),
    }
  }

  it('a recycled pid on record at the START of the walk refuses with reason "recycled"', () => {
    // Agent B's pane pid was recycled into agent A's tree: the walk from A's descendant
    // reaches the recorded pid, the pairwise compare fails, and resolution must REFUSE —
    // the old bare-pid walk would have resolved it to B's identity.
    const deps = recycledChain([500, 400, 300], 300)
    const result = walkToPane(500, deps)
    expect(result).toEqual({ ok: false, reason: 'recycled', hops: 2 })
  })

  it('a recycled pid found at an ANCESTOR hop refuses too — reuse is closed at every hop', () => {
    // The recorded pane sits UP the chain (pid 100), not at the start: the walk climbs
    // 500 -> 400 -> 300 -> 200 -> 100(recorded, recycled) and must refuse there. This is the
    // card's core claim: TRDD-EVO7T245's liveness argument covered the peer only.
    const deps = recycledChain([500, 400, 300, 200, 100], 100)
    const result = walkToPane(500, deps)
    expect(result).toEqual({ ok: false, reason: 'recycled', hops: 4 })
  })

  it('a recorded pane whose process EXITED entirely (pid unreadable) refuses as recycled, not resolves', () => {
    // The recorded pane pid no longer exists at all — the kernel read returns null. No
    // resolution, no walking past it.
    const deps: WalkDeps = {
      getParentPid: (pid) => (pid === 400 ? 300 : null),
      readRecordedPane: (pid) => (pid === 300 ? { pid, startSeconds: 100, startMicroseconds: 0 } : null),
      readProcIdentity: () => null,
    }
    const result = walkToPane(400, deps)
    expect(result).toEqual({ ok: false, reason: 'recycled', hops: 1 })
  })

  it('same pid with the SAME start time still matches — the pairwise rule never blocks a live pane', () => {
    // Positive control for the recycle tests: identical pair resolves. Guards against a
    // future edit that refuses EVERYTHING (turning the walk into a stub would pass the
    // refusal tests above while breaking the feature).
    const deps = linearChain([500, 400, 300], 300)
    const result = walkToPane(500, deps)
    expect(result).toEqual({ ok: true, panePid: 300, hops: 2 })
  })

  it('a start-time mismatch in MICROSECONDS alone refuses — the pair compare is exact', () => {
    // Two same-second forks differ in p_starttime microseconds; the compare must treat them
    // as different lifetimes (pid space is small enough that two forks share a second).
    const deps: WalkDeps = {
      getParentPid: (pid) => (pid === 400 ? 300 : null),
      readRecordedPane: (pid) => (pid === 300 ? { pid, startSeconds: 100, startMicroseconds: 0 } : null),
      readProcIdentity: (pid) => ({ pid, startSeconds: 100, startMicroseconds: 1 }),
    }
    const result = walkToPane(400, deps)
    expect(result).toEqual({ ok: false, reason: 'recycled', hops: 1 })
  })
})