/**
 * TRDD-IMCEYV9F — the orphaned-pillar-index classifier.
 *
 * FIXTURE-DRIVEN. Asserting "this host has N orphans" would pass or fail depending on when
 * anyone last ran a suite; the live scan belongs to `yarn pillar:reap`, the LOGIC is pinned
 * here so the verdict is the same on every machine.
 *
 * The load-bearing case is `unreadable`, not `orphan`. `[].every(gone)` is `true`, so a
 * two-state classifier deletes any index it FAILED TO READ — the lenient-reader failure, with
 * a delete on the end of it.
 *
 * NEUTER RUNS (2026-08-22 — all OBSERVED via scripts/dev/neuter, each restore verified by blob
 * hash). Three, because the classifier has three independent branches and one mutation can only
 * certify the branch it hits:
 *
 *   s/targets\.some\(/targets.every(/                                        → 1 red / 8 green
 *       ONE surviving target is enough — a partly-deleted corpus is not an orphan
 *
 *   s/if \(row\.targets\.length === 0\) return \{ \.\.\.row, state: 'empty' \}//   → 1 red / 8 green
 *       EMPTY is a distinct state from UNREADABLE, and the report says which
 *
 *   s/if \(row\.readFailed\) return \{ \.\.\.row, state: 'unreadable' \}//         → 2 red / 7 green
 *       EMPTY is a distinct state from UNREADABLE, and the report says which
 *       THE SAFETY PROPERTY — an index whose read THREW is never an orphan
 *
 * The third reddens TWO by design: dropping the `readFailed` branch makes a thrown read fall
 * through to `empty`, so both the safety test and the states-are-distinct test notice. That it
 * still does NOT become an orphan is the point — the fail-closed property survives the
 * mutation, and what breaks is the report's honesty about WHY the file was kept.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyIndexes,
  reapExitCode,
  formatReapReport,
  type IndexRow,
} from '@/lib/pillar/index-orphans'

const LIVE = '/Users/x/ai-maestro/design/archived/TRDD-real.md'
const GONE = '/var/folders/j5/T/pillar-graph-jMI1nR/tasks/TRDD-fixture.md'

/** Only LIVE exists. */
const exists = (p: string): boolean => p === LIVE

const row = (
  file: string,
  targets: string[],
  bytes = 1_048_576,
  readFailed = false,
): IndexRow => ({ file, targets, readFailed, bytes })

describe('classifyIndexes', () => {
  it('an index whose every target is gone is an ORPHAN', () => {
    const r = classifyIndexes([row('t-abc.sqlite', [GONE, GONE])], exists)
    expect(r.orphans.map((o) => o.file)).toEqual(['t-abc.sqlite'])
    expect(reapExitCode(r)).toBe(1)
  })

  it('an index with a surviving target is LIVE and is never reaped', () => {
    const r = classifyIndexes([row('ai-maestro.sqlite', [LIVE])], exists)
    expect(r.orphans).toHaveLength(0)
    expect(r.liveCount).toBe(1)
    expect(reapExitCode(r)).toBe(0)
  })

  it('ONE surviving target is enough — a partly-deleted corpus is not an orphan', () => {
    // A corpus mid-edit has deleted files. Reaping on "any target missing" would destroy the
    // index of a live repo the moment someone removed a single card.
    const r = classifyIndexes([row('ai-maestro.sqlite', [GONE, LIVE, GONE])], exists)
    expect(r.orphans).toHaveLength(0)
    expect(r.liveCount).toBe(1)
  })

  it('THE SAFETY PROPERTY — an index whose read THREW is never an orphan', () => {
    // Neuter: classify an empty target list as an orphan (drop the length-0 branch, or switch
    // `.some()` to `.every()`), and this reds while the cases above stay green. `[].every(...)`
    // is true, so the file would be deleted BECAUSE we could not read it.
    const r = classifyIndexes([row('corrupt.sqlite', [], 1_048_576, true)], exists)
    expect(r.orphans).toHaveLength(0)
    expect(r.unreadableCount).toBe(1)
    expect(r.rows[0].state).toBe('unreadable')
    expect(reapExitCode(r)).toBe(0)
    expect(formatReapReport(r)).toMatch(/UNREADABLE .*THREW/)
  })

  it('EMPTY is a distinct state from UNREADABLE, and the report says which', () => {
    // Both are kept, so no verdict depends on this — which is exactly why the first draft got
    // it wrong and nothing caught it. It was WRONG about 26 of 102 real files: they open fine
    // and hold zero rows, and were reported as "could not read". A report that misnames the
    // fault sends the next reader at a bug that does not exist.
    const r = classifyIndexes(
      [row('threw.sqlite', [], 1_048_576, true), row('opens-fine.sqlite', [], 1_048_576, false)],
      exists,
    )
    expect(r.unreadableCount).toBe(1)
    expect(r.emptyCount).toBe(1)
    expect(r.orphans).toHaveLength(0)
    const out = formatReapReport(r)
    expect(out).toMatch(/UNREADABLE threw\.sqlite .*THREW/)
    expect(out).toMatch(/EMPTY\s+opens-fine\.sqlite .*records no paths/)
  })

  it('AN EMPTY SCAN IS EXIT 2, NEVER A CLEAN 0', () => {
    // Keyed on INPUT CONSUMED. A guard written over FINDINGS fires on success: clearing the
    // last orphan would move the exit 1 -> 2 and "exits 0 once clean" could never be met.
    const r = classifyIndexes([], exists)
    expect(r.scanned).toBe(0)
    expect(reapExitCode(r)).toBe(2)
    expect(formatReapReport(r)).toMatch(/COULD NOT RUN/)
  })

  it('a fully-scanned, fully-live directory is exit 0 — the clean case is reachable', () => {
    // The complement of the test above: proves 2 is about "could not look", not about "found
    // nothing", so a correct system can actually reach 0.
    const r = classifyIndexes([row('a.sqlite', [LIVE]), row('b.sqlite', [LIVE])], exists)
    expect(r.scanned).toBe(2)
    expect(reapExitCode(r)).toBe(0)
  })

  it('reclaimable bytes count ORPHANS ONLY, never the whole directory', () => {
    const r = classifyIndexes(
      [row('gone.sqlite', [GONE], 5_242_880), row('keep.sqlite', [LIVE], 99_999_999)],
      exists,
    )
    expect(r.reclaimableBytes).toBe(5_242_880)
    expect(formatReapReport(r)).toMatch(/5\.0 MB reclaimable/)
  })

  it('the report names each orphan, so the failure is actionable rather than a count', () => {
    const r = classifyIndexes([row('t-abc.sqlite', [GONE])], exists)
    const out = formatReapReport(r)
    expect(out).toMatch(/ORPHAN\s+t-abc\.sqlite/)
    // Report-only is the contract, so the remediation must be stated and not performed.
    expect(out).toMatch(/--reap/)
  })
})
