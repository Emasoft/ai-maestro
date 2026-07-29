/**
 * TRDD-LXLK7XGX — the cross-pillar reference DAG, enforced on DEPENDENCY FIELDS.
 *
 * The USER's stack: references point only UP.
 *
 *     PRRD  ←────  SPECS  ←────  TRDD
 *
 * so `SPECS → TRDD` and `PRRD → *` are illegal.
 *
 * WHAT THIS LINT READS, AND WHY THE SCOPE IS STRUCTURAL RATHER THAN POSITIONAL.
 * The live specs mention `TRDD-XXXXXXXX` 18 times (governance-spec 11, all-in-one 4,
 * 3-pillars 3 — including the arbiter that declares itself the tie-breaker). Those are
 * PROVENANCE: "this clause was conformance-tested against TRDD-QP07O1BK". Nothing
 * resolves them, removing one deletes history rather than breaking a link, and a lint
 * that flags them produces 18 findings naming no broken reader — a wall of warnings,
 * which is how a linter gets routed around.
 *
 * The obvious narrowing — "read frontmatter, never bodies" — is ALSO wrong, just less
 * wrong: `all-in-one-spec.md`'s `implementations:` and `governance-spec.md`'s
 * `authority:` are prose sentences that happen to be quoted YAML values, and both name
 * a TRDD. That trades 18 false positives for 3.
 *
 * So the discriminator was never WHERE the text sits, it is WHICH FIELD declares it.
 * This lint reads a fixed allowlist of dependency fields and nothing else — no body,
 * and no free-text frontmatter field.
 *
 * A CONSEQUENCE WORTH STATING: every field a spec actually carries is descriptive
 * (`spec`, `spec-version`, `status`, `created`, `updated`, `maintainer`, `project-id`,
 * `requested-by`, `implementations`, `authority`, `reconciled-with`, `derived-from`,
 * `validated-by`) and not one is a dependency field. So `SPECS → TRDD` is not merely
 * absent from today's corpus — it is UNEXPRESSIBLE, and the rule and the corpus agree
 * for a structural reason rather than a lucky one. Zero findings here is the designed
 * outcome, which is exactly why the seeded-violation test carries the weight.
 *
 * NOT THIS LINT'S JOB: whether a cited target EXISTS. That is `danglingRefs` in
 * `index-build.ts`. This checks edge DIRECTION only — which is also why NPT
 * `Q3GZJI1X` (the `relevant-rules:` two-catalogue ambiguity, held for the USER) does
 * not block it: an ambiguous target is still unambiguously a TRDD→PRRD edge, and that
 * direction is legal either way.
 */
import { PILLAR_KINDS, type PillarName } from './kinds'
import { walkDocuments, assertCorpusRoot, type PillarDocument } from './store'

/**
 * THE LINT'S ENTIRE INPUT SET: dependency field → the pillar its values point at.
 *
 * The target pillar comes from the FIELD, never from the value's shape. That is what
 * makes a spec carrying `blocked-by:` a detectable violation even though the value
 * looks like any other id.
 */
export const DEPENDENCY_FIELD_TARGETS: Readonly<Record<string, PillarName>> = {
  'blocked-by': 'trdd',
  npt: 'trdd',
  eht: 'trdd',
  'parent-trdd': 'trdd',
  'superseded-by': 'trdd',
  'relevant-rules': 'prrd',
}

export const DEPENDENCY_FIELDS: readonly string[] = Object.keys(DEPENDENCY_FIELD_TARGETS)

/**
 * Legal targets per source pillar, straight off the USER's arrows.
 *
 * Lateral edges are legal within a pillar (a TRDD blocks a TRDD; a spec clause may
 * reference a sibling clause). `prrd` is empty because PRRD sits at the top and the
 * rule is `PRRD → *` NO — including PRRD → PRRD, since a golden rule is meant to
 * stand on its own. PRRD carries no dependency field today either, so this is
 * forward-looking enforcement, not a claim about the current corpus.
 */
const LEGAL_TARGETS: Readonly<Record<PillarName, ReadonlySet<PillarName>>> = {
  trdd: new Set<PillarName>(['trdd', 'spec', 'prrd']),
  spec: new Set<PillarName>(['spec', 'prrd']),
  prrd: new Set<PillarName>(),
}

export interface DagEdge {
  source: PillarName
  target: PillarName
  field: string
  /** Normalized target id, for the message. Direction does not depend on it. */
  targetId: string
  filePath: string
}

export interface DagFinding extends DagEdge {
  rule: 'dag-illegal-edge'
  detail: string
}

export interface DagLintReport {
  /** Documents actually read. The NON-VACUITY guard: a scan that read nothing must
   *  never be reported as clean, and the guard belongs in the tool rather than only
   *  in the test that happens to run it. */
  scanned: number
  perPillar: Record<PillarName, number>
  findings: DagFinding[]
}

/**
 * Every id a dependency field declares.
 *
 * DO NOT use the pillar's `citationRe` here. It is documented as matching a citation
 * "anywhere in prose" and therefore requires the `TRDD-` / `PRRD ` prefix — but the
 * live corpus writes these fields BOTH ways (`blocked-by: [Y916N7WL]` and
 * `blocked-by: [TRDD-K2WJH7RF]`), plus lowercase v1 ids (`[TRDD-a1019073]`) and bare
 * numbers (`relevant-rules: [25]`, which YAML parses as a NUMBER, not a string). A
 * citationRe-based extractor finds none of those, yields no edges, and reports a clean
 * corpus because it saw nothing — the failure mode this lint exists to avoid.
 *
 * `normalizeId` is the right tool: it already absorbs the optional prefix and the
 * case, for each pillar, and it is the same function the store compares ids with.
 */
export function idsInDependencyValue(value: unknown, target: PillarName): string[] {
  const norm = PILLAR_KINDS[target].normalizeId
  const out: string[] = []
  const push = (raw: string) => {
    // Split on commas so an unbracketed `npt: A, B` behaves like the flow-style list
    // YAML would have given us as an array.
    for (const part of raw.split(',')) {
      const id = norm(part)
      if (id) out.push(id)
    }
  }
  const visit = (v: unknown) => {
    if (v === null || v === undefined) return // `parent-trdd: null` — 96 of these; no edge
    if (typeof v === 'string') return push(v)
    if (typeof v === 'number') return push(String(v))
    if (Array.isArray(v)) return v.forEach(visit)
    // Any other shape (a map, a bool) declares no reference we can name. Reporting it
    // would be a malformed-field finding, which is the doctor's per-card contract.
  }
  visit(value)
  return out
}

/** The dependency edges one document declares. Reads the allowlist, nothing else. */
export function edgesOfDocument(doc: PillarDocument): DagEdge[] {
  const edges: DagEdge[] = []
  for (const [field, target] of Object.entries(DEPENDENCY_FIELD_TARGETS)) {
    if (!(field in doc.frontmatter)) continue
    for (const targetId of idsInDependencyValue(doc.frontmatter[field], target)) {
      edges.push({ source: doc.kind, target, field, targetId, filePath: doc.filePath })
    }
  }
  return edges
}

export function isLegalEdge(source: PillarName, target: PillarName): boolean {
  return LEGAL_TARGETS[source].has(target)
}

/**
 * Lint every corpus given a root per pillar. A root may be omitted (this repo has no
 * `PRRD.md` yet) — an omitted pillar is simply not scanned, and its `perPillar` count
 * stays 0 so the omission is visible in the report rather than implied by silence.
 *
 * A PRESENT root that cannot be read THROWS (`assertCorpusRoot`), because "the corpus
 * is clean" and "you are not where you think you are" must not look alike.
 */
export function lintDag(roots: Partial<Record<PillarName, string>>): DagLintReport {
  const findings: DagFinding[] = []
  const perPillar: Record<PillarName, number> = { trdd: 0, prrd: 0, spec: 0 }
  let scanned = 0

  for (const name of Object.keys(perPillar) as PillarName[]) {
    const root = roots[name]
    if (!root) continue
    const kind = PILLAR_KINDS[name]
    assertCorpusRoot(root, kind)
    for (const doc of walkDocuments(root, kind)) {
      scanned++
      perPillar[name]++
      for (const edge of edgesOfDocument(doc)) {
        if (isLegalEdge(edge.source, edge.target)) continue
        findings.push({
          ...edge,
          rule: 'dag-illegal-edge',
          detail:
            `${edge.source.toUpperCase()} declares \`${edge.field}: ${edge.targetId}\`, a ` +
            `${edge.source.toUpperCase()} → ${edge.target.toUpperCase()} dependency. References ` +
            `point only UP the stack (PRRD ← SPECS ← TRDD), so this edge is illegal. If the ` +
            `mention is PROVENANCE ("this clause came from that task"), put it in prose or a ` +
            `descriptive field — a dependency field declares a machine-read edge.`,
        })
      }
    }
  }

  return { scanned, perPillar, findings }
}
