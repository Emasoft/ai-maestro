/**
 * `stampChoreRun`'s central claim guard (redirect from the ORH oauth-parity review, superseding
 * the "stamp on every attempt" half of TRDD-14HI8ZPR / ai-maestro#111): a stamp for a chore the
 * server does not currently claim tells the janitor "still owned" for a chore it has disclaimed —
 * see `lib/janitor-chore-stamp.ts::stampChoreRun` and `registerChoreClaimPredicate`'s doc
 * comments for the full incident and why the wiring is a runtime registration, not a static
 * import of `lib/server-liveness.ts::isChoreClaimed`.
 *
 * 0-IMPACT: every test injects `deps.isClaimed` directly (the `stampChoreRun` test seam) so this
 * file never touches the real scheduler/flag state `isChoreClaimed` would otherwise read — no
 * real `currentCapabilities()` call happens here at all. `$JANITOR_CONTROL_DIR` is redirected
 * globally by `tests/setup/janitor-control-containment.ts` for every test file, so the stamp
 * writes below never touch the developer's real `~/.claude/janitor-control/`.
 */
import { describe, it, expect, vi } from 'vitest'
import { stampChoreRun, readChoreStamp } from '@/lib/janitor-chore-stamp'

describe('stampChoreRun — gated on the claim predicate (deps.isClaimed seam)', () => {
  it('writes nothing for a chore the predicate says is NOT claimed', () => {
    stampChoreRun('cache-prune', Date.now(), { isClaimed: () => false })
    expect(readChoreStamp('cache-prune')).toBeNull()
  })

  it('writes a stamp for a chore the predicate says IS claimed', () => {
    stampChoreRun('cache-prune', Date.now(), { isClaimed: () => true })
    expect(readChoreStamp('cache-prune')).not.toBeNull()
  })

  it('the predicate is consulted with the EXACT chore name being stamped', () => {
    // A guard that ignores its own argument (e.g. hardcoded true/false, or checks the wrong
    // chore) would still pass the two tests above by accident — this pins that it discriminates.
    const seen: string[] = []
    stampChoreRun('github-config-audit', Date.now(), {
      isClaimed: (chore) => { seen.push(chore); return chore === 'github-config-audit' },
    })
    expect(seen).toEqual(['github-config-audit'])
    expect(readChoreStamp('github-config-audit')).not.toBeNull()
  })

  it('a THROWING predicate never crashes the caller — stamping stays best-effort', () => {
    // `stampChoreRun`'s whole contract is "never throws" (a telemetry write must not be able to
    // fail the chore it reports on); the guard must inherit that, not add a new way to break it.
    expect(() => {
      stampChoreRun('fleet-plugins-update', Date.now(), {
        isClaimed: () => { throw new Error('predicate exploded') },
      })
    }).not.toThrow()
    expect(readChoreStamp('fleet-plugins-update')).toBeNull()
  })

  it('with NO predicate registered and none injected, fails CLOSED (writes nothing) and warns exactly once across two calls', () => {
    // registerChoreClaimPredicate is never called in this file's isolated module graph (vitest
    // gives each test file its own module registry by default), so the module-level predicate
    // stays null here — the same shape a `.next`-bundled module instance is in at runtime, which
    // is the exact starvation this reversal closes (see stampChoreRun's doc comment).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      stampChoreRun('cold-cache-clear', Date.now())
      stampChoreRun('cold-cache-clear', Date.now())
      expect(readChoreStamp('cold-cache-clear')).toBeNull()
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })
})
