/**
 * The 3-pillars conformance SPEC (rules/aimaestro/3-pillars-spec.md, ai-maestro#85)
 * is the ARBITER of the 17-column kanban vocabulary. That vocabulary is duplicated
 * across at least five artefacts (the spec, types/task.ts, types/team.ts,
 * GOVERNANCE-RULES R25, the janitor IND rule) with no shared source — exactly the
 * drift surface the spec exists to close.
 *
 * This test is ai-maestro's CODE-side conformance check (TRDD-QP07O1BK): it extracts
 * the spec's authoritative column block verbatim and asserts types/task.ts conforms.
 * The spec is the source; the code is checked against it. If someone edits one column
 * name in either place without the other, CI fails here — the "two agents disagree on
 * a column name" drift becomes a red test instead of a months-later surprise.
 *
 * It reads the block from the spec (not a hand-copied list) so this test cannot itself
 * become a sixth drifting copy.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_STATUSES } from '@/types/task'

const SPEC_PATH = join(process.cwd(), 'rules', 'aimaestro', '3-pillars-spec.md')

/**
 * Extract the authoritative column list the spec marks with
 * `<!-- @spec:kanban-columns … -->` followed immediately by a fenced ```text block.
 * Returns the fenced lines, trimmed, in order.
 */
function specKanbanColumns(): string[] {
  const md = readFileSync(SPEC_PATH, 'utf-8')
  const marker = md.indexOf('@spec:kanban-columns')
  if (marker === -1) throw new Error('spec is missing the @spec:kanban-columns marker')
  const fenceOpen = md.indexOf('```', marker)
  if (fenceOpen === -1) throw new Error('spec column marker is not followed by a code fence')
  const bodyStart = md.indexOf('\n', fenceOpen) + 1
  const fenceClose = md.indexOf('```', bodyStart)
  if (fenceClose === -1) throw new Error('spec column code fence is not closed')
  return md
    .slice(bodyStart, fenceClose)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

describe('3-pillars SPEC conformance — kanban vocabulary (ai-maestro#85)', () => {
  it('the spec pins exactly 17 columns, no duplicates', () => {
    const cols = specKanbanColumns()
    expect(cols).toHaveLength(17)
    expect(new Set(cols).size).toBe(17)
  })

  it('types/task.ts DEFAULT_STATUSES conforms to the spec verbatim (order + spelling)', () => {
    // The spec is the arbiter (rules/aimaestro/3-pillars-spec.md); the code conforms.
    // Deep-equal, so a reorder or a rename in either place fails here.
    expect(DEFAULT_STATUSES).toEqual(specKanbanColumns())
  })

  it('the spec carries a semver spec-version stamp (mismatch is detectable)', () => {
    const md = readFileSync(SPEC_PATH, 'utf-8')
    expect(md).toMatch(/^spec-version:\s*\d+\.\d+\.\d+\s*$/m)
  })
})
