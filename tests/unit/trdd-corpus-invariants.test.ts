/**
 * The TRDD corpus graph must satisfy the structural invariants of the
 * derived-TRDD model (`rules/aimaestro/aimaestro-trdd-approval.md`).
 *
 * Two halves, and both are load-bearing:
 *
 *  1. FALSIFICATION — every check is made to fire on a synthetic graph. A check
 *     that has never been seen to fail is indistinguishable from `return []`, and
 *     a green suite over a clean corpus would prove nothing about either.
 *  2. THE REAL CORPUS — `design/**` must yield zero violations. This is the D4
 *     watchdog's zero-LLM pre-filter, run on every `yarn test`.
 *
 * The migration backlog (claimed children that predate the `derived:` field) is
 * reported, never failed: the policy is migrate-on-touch, not a mass rewrite.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  checkTrddInvariants,
  classifyBlockerRef,
  localRefList,
  externalRefList,
  loadTrddGraph,
  migrationBacklog,
  normalizeTrddRef,
  type TrddNode,
  type ViolationKind,
} from '@/lib/trdd-graph'

const DESIGN_DIR = path.resolve(__dirname, '../../design')

/** A minimal well-formed node; each test perturbs exactly one thing. */
function node(id: string, over: Partial<TrddNode> = {}): TrddNode {
  return {
    id,
    zone: 'tasks',
    filePath: `tasks/TRDD-20260709_102705+0200-${id}-x.md`,
    column: 'complete',
    derived: false,
    hasDerivedField: true,
    derivedKind: null,
    parent: null,
    npt: [],
    eht: [],
    blockedBy: [],
    externalBlockers: [],
    ...over,
  }
}

const kinds = (nodes: TrddNode[]): ViolationKind[] => checkTrddInvariants(nodes).map((v) => v.kind)

describe('normalizeTrddRef — the join key is the 8-char prefix', () => {
  it('strips the TRDD- prefix and upper-cases', () => {
    expect(normalizeTrddRef('TRDD-anycprtx')).toBe('ANYCPRTX')
  })

  it('truncates a v1 full-UUID id to the eight chars every reference cites', () => {
    // Without this, `903b7a20-bddf-4368-...` never matches its own children's
    // `TRDD-903b7a20`, and sixteen real children look like missing ones.
    expect(normalizeTrddRef('903b7a20-bddf-4368-9c2f-1a2b3c4d5e6f')).toBe('903B7A20')
  })
})

describe('a clean graph is silent', () => {
  it('reports nothing for a parent with one npt child and one eht child', () => {
    const nodes = [
      node('PARENT01', { npt: ['CHILDN01'], eht: ['CHILDE01'] }),
      node('CHILDN01', { derived: true, derivedKind: 'npt', parent: 'PARENT01' }),
      node('CHILDE01', { derived: true, derivedKind: 'eht', parent: 'PARENT01' }),
    ]
    expect(checkTrddInvariants(nodes)).toEqual([])
  })
})

describe('falsification — each check fires on the shape it exists to catch', () => {
  it('depth1: a derived TRDD may not carry children of its own', () => {
    const nodes = [
      node('PARENT01', { npt: ['CHILDN01'] }),
      node('CHILDN01', { derived: true, derivedKind: 'npt', parent: 'PARENT01', eht: ['GRAND001'] }),
      node('GRAND001'),
    ]
    expect(kinds(nodes)).toContain('depth1')
  })

  it('parentIsDerived: no parent-trdd may point at a derived TRDD', () => {
    const nodes = [
      node('PARENT01', { npt: ['CHILDN01'] }),
      node('CHILDN01', { derived: true, derivedKind: 'npt', parent: 'PARENT01' }),
      node('GRAND001', { parent: 'CHILDN01' }),
    ]
    expect(kinds(nodes)).toContain('parentIsDerived')
  })

  it('twoParents: a shared dependency drawn as a derivation edge', () => {
    // The 2026-07-10 bug, minimised: two siblings each name the same platelet in
    // their own `eht:`, so the platelet has two parents.
    const nodes = [
      node('SIBLING1', { eht: ['PLATELET'] }),
      node('SIBLING2', { eht: ['PLATELET'] }),
      node('PLATELET'),
    ]
    expect(kinds(nodes)).toContain('twoParents')
  })

  it('cycle: two TRDDs each claiming the other as a child', () => {
    const nodes = [node('AAAAAAAA', { npt: ['BBBBBBBB'] }), node('BBBBBBBB', { eht: ['AAAAAAAA'] })]
    const found = kinds(nodes)
    expect(found).toContain('cycle')
    // Reported once from each end — a cycle has no privileged side to report from.
    expect(found.filter((k) => k === 'cycle')).toHaveLength(2)
  })

  it('unclaimed: derived, but no parent lists it', () => {
    const nodes = [node('ORPHAN01', { derived: true, derivedKind: 'eht', parent: 'PARENT01' }), node('PARENT01')]
    expect(kinds(nodes)).toContain('unclaimed')
  })

  it('kindMismatch: the child says eht, the parent lists it under npt', () => {
    const nodes = [
      node('PARENT01', { npt: ['CHILDN01'] }),
      node('CHILDN01', { derived: true, derivedKind: 'eht', parent: 'PARENT01' }),
    ]
    expect(kinds(nodes)).toContain('kindMismatch')
  })

  it('parentMismatch: the child names a different parent than the one claiming it', () => {
    const nodes = [
      node('PARENT01', { npt: ['CHILDN01'] }),
      node('OTHER001'),
      node('CHILDN01', { derived: true, derivedKind: 'npt', parent: 'OTHER001' }),
    ]
    expect(kinds(nodes)).toContain('parentMismatch')
  })

  it('childMissing: a named child that does not exist', () => {
    expect(kinds([node('PARENT01', { eht: ['GHOST001'] })])).toContain('childMissing')
  })

  it('childDerivedFalse: a claimed child that denies being derived', () => {
    const nodes = [
      node('PARENT01', { eht: ['CHILDE01'] }),
      node('CHILDE01', { derived: false, hasDerivedField: true, parent: 'PARENT01' }),
    ]
    expect(kinds(nodes)).toContain('childDerivedFalse')
  })

  it('falseComplete: a terminal parent with an open child has not finished', () => {
    const nodes = [
      node('PARENT01', { column: 'complete', eht: ['CHILDE01'] }),
      node('CHILDE01', { column: 'dev', derived: true, derivedKind: 'eht', parent: 'PARENT01' }),
    ]
    expect(kinds(nodes)).toContain('falseComplete')
  })

  it('falseComplete: a NON-terminal parent claims nothing and is exempt', () => {
    // A `blocked` epic with open children is the honest state, not a violation.
    const nodes = [
      node('PARENT01', { column: 'blocked', eht: ['CHILDE01'], blockedBy: ['CHILDE01'] }),
      node('CHILDE01', { column: 'dev', derived: true, derivedKind: 'eht', parent: 'PARENT01' }),
    ]
    expect(kinds(nodes)).not.toContain('falseComplete')
  })

  it('blockedNotBlocked: a live blocker means column: blocked, not planned', () => {
    const nodes = [node('WAITER01', { column: 'planned', blockedBy: ['LIVEBLK1'] }), node('LIVEBLK1', { column: 'dev' })]
    expect(kinds(nodes)).toContain('blockedNotBlocked')
  })

  it('danglingBlocker: blocked-by carries only OPEN blockers', () => {
    const nodes = [node('WAITER01', { column: 'blocked', blockedBy: ['DONEBLK1'] }), node('DONEBLK1', { column: 'complete' })]
    expect(kinds(nodes)).toContain('danglingBlocker')
  })

  it('unknownBlocker: blocked-by names a TRDD that does not exist', () => {
    expect(kinds([node('WAITER01', { column: 'blocked', blockedBy: ['GHOST001'] })])).toContain('unknownBlocker')
  })
})

describe('loadTrddGraph — the fs → YAML → node pipeline', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-graph-'))
    fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true })
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const write = (name: string, body: string) => fs.writeFileSync(path.join(dir, 'tasks', name), body)

  // Without this, a mis-parse of `eht:` would drop every edge in the corpus and
  // the real-corpus test below would pass by reading an edgeless graph.
  it('reads real flow-style edges, the derived flags, and the parent ref', () => {
    write(
      'TRDD-20260709_102705+0200-PARENT01-epic.md',
      '---\ntrdd-id: PARENT01\ncolumn: blocked\nparent-trdd: null\nderived: false\n' +
        'npt: [TRDD-CHILDN01]\neht: [TRDD-CHILDE01, TRDD-CHILDE02]\nblocked-by: [TRDD-CHILDN01]\n---\nbody\n',
    )
    const [p] = loadTrddGraph(dir)
    expect(p.npt).toEqual(['CHILDN01'])
    expect(p.eht).toEqual(['CHILDE01', 'CHILDE02'])
    expect(p.blockedBy).toEqual(['CHILDN01'])
    expect(p.parent).toBeNull()
    expect(p.derived).toBe(false)
    expect(p.hasDerivedField).toBe(true)
  })

  it('skips a pre-frontmatter v0 file, so a parent naming one is childMissing, not silence', () => {
    write('TRDD-80557822-v0-no-frontmatter.md', '# TRDD ID: 80557822\n\nbody\n')
    expect(loadTrddGraph(dir)).toEqual([])
  })

  it('maps a v1 `status:` onto a column, so a v1 child never reads as open', () => {
    write(
      'TRDD-70a521d9-5641-4a11-975f-2ca6f5bd9b0c-v1.md',
      '---\ntrdd-id: 70a521d9-5641-4a11-975f-2ca6f5bd9b0c\nstatus: completed\n---\nbody\n',
    )
    const [n] = loadTrddGraph(dir)
    expect(n.id).toBe('70A521D9')
    expect(n.column).toBe('complete')
  })
})

describe('the real design/ corpus', () => {
  const nodes = loadTrddGraph(DESIGN_DIR)

  it('parses a non-trivial number of TRDDs (a silent empty load would pass every check)', () => {
    expect(nodes.length).toBeGreaterThan(100)
  })

  it('actually carries derivation edges (an edgeless graph satisfies everything)', () => {
    expect(nodes.some((n) => n.npt.length + n.eht.length > 0)).toBe(true)
    expect(nodes.some((n) => n.derived)).toBe(true)
  })

  it('every id is unique — a duplicate would silently shadow a TRDD', () => {
    const ids = nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('satisfies every structural invariant', () => {
    const violations = checkTrddInvariants(nodes)
    // Print the offenders rather than a bare count — the failure has to be actionable.
    expect(violations.map((v) => `${v.kind}: ${v.id} — ${v.detail}`)).toEqual([])
  })

  it('reports the migrate-on-touch backlog without failing on it', () => {
    // Not an assertion about the count: it shrinks as files are touched, and
    // pinning it would make an unrelated edit fail this test.
    expect(Array.isArray(migrationBacklog(nodes))).toBe(true)
  })
})

describe('non-local blocked-by spellings (TRDD-PTFPGSLV)', () => {
  // The classifier is the ONE owner of "which spellings are non-local"; everything
  // downstream (graph, index, trddgrep board) inherits its verdict through
  // `localRefList`/`externalRefList`.
  it('classifyBlockerRef: the two sanctioned shapes, and nothing else', () => {
    expect(classifyBlockerRef('gh:Emasoft/ai-maestro#145')).toBe('external-issue')
    expect(classifyBlockerRef('amama:TRDD-LT5N2JA4')).toBe('cross-project')
    expect(classifyBlockerRef('TRDD-AAAA1111')).toBe('local')
    expect(classifyBlockerRef('AAAA1111')).toBe('local')
    // COS's original spelling is deliberately NOT sanctioned: it stays a local id and
    // therefore still ERRORs as unknown — the card upgrades the workaround into SYNTAX,
    // not into "anything with a # is fine".
    expect(classifyBlockerRef('ai-maestro#145')).toBe('local')
  })

  it('localRefList drops non-local refs from blocked-by ONLY — an npt gh: ref stays (and still errors)', () => {
    expect(localRefList('blocked-by', ['gh:Emasoft/ai-maestro#145', 'TRDD-AAAA1111'])).toEqual(['AAAA1111'])
    // Scoped to blocked-by on purpose: silently dropping a bogus `gh:` from `npt:` would
    // soften `childMissing` — the parent's completion gate would stop counting it.
    expect(localRefList('npt', ['gh:Emasoft/ai-maestro#145'])).toEqual(['GH:EMASO'])
  })

  it('externalRefList keeps the RAW spelling — the raw ref IS the information', () => {
    expect(externalRefList(['gh:Emasoft/ai-maestro#145', 'AAAA1111'])).toEqual(['gh:Emasoft/ai-maestro#145'])
    expect(externalRefList('amama:TRDD-LT5N2JA4')).toEqual(['amama:TRDD-LT5N2JA4'])
  })

  it('externalBlocker: a gh: ref is its own kind carrying the raw ref — never a mangled unknownBlocker', () => {
    const nodes = [node('CARDAAAA', { column: 'blocked', externalBlockers: ['gh:Emasoft/ai-maestro#145'] })]
    const vs = checkTrddInvariants(nodes)
    expect(vs.map((v) => v.kind)).toEqual(['externalBlocker'])
    // A neuter that routes the ref back through normalizeTrddRef truncates it to
    // `GH:EMASO` and reds this line — the exact live-corpus symptom the card fixes.
    expect(vs[0].detail).toContain('gh:Emasoft/ai-maestro#145')
  })

  it('crossProjectBlocker: a <project-id>:TRDD-<id8> ref is its own kind, raw', () => {
    const nodes = [node('CARDBBBB', { column: 'blocked', externalBlockers: ['amama:TRDD-LT5N2JA4'] })]
    const vs = checkTrddInvariants(nodes)
    expect(vs.map((v) => v.kind)).toEqual(['crossProjectBlocker'])
    expect(vs[0].detail).toContain('amama:TRDD-LT5N2JA4')
  })

  it('a bare unknown local id still ERRORs as unknownBlocker — unchanged', () => {
    const nodes = [node('CARDCCCC', { column: 'blocked', blockedBy: ['ZZZZ9999'] })]
    expect(kinds(nodes)).toEqual(['unknownBlocker'])
  })

  it('blockedNotBlocked fires for a working-column card whose ONLY blocker is external', () => {
    // Without counting externalBlockers, a card blocked solely on a gh: issue could sit at
    // `dev` claiming to be workable while its blocked-by says otherwise.
    const nodes = [node('CARDDDDD', { column: 'dev', externalBlockers: ['gh:Emasoft/ai-maestro#9'] })]
    const vs = checkTrddInvariants(nodes)
    expect(vs.map((v) => v.kind)).toContain('blockedNotBlocked')
  })
})
