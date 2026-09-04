// TRDD-IIXYIU7G — the always-loaded lessons file rides every turn of every session, so its
// size is a per-turn tax. Two limits, both mechanical: a byte ceiling on the core file, and a
// per-entry length cap that routes long lessons to the on-demand reference instead of deleting
// them. Neuter: raise CEILING to 1e9 or ENTRY_MAX to 1e9 → the corresponding test must stop
// discriminating; lower either below the measured value → red.
//
// TRDD-NNNR4IYL — an entry now reaches the reference by EITHER trigger: it outgrew ENTRY_MAX,
// or the core file hit CEILING and the entry was relocated to make room. Case 3 asserted the
// first trigger's world (`every(e => e.length > ENTRY_MAX)`) because it was the only one, which
// made the system DEADLOCKED by construction: a core file at its ceiling with no over-length
// entry had no legal relief. A relocated short entry must therefore carry RELOCATION_MARKER, so
// the reference still cannot become a dumping ground — that is what case 3 protects, and it is
// why the fix is a marker rather than dropping the length check. Neuter for case 3: delete the
// marker from any relocated entry, or drop the `!e.includes(RELOCATION_MARKER)` clause so any
// unmarked short entry is admitted → must go red.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CORE = '.claude/rules/lessons-verification.md'
const REF = '.claude/rules-reference/lessons-verification-full.md'
const CEILING = 96 * 1024
const ENTRY_MAX = 500
// ANCHORED to end-of-line, deliberately. A bare `entry.includes(MARKER)` scans the whole
// multi-line entry, so a FUTURE lesson that merely quotes this marker while explaining the
// mechanism would excuse itself — and this corpus is full of lessons that quote the machinery
// they describe. End-of-any-line admits a real marker (including on a multi-line entry, where
// it sits on the entry's first line) and rejects a mid-sentence mention.
// One source for the string: the regex is BUILT from it, so the two cannot drift apart.
const RELOCATION_MARKER = '<!-- moved-for-file-cap -->'
const RELOCATED = new RegExp(`${RELOCATION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm')

function entries(text: string): string[] {
  const out: string[] = []
  let cur: string | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) { if (cur) out.push(cur); cur = null; continue }
    if (line.startsWith('- ')) { if (cur) out.push(cur); cur = line }
    else if (cur !== null) cur += '\n' + line
  }
  if (cur) out.push(cur)
  return out
}

describe('lessons-verification.md budget (TRDD-IIXYIU7G)', () => {
  const core = readFileSync(CORE, 'utf8')
  const ref = readFileSync(REF, 'utf8')

  it(`core file stays under ${CEILING} bytes`, () => {
    expect(Buffer.byteLength(core)).toBeLessThanOrEqual(CEILING)
  })

  it(`no core entry exceeds ${ENTRY_MAX} chars — longer lessons belong in the full reference`, () => {
    const long = entries(core).filter((e) => e.length > ENTRY_MAX)
    expect(long.map((e) => e.slice(0, 80))).toEqual([])
  })

  it('the full reference holds only entries that EARNED a place there — over-length, or explicitly relocated for the file cap (positive control that the split is real)', () => {
    const es = entries(ref)
    expect(es.length).toBeGreaterThan(100)
    // Naming the offenders rather than asserting a bare boolean: `every(...)` reports only
    // `false` and leaves the reader grepping a 196 KB file for which entry broke it.
    const unearned = es.filter((e) => e.length <= ENTRY_MAX && !RELOCATED.test(e))
    expect(unearned.map((e) => e.slice(0, 80))).toEqual([])
  })
})
