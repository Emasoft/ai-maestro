/**
 * TRDD-L55IYKL4 — what each of the three pillars IS, on disk.
 *
 * The three corpora look alike from a distance and are not. Measured, not assumed
 * (TRDD-L55IYKL4 finding F2):
 *
 *   TRDD  many files across 4 zone dirs   unit = one FILE     id in the FILENAME
 *   SPEC  6 files in design/specs/        unit = one CLAUSE   id in the BODY
 *   PRRD  ONE file, design/requirements/  unit = one BULLET   id in the LINE
 *
 * So the axis they differ on is not "where are the files" — it is **how many
 * records a document yields, and where the id lives**. A descriptor keyed on
 * "zones + filename grammar" fits exactly one of the three; forcing PRRD into
 * "a corpus of one zone holding one file" would be an abstraction over 1.5
 * consumers that Phase 3 would have to tear out.
 *
 * The generalization that fits all three: A CORPUS IS A SET OF DOCUMENTS, AND
 * EACH DOCUMENT YIELDS ONE OR MORE RECORDS. TRDD is the 1:1 case.
 *
 * DECLARATION vs CITATION is a first-class distinction here, not a detail. A spec
 * clause is DECLARED line-anchored in backticks (`` `3P-KAN-06` **name** — … ``)
 * and CITED anywhere in prose. Conflating them is what would make the Phase-4 DAG
 * lint flag the 18 provenance mentions that NPT LXLK7XGX catalogued — a wall of
 * false positives, which is how a linter gets routed around.
 */

import path from 'path'

export type PillarName = 'trdd' | 'prrd' | 'spec'

/**
 * How a document yields records — the ONE axis the three pillars differ on.
 *
 * `per-document` never scans the body, so the TRDD path costs exactly what it
 * costs today. `per-line` scans, but only for the declaration pattern.
 */
export type RecordSource =
  /** One record per document; the id is in the FILENAME. (TRDD) */
  | { mode: 'per-document'; idFromFilename: (fileName: string) => string | null }
  /** N records per document; each DECLARATION line yields one. (PRRD, SPEC) */
  | { mode: 'per-line'; declarationRe: RegExp; idFromMatch: (m: RegExpExecArray) => string }

export interface PillarKind {
  name: PillarName
  /**
   * Noun used in error messages — "no TRDD corpus at …". Callers gate on these
   * strings (the CLIs and their tests), so it is part of the contract, not decor.
   */
  label: string
  /**
   * Where this pillar's corpus root sits UNDER the project's `design/` dir. `''`
   * means `design/` itself.
   *
   * It lives here because two consumers already needed it and one of them had
   * hardcoded its own copy (`scripts/pillars-lint.mjs` carried a
   * `{trdd: designDir, spec: designDir/specs, prrd: designDir/requirements}`
   * literal). A second consumer copying that literal is the moment the two start
   * drifting — and a CLI pointed at the wrong root does not fail, it reports a
   * confident "0 records" about a corpus it never read.
   */
  corpusSubdir: string
  /**
   * Zone subdirectories under the corpus root, in scan order. `''` means the root
   * itself — which is how a zone-less pillar (PRRD) and a flat one (SPEC) fit the
   * same walk without a special case.
   */
  zones: readonly string[]
  /** Is this filename one of this pillar's documents? */
  isDocument(fileName: string): boolean
  source: RecordSource
  /** Canonical id form, for comparison across a citation and a declaration. */
  normalizeId(raw: string): string
  /** Matches a CITATION of this pillar's ids anywhere in prose. NOT the declaration. */
  citationRe: RegExp
}

// ── TRDD ─────────────────────────────────────────────────────────────────────

// v2 — TRDD-<YYYYMMDD_HHMMSS±HHMM>-<ID8>-<slug>.md. The timestamp itself may contain
// a `-` (negative GMT offset), so the id is extracted positionally, never by splitting.
const TRDD_V2_FILENAME_RE = /^TRDD-\d{8}_\d{6}[+-]\d{4}-([A-Za-z0-9]{8})-.+\.md$/

// v1 — TRDD-<uuid|8hex>-<slug>.md, no timestamp segment. Ten of these exist and three
// carry live frontmatter; matching only v2 made every one invisible to the store. Both
// tails occur, so the uuid remainder is optional. A v2 name cannot reach this pattern:
// its 8 leading digits are followed by `_`, never `-`. v2 is tried first regardless.
const TRDD_V1_FILENAME_RE =
  /^TRDD-([0-9a-f]{8})(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?-.+\.md$/i

export function trddIdFromFilename(name: string): string | null {
  const v2 = name.match(TRDD_V2_FILENAME_RE)
  if (v2) return v2[1].toUpperCase()
  const v1 = name.match(TRDD_V1_FILENAME_RE)
  return v1 ? v1[1].toUpperCase() : null
}

// The typed zone tuple lives HERE so `TRDD_KIND.zones` and the `TrddZone` union
// cannot drift apart; `lib/trdd-store.ts` re-exports both as its public API.
export type TrddZone = 'proposals' | 'tasks' | 'archived' | 'refused'
export const TRDD_ZONES: readonly TrddZone[] = ['proposals', 'tasks', 'archived', 'refused']

export const TRDD_KIND: PillarKind = {
  name: 'trdd',
  label: 'TRDD',
  // The zone dirs sit directly under `design/`, so the corpus root IS the design dir.
  corpusSubdir: '',
  zones: TRDD_ZONES,
  isDocument: (n) => n.endsWith('.md') && trddIdFromFilename(n) !== null,
  source: { mode: 'per-document', idFromFilename: trddIdFromFilename },
  normalizeId: (raw) => raw.trim().replace(/^TRDD-/i, '').toUpperCase(),
  citationRe: /\bTRDD-([A-Z0-9]{8})\b/g,
}

// ── SPEC ─────────────────────────────────────────────────────────────────────

// A clause is DECLARED line-anchored in backticks: `3P-KAN-06` **name** — prose.
// Verified: 38 such declarations in 3-pillars-spec.md, matching its 38 distinct ids.
// Families in use across design/specs/: 3P, AIO, GOV, RP, STS.
const SPEC_DECLARATION_RE = /^`([A-Z0-9]{2,4}-[A-Z]{2,8}-\d{2})`/

export const SPEC_KIND: PillarKind = {
  name: 'spec',
  label: 'spec',
  corpusSubdir: 'specs',
  // Flat today. `proposals/` and `archived/` exist but are EMPTY (verified with
  // find(1) — an earlier glob-based count of mine said 65 and was meaningless).
  // They are listed so a spec that lands there is not silently invisible.
  zones: ['', 'proposals', 'archived'],
  isDocument: (n) => n.endsWith('.md') && n !== 'README.md',
  source: {
    mode: 'per-line',
    declarationRe: SPEC_DECLARATION_RE,
    idFromMatch: (m) => m[1].toUpperCase(),
  },
  normalizeId: (raw) => raw.trim().toUpperCase(),
  citationRe: /\b([A-Z0-9]{2,4}-[A-Z]{2,8}-\d{2})\b/g,
}

// ── PRRD ─────────────────────────────────────────────────────────────────────

// One file, and its records are bullet lines: `- **G1.2** — prose`. Verified against
// two real PRRDs in sibling repos (this repo has none yet — which is precisely why
// the shape had to be checked somewhere it exists rather than imagined).
//
// The number is globally unique across G and S; promote/demote flips ONLY the letter.
// So the canonical id is the NUMBER — `normalizeId` drops the letter, which is what
// makes a citation by number resolve regardless of the tier it currently sits in.
const PRRD_DECLARATION_RE = /^\s*-\s+\*\*([GS])(\d+\.\d+)\*\*/

export const PRRD_KIND: PillarKind = {
  name: 'prrd',
  label: 'PRRD',
  corpusSubdir: 'requirements',
  zones: [''],
  isDocument: (n) => n === 'PRRD.md',
  source: {
    mode: 'per-line',
    declarationRe: PRRD_DECLARATION_RE,
    // Keep the letter in the record id so a reader can see the tier; comparison
    // goes through normalizeId, which drops it.
    idFromMatch: (m) => `${m[1]}${m[2]}`,
  },
  normalizeId: (raw) => raw.trim().replace(/^PRRD\s+/i, '').replace(/^[GS]/i, ''),
  citationRe: /\bPRRD\s+([GS]\d+(?:\.\d+)?)\b/g,
}

export const PILLAR_KINDS: Record<PillarName, PillarKind> = {
  trdd: TRDD_KIND,
  prrd: PRRD_KIND,
  spec: SPEC_KIND,
}

/**
 * This pillar's corpus root, given the project's `design/` dir.
 *
 * The ONE place the mapping lives. Every caller that resolves a pillar root — the
 * CLIs, the cross-pillar lint — goes through here, so a project that reorganises
 * `design/` changes one line rather than N literals that agree until they don't.
 */
export function corpusRootFor(designDir: string, kind: PillarKind): string {
  // `path.join(dir, '')` normalises to `dir`, so the zone-less TRDD case needs no
  // branch — and a branch is where the two cases would eventually disagree.
  return path.join(designDir, kind.corpusSubdir)
}
