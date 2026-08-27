/**
 * TRDD-I8UC56GZ — the ONE predicate every TRDD write path judges a card by.
 *
 * `pillarPreWriteCheck` early-returned a no-op for per-document pillars, and TRDD is
 * the only per-document pillar — so `trddgrep edit` had the lock and the CAS staleness
 * guard and NO field validation at all: it wrote `column: banana` and exited 0. PRRD and
 * SPEC, both per-line, had a real gate the whole time.
 *
 * ONE predicate, three callers (the `edit` gate, `trddgrep new`, `trddgrep move`), for
 * the reason this repo has already been bitten by: a lint and a fixer keyed on drifted
 * predicates repaired a defect they never reported. Two validators over one document is
 * the same bug wearing a different hat.
 *
 * SCOPE — what belongs here and what does not. Only what ONE card's frontmatter plus its
 * ZONE can decide. Anything needing the corpus (id uniqueness, npt/eht back-links, the
 * derived-TRDD depth invariant) stays in `lib/trdd-doctor.ts`, which walks it. A gate
 * that had to load the corpus would put an O(N) walk inside the write lock.
 */
import { VALID_COLUMNS, AUTHORITY_RANK, isPipelineStateValue, expectedZone } from '../trdd-vocabulary'
import type { TrddZone } from './kinds'

/** ISO 8601 with a LOCAL offset — never bare, never `Z` (TRDD-ZRRDCQ52). */
const ISO_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/
const ID_RE = /^[A-Z0-9]{8}$/

/**
 * The scalar frontmatter of a candidate document, from its LINES.
 *
 * Deliberately not a YAML parse: the gate runs inside the write lock on bytes that have
 * not landed, and every field it judges is a scalar on its own line (the grep-first
 * frontmatter rule is what makes that true). A flow list (`npt: [A, B]`) comes back as
 * its raw text, which is all this predicate needs — nothing here reads inside one.
 *
 * Returns null when the text carries no frontmatter block at all; the caller decides
 * whether that is a violation (it is, for a TRDD) or simply out of scope.
 */
export function candidateFrontmatter(lines: readonly string[]): Record<string, string> | null {
  if ((lines[0] ?? '').trim() !== '---') return null
  const fm: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '---') return fm
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s?(.*)$/)
    if (m) fm[m[1]] = m[2].trim()
  }
  // An UNCLOSED block is not an empty one. Returning the fields harvested so far would
  // let a truncated write pass a gate that never saw the rest of the document.
  return null
}

/**
 * Every violation this card's own frontmatter carries, as human sentences.
 *
 * `zone` is the zone the file WOULD sit in after the write — for `edit` that is where it
 * already is, which is exactly how a `column:` change to a terminal value gets caught
 * before it becomes the ZONE-MISMATCH this session shipped once already.
 */
export function validateTrddCandidate(
  fm: Record<string, string> | null,
  zone: TrddZone,
): string[] {
  if (fm === null) return ['no frontmatter block — a TRDD without frontmatter is invisible to every board query']
  const bad: string[] = []
  const has = (k: string) => typeof fm[k] === 'string' && fm[k] !== ''

  const column = fm['column'] ?? ''
  if (!column) {
    bad.push('no `column:` — the board has no state to place this card in')
  } else if (!VALID_COLUMNS.includes(column)) {
    bad.push(
      `column ${JSON.stringify(column)} is not one of the ratified values ` +
        `(${VALID_COLUMNS.join(' ')})`,
    )
  } else {
    const want = expectedZone(column, fm)
    if (want && want !== zone) {
      bad.push(
        `column '${column}' belongs in design/${want}/ but this file is in design/${zone}/ — ` +
          'move it with `trddgrep move`, which does the column edit and the `git mv` as one operation',
      )
    }
  }

  // `status:` is a REAL field (the specs carry `status: normative`) — what it may never
  // hold is a pipeline value, which lives in `column:`. Keyed on the VALUE, never the
  // field name: keying on the name is what made `trdd:fix` delete a legitimate field.
  if (has('status') && isPipelineStateValue(fm['status'])) {
    bad.push(
      `status: may not hold the pipeline value ${JSON.stringify(fm['status'])} — ` +
        "pipeline state lives in a TRDD's column:, never in status:",
    )
  }

  if (has('trdd-id') && !ID_RE.test(fm['trdd-id'])) {
    bad.push(
      `trdd-id ${JSON.stringify(fm['trdd-id'])} is not 8-char UPPERCASE base36 — uppercase is ` +
        'load-bearing: macOS and Windows filenames are case-insensitive, so a lowercase id can fold onto an existing one',
    )
  }

  if (has('title') && fm['title'].includes(':')) {
    bad.push('title contains a colon — it breaks grep-first flow-style frontmatter parsing')
  }

  for (const field of ['created', 'updated', 'approval-datetime']) {
    if (has(field) && !ISO_OFFSET_RE.test(fm[field])) {
      bad.push(
        `${field}: ${JSON.stringify(fm[field])} is not ISO 8601 with a local offset ` +
          '(YYYY-MM-DDTHH:MM:SS±HHMM) — a bare or `Z` stamp sorts the board wrong',
      )
    }
  }

  if (has('min-approval-requirement') && !(fm['min-approval-requirement'] in AUTHORITY_RANK)) {
    bad.push(
      `min-approval-requirement ${JSON.stringify(fm['min-approval-requirement'])} is not a ` +
        `governance title (${Object.keys(AUTHORITY_RANK).join(' ')})`,
    )
  }

  return bad
}

/**
 * What this edit would ADD — never what the card already carried.
 *
 * A gate that judged the candidate absolutely would refuse an unrelated one-line edit to
 * any card with a pre-existing defect, which is how a write gate gets routed around
 * (and it would make `trddgrep fix` unable to repair the very cards that need it). The
 * contract is narrower and enforceable: an edit may not INTRODUCE a violation.
 */
export function introducedViolations(
  prev: Record<string, string> | null,
  next: Record<string, string> | null,
  zone: TrddZone,
): string[] {
  const before = new Set(validateTrddCandidate(prev, zone))
  return validateTrddCandidate(next, zone).filter((v) => !before.has(v))
}
