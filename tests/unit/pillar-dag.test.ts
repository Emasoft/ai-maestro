/**
 * TRDD-LXLK7XGX — the cross-pillar DAG lint (Phase 4 of TRDD-L55IYKL4).
 *
 * The card's three boxes map to the three describe blocks below:
 *   1. the input is the DEPENDENCY-FIELD ALLOWLIST, not "frontmatter"
 *   2. zero findings on the LIVE corpus (with non-vacuity, or the zero is worthless)
 *   3. a SEEDED frontmatter violation still FAILS
 *
 * Fixtures are temp dirs; the live-corpus block is read-only. Nothing writes into
 * `design/`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  lintDag,
  edgesOfDocument,
  idsInDependencyValue,
  isLegalEdge,
  DEPENDENCY_FIELDS,
  DEPENDENCY_FIELD_TARGETS,
} from '@/lib/pillar/dag'
import type { PillarDocument } from '@/lib/pillar/store'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-dag-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

/** A spec corpus at <tmp>/specs with one file. */
function writeSpec(name: string, frontmatter: string, body = '\n`3P-XXX-01` **clause** — text.\n') {
  const dir = path.join(tmp, 'specs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), `---\n${frontmatter}\n---\n${body}`)
  return dir
}

function doc(kind: PillarDocument['kind'], frontmatter: Record<string, unknown>): PillarDocument {
  return { kind, zone: '', filePath: `/fake/${kind}.md`, frontmatter, body: '' }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('box 1 — the input is the dependency-field allowlist, not "frontmatter"', () => {
  it('pins the exact allowlist and each field\'s target pillar', () => {
    // The allowlist IS the card's decision. If someone widens it, that is a design
    // change and it should require editing this assertion.
    expect(DEPENDENCY_FIELDS.slice().sort()).toEqual(
      ['blocked-by', 'eht', 'npt', 'parent-trdd', 'relevant-rules', 'superseded-by'],
    )
    expect(DEPENDENCY_FIELD_TARGETS['relevant-rules']).toBe('prrd')
    expect(DEPENDENCY_FIELD_TARGETS['blocked-by']).toBe('trdd')
  })

  it('ignores a TRDD id in a PROSE-VALUED frontmatter field (the 3 cases "frontmatter" scoping flags)', () => {
    // all-in-one-spec.md's `implementations:` and governance-spec.md's `authority:`
    // are prose sentences that happen to be quoted YAML. The naive "read frontmatter,
    // never bodies" narrowing flags these — trading 18 false positives for 3.
    const d = doc('spec', {
      implementations: ['the 26 pipelines — services/element-management-service.ts (retrofit tracked in TRDD-DQ6XN2VP)'],
      authority: 'Specs come before the implementation (USER, 2026-07-22, TRDD-CJWC3JLU).',
      spec: '3-pillars',
      status: 'ratified',
    })
    expect(edgesOfDocument(d)).toEqual([])
  })

  it('ignores a TRDD id in the BODY (the 18 provenance mentions)', () => {
    const root = writeSpec(
      'prov-spec.md',
      'spec: prov\nstatus: ratified',
      '\n`3P-XXX-01` **clause** — conformance-tested against TRDD-QP07O1BK and TRDD-DQ6XN2VP.\n',
    )
    const r = lintDag({ spec: root })
    expect(r.scanned).toBe(1)
    expect(r.findings).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the extractor — citationRe would silently find NOTHING here', () => {
  // The live corpus writes these fields BOTH ways, plus lowercase v1 ids and bare
  // numbers. A citationRe-based extractor (it requires the `TRDD-`/`PRRD ` prefix)
  // yields no ids, hence no edges, hence a "clean" report from a lint that saw
  // nothing — the exact failure this suite exists to prevent. normalizeId absorbs
  // prefix and case, so both forms land on one canonical id.
  it('accepts the bare form, the prefixed form, and mixed case as the same id', () => {
    expect(idsInDependencyValue(['Y916N7WL'], 'trdd')).toEqual(['Y916N7WL'])
    expect(idsInDependencyValue(['TRDD-K2WJH7RF'], 'trdd')).toEqual(['K2WJH7RF'])
    expect(idsInDependencyValue(['TRDD-a1019073'], 'trdd')).toEqual(['A1019073'])
  })

  it('accepts a YAML NUMBER (relevant-rules: [25] parses as a number, not a string)', () => {
    expect(idsInDependencyValue([25], 'prrd')).toEqual(['25'])
    expect(idsInDependencyValue([16, 23, 42], 'prrd')).toEqual(['16', '23', '42'])
  })

  it('treats null / [] / absent as NO edge (parent-trdd: null appears 96 times)', () => {
    expect(idsInDependencyValue(null, 'trdd')).toEqual([])
    expect(idsInDependencyValue([], 'trdd')).toEqual([])
    expect(idsInDependencyValue(undefined, 'trdd')).toEqual([])
    expect(edgesOfDocument(doc('trdd', { 'parent-trdd': null }))).toEqual([])
  })

  it('splits an UNBRACKETED comma list, so YAML shape does not change the answer', () => {
    expect(idsInDependencyValue('TRDD-AAAAAAAA, BBBBBBBB', 'trdd')).toEqual(['AAAAAAAA', 'BBBBBBBB'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the direction matrix', () => {
  it('allows only upward and lateral edges', () => {
    expect(isLegalEdge('trdd', 'trdd')).toBe(true)
    expect(isLegalEdge('trdd', 'spec')).toBe(true)
    expect(isLegalEdge('trdd', 'prrd')).toBe(true)
    expect(isLegalEdge('spec', 'prrd')).toBe(true)
    expect(isLegalEdge('spec', 'spec')).toBe(true)
    // The two the USER's table marks NO.
    expect(isLegalEdge('spec', 'trdd')).toBe(false)
    expect(isLegalEdge('prrd', 'trdd')).toBe(false)
    expect(isLegalEdge('prrd', 'spec')).toBe(false)
    expect(isLegalEdge('prrd', 'prrd')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('box 3 — a seeded frontmatter violation still FAILS', () => {
  it('flags a spec whose frontmatter declares a DEPENDENCY on a TRDD', () => {
    // The mutation proof. Everything about this file is legal except one field name:
    // `blocked-by` instead of `implementations`. That single character-level change is
    // the whole difference between provenance and a machine-read edge.
    const root = writeSpec('bad-spec.md', 'spec: bad\nstatus: draft\nblocked-by: [TRDD-DQ6XN2VP]')
    const r = lintDag({ spec: root })

    expect(r.scanned).toBe(1) // non-vacuity: it really read the file
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0]).toMatchObject({
      rule: 'dag-illegal-edge',
      source: 'spec',
      target: 'trdd',
      field: 'blocked-by',
      targetId: 'DQ6XN2VP',
    })
    expect(r.findings[0].detail).toContain('point only UP the stack')
  })

  it('flags the bare-id form too — a violation must not hide behind the prefix', () => {
    const root = writeSpec('bad2-spec.md', 'spec: bad2\nstatus: draft\nnpt: [DQ6XN2VP, VYQ8N4KR]')
    const r = lintDag({ spec: root })
    expect(r.findings.map(f => f.targetId).sort()).toEqual(['DQ6XN2VP', 'VYQ8N4KR'])
  })

  it('does NOT flag the same file once the field is renamed to a descriptive one', () => {
    // The paired control: same id, same file, legal field ⇒ no finding. Without this,
    // the test above could be passing because the file is malformed in some other way.
    const root = writeSpec('ok-spec.md', 'spec: ok\nstatus: draft\nimplementations: [TRDD-DQ6XN2VP]')
    expect(lintDag({ spec: root }).findings).toEqual([])
  })

  it('refuses to certify a corpus it never read (scanned 0 is not "clean")', () => {
    const empty = path.join(tmp, 'specs-empty')
    fs.mkdirSync(empty, { recursive: true })
    const r = lintDag({ spec: empty })
    expect(r.scanned).toBe(0)
    expect(r.findings).toEqual([])
    // The TOOL turns this into exit 2; the report's job is to make it visible.
  })

  it('THROWS on a present-but-unreadable root, rather than reporting clean', () => {
    const notADir = path.join(tmp, 'specs-file')
    fs.writeFileSync(notADir, 'I am a file, not a directory')
    expect(() => lintDag({ spec: notADir })).toThrow(/not a directory/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('box 2 — zero findings on the LIVE corpus', () => {
  const designDir = path.join(process.cwd(), 'design')

  it('holds the DAG across the real TRDD + spec corpora', () => {
    const r = lintDag({ trdd: designDir, spec: path.join(designDir, 'specs') })

    // NON-VACUITY FIRST. A zero-findings assertion on a corpus that was not read is
    // the "green audit that covered nothing" trap; the count is what separates
    // "clean" from "looked at nothing".
    expect(r.scanned).toBeGreaterThan(300)
    expect(r.perPillar.trdd).toBeGreaterThan(300)
    expect(r.perPillar.spec).toBeGreaterThan(0)

    expect(r.findings).toEqual([])
  })

  it('and the 18 provenance mentions it must ignore are genuinely PRESENT', () => {
    // The other half of non-vacuity, and the one that actually proves the card's
    // decision: if the specs contained no TRDD mentions at all, the zero above would
    // be true for a reason that has nothing to do with the scope decision.
    const specs = path.join(designDir, 'specs')
    const total = fs
      .readdirSync(specs)
      .filter(n => n.endsWith('.md') && n !== 'README.md')
      .reduce((n, f) => n + (fs.readFileSync(path.join(specs, f), 'utf8').match(/TRDD-[A-Z0-9]{8}/g)?.length ?? 0), 0)
    expect(total).toBeGreaterThanOrEqual(18)
  })
})
