// TRDD-IIXYIU7G — the always-loaded lessons file rides every turn of every session, so its
// size is a per-turn tax. Two limits, both mechanical: a byte ceiling on the core file, and a
// per-entry length cap that routes long lessons to the on-demand reference instead of deleting
// them. Neuter: raise CEILING to 1e9 or ENTRY_MAX to 1e9 → the corresponding test must stop
// discriminating; lower either below the measured value → red.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CORE = '.claude/rules/lessons-verification.md'
const REF = '.claude/rules-reference/lessons-verification-full.md'
const CEILING = 96 * 1024
const ENTRY_MAX = 500

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

  it('the full reference exists and holds only long entries (positive control that the split is real)', () => {
    const es = entries(ref)
    expect(es.length).toBeGreaterThan(100)
    expect(es.every((e) => e.length > ENTRY_MAX)).toBe(true)
  })
})
