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
import { VALID_COLUMNS, AUTHORITY_RANK, isPipelineStateValue, expectedZone, TRDD_STATUSES, statusForZone } from '../trdd-vocabulary'
import { TRDD_ZONES, type TrddZone } from './kinds'

/**
 * The ONE refusal every write verb gives an archived card (TRDD-MQE5D28T D8, owner ruling
 * 2026-09-24: archived cards "are like corpses: you cannot change them anymore … photographed
 * forever in the state it was when it was archived"). Keyed on the ZONE only, never on the
 * column: a finished card not yet archived keeps IND rule 12's carve-outs (`updated:`,
 * `superseded-by:`, the Approval log — D5), and an archived card has none at all. The
 * archiving transition's own closing write is not a verb that calls this.
 */
export function archivedWriteRefusal(zone: string | null | undefined, what: string): string | null {
  return zone === 'archived'
    ? `refusing ${what}: the card is in design/archived/ — archived cards are immutable, definitive history (TRDD-MQE5D28T D8); nothing may change one, not even \`updated:\` or the Approval log`
    : null
}

/**
 * Identity fields (#168): set once at creation — or filled when missing, a repair — and never
 * changed afterwards. Authorization reads `created-by` to decide who owns and who authored a
 * card, so a generic field write that could rewrite it would let any writer make itself the
 * author. This stops honest mistakes through the tools; it is not a security boundary against a
 * writer that edits the file directly (that needs the server-side record tracked with #168).
 */
export const WRITE_ONCE_FIELDS = ['created-by', 'created'] as const

/**
 * The approval record (`approval-judge`, `approval-datetime`) and the mandate (`mandate`,
 * `mandated-by`) are written ONLY by the code paths that make those decisions — `createTrdd` at
 * mint, `promoteTrdd` at approval — never by a generic field write, where they would be a forged
 * approval the D4 watchdog then trusts.
 */
export const RECORD_ONLY_FIELDS = ['approval-judge', 'approval-datetime', 'mandate', 'mandated-by'] as const

export interface FieldWriteOpts {
  /**
   * #168 SEAM — the future owner-approved identity-migration verb (legacy session labels and
   * logins → the identity grammar) passes true to rewrite a legacy `created-by`. It is the ONLY
   * exemption from write-once, it never exempts `created` or a record-only field, and nothing
   * passes it today.
   */
  identityMigration?: boolean
}

/** Changes a generic write may not make to the identity and approval-record fields. */
export function protectedFieldViolations(
  prev: Record<string, string> | null,
  next: Record<string, string> | null,
  opts: FieldWriteOpts = {},
): string[] {
  const before = prev ?? {}
  const after = next ?? {}
  const bad: string[] = []
  for (const field of WRITE_ONCE_FIELDS) {
    const was = before[field] ?? ''
    if (!was || (after[field] ?? '') === was) continue
    if (field === 'created-by' && opts.identityMigration) continue
    bad.push(`${field}: is write-once — it was ${JSON.stringify(was)} and may not be changed or removed`)
  }
  for (const field of RECORD_ONLY_FIELDS) {
    if ((after[field] ?? '') !== (before[field] ?? '')) {
      bad.push(`${field}: is written only by the create/approve code paths, never by a generic field write`)
    }
  }
  return bad
}

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
  } else if (has('status')) {
    // The life stage (owner ruling 2026-09-24: "status. enforced to the 3 values"), judged with
    // the linter's own two rules (STATUS-INVALID, STATUS-ZONE-MISMATCH) so a write can no longer
    // land the ERROR the linter then reports. "belongs in design/" is the phrase the per-document
    // gate filters when the zone is unknown, exactly as it filters the column rule's.
    const status = fm['status']
    if (!(TRDD_STATUSES as readonly string[]).includes(status)) {
      bad.push(`status ${JSON.stringify(status)} is not a life stage (${TRDD_STATUSES.join(' ')})`)
    } else if (status !== statusForZone(zone)) {
      const home = TRDD_ZONES.find((z) => statusForZone(z) === status)
      bad.push(`status '${status}' belongs in design/${home}/ but this file is in design/${zone}/`)
    }
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
  opts: FieldWriteOpts = {},
): string[] {
  const before = new Set(validateTrddCandidate(prev, zone))
  return [
    ...validateTrddCandidate(next, zone).filter((v) => !before.has(v)),
    ...protectedFieldViolations(prev, next, opts),
  ]
}
