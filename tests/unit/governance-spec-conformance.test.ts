/**
 * The governance conformance SPEC (design/specs/governance-spec.md) captures
 * docs/GOVERNANCE-RULES.md v4.5.0 and pins the machine-checkable surfaces the rules
 * are duplicated across (the R6 comm graph — spec + lib/communication-graph.ts + 8
 * role-plugin personas; the title→plugin map; the 8 governance titles). Those are the
 * classic drift surfaces the spec exists to close.
 *
 * This is ai-maestro's CODE-side conformance check (TRDD-R8LJJDBQ): it extracts each
 * `<!-- @spec:… -->` block VERBATIM from the spec and asserts the live code conforms.
 * The spec is the source; the code is checked against it. Edit one cell of the comm
 * graph, or one title→plugin entry, in either place without the other → CI fails here,
 * turning "two agents disagree on who may message whom" into a red test instead of a
 * months-later surprise.
 *
 * It reads every block FROM the spec (never a hand-copied list) so this test cannot
 * itself become another drifting copy.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getEdgeType, type GraphNode, type EdgeType } from '@/lib/communication-graph'
import { TITLE_PLUGIN_MAP } from '@/lib/ecosystem-constants'
import { VALID_GOVERNANCE_TITLES } from '@/types/agent'

const SPEC_PATH = join(process.cwd(), 'design', 'specs', 'governance-spec.md')
const spec = readFileSync(SPEC_PATH, 'utf-8')

/**
 * Extract the fenced ```text block that immediately follows an
 * `<!-- @spec:<name> … -->` marker. Anchors on the HTML-comment marker (the `<!-- `
 * prefix), NOT the bare `@spec:<name>` token — that token also appears as a grep
 * example in the GOV-GREP cheat-sheet, so keying on it there would extract the wrong
 * fence. The `<!-- ` prefix makes the real marker occur exactly once.
 */
function fencedBlock(name: string): string[] {
  const marker = spec.indexOf(`<!-- @spec:${name}`)
  if (marker === -1) throw new Error(`spec is missing the <!-- @spec:${name} --> marker`)
  const fenceOpen = spec.indexOf('```', marker)
  if (fenceOpen === -1) throw new Error(`@spec:${name} marker is not followed by a code fence`)
  const bodyStart = spec.indexOf('\n', fenceOpen) + 1
  const fenceClose = spec.indexOf('```', bodyStart)
  if (fenceClose === -1) throw new Error(`@spec:${name} code fence is not closed`)
  return spec
    .slice(bodyStart, fenceClose)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0)
}

/** Spec matrix labels → the code's lowercase-kebab GraphNode values. */
const LABEL_TO_NODE: Record<string, GraphNode> = {
  HUMAN: 'human',
  MANAGER: 'manager',
  COS: 'chief-of-staff',
  'CHIEF-OF-STAFF': 'chief-of-staff',
  ORCHESTRATOR: 'orchestrator',
  ARCHITECT: 'architect',
  INTEGRATOR: 'integrator',
  MEMBER: 'member',
  MAINTAINER: 'maintainer',
  AUTONOMOUS: 'autonomous',
}

/** Spec cell glyph → the code's EdgeType. */
const CELL_TO_EDGE: Record<string, EdgeType> = { Y: 'allow', '1': 'reply-only', '.': 'deny' }

describe('governance-spec.md @spec:comm-graph == lib/communication-graph.ts', () => {
  // Parse the matrix: first line is the header (corner label + column labels),
  // each subsequent line is `<sender> <cell> <cell> …`.
  const rows = fencedBlock('comm-graph')
  const header = rows[0].split(/\s+/)
  const colLabels = header.slice(1) // drop the "sender\recipient" corner token
  const bodyRows = rows.slice(1)

  it('the matrix is a full 9×9 (HUMAN + 8 roles)', () => {
    expect(colLabels).toHaveLength(9)
    expect(bodyRows).toHaveLength(9)
  })

  for (const row of bodyRows) {
    const cells = row.split(/\s+/)
    const senderLabel = cells[0]
    const senderNode = LABEL_TO_NODE[senderLabel]
    const glyphs = cells.slice(1)

    it(`row ${senderLabel} matches getEdgeType() for every recipient`, () => {
      expect(senderNode, `unknown sender label ${senderLabel}`).toBeDefined()
      expect(glyphs).toHaveLength(colLabels.length)
      for (let i = 0; i < colLabels.length; i++) {
        const recipientNode = LABEL_TO_NODE[colLabels[i]]
        const expectedEdge = CELL_TO_EDGE[glyphs[i]]
        expect(recipientNode, `unknown recipient label ${colLabels[i]}`).toBeDefined()
        expect(expectedEdge, `unknown cell glyph "${glyphs[i]}" at ${senderLabel}→${colLabels[i]}`).toBeDefined()
        expect(
          getEdgeType(senderNode, recipientNode),
          `${senderLabel}(${senderNode}) → ${colLabels[i]}(${recipientNode})`,
        ).toBe(expectedEdge)
      }
    })
  }
})

describe('governance-spec.md @spec:title-plugin-map == lib/ecosystem-constants.ts TITLE_PLUGIN_MAP', () => {
  it('the spec block matches the code map key-for-key and value-for-value', () => {
    const specMap: Record<string, string> = {}
    for (const line of fencedBlock('title-plugin-map')) {
      const [title, plugin] = line.split(/\s+/)
      specMap[title] = plugin
    }
    expect(specMap).toEqual(TITLE_PLUGIN_MAP)
  })
})

describe('governance-spec.md @spec:titles == R3.1 eight; code carries a known 9th (assistant)', () => {
  // The spec's @spec:titles faithfully mirrors GOVERNANCE-RULES R3.1's EIGHT governance
  // titles. The CODE (types/agent.ts VALID_GOVERNANCE_TITLES) has moved ahead to NINE — it
  // implements R39's `assistant` before R3.1/R6 were updated to enumerate it (TITLES-03).
  // So we do NOT assert strict equality; we assert (a) every R3.1 title is a real code role,
  // and (b) the code's extra role is EXACTLY {assistant} — a new undocumented role fails red,
  // which is the drift-catch the whole test exists for.
  const specTitles = fencedBlock('titles').map((l) => l.split(/\s+/)[0])
  const codeRoles = new Set<string>(VALID_GOVERNANCE_TITLES)

  it('the spec block holds R3.1 eight titles', () => {
    expect(specTitles).toHaveLength(8)
  })

  it('every spec title is a real governance title in the code', () => {
    for (const t of specTitles) expect(codeRoles.has(t), `${t} missing from VALID_GOVERNANCE_TITLES`).toBe(true)
  })

  it('the code carries exactly one extra role beyond the spec eight: assistant (R39, TITLES-03)', () => {
    const extra = [...codeRoles].filter((r) => !specTitles.includes(r))
    expect(extra).toEqual(['assistant'])
  })
})
