/**
 * TRDD-SCMPWF6R — validate-before-write gate for the TRDD corpus.
 *
 * `lib/trdd-store.ts::editTrdd` is the ONE funnel every write path in the system
 * goes through (the API route, the CLI, every lifecycle verb). Before this gate,
 * that function checked nothing but string-ness of each value — `edit --set
 * column=not-started` succeeded, and the corpus went from clean to carrying 158
 * cards with NO `column:` at all, discovered only later by `greptrdd validate`.
 * This module is the fix: refuse the write BEFORE it lands, so corruption is
 * impossible rather than merely detectable after the fact.
 *
 * IMPORTS THE VOCABULARY LEAF ONLY (`lib/trdd-vocabulary.ts`). `editTrdd` lives in
 * `lib/trdd-store.ts` and calls this module; `lib/trdd-graph.ts` (which owns the
 * richer id-resolution helpers `normalizeTrddRef`/`refList`) itself imports
 * `trdd-store.ts` to read the corpus. Importing trdd-graph from here would close a
 * cycle (store → guard → graph → store), so the handful of ref-parsing lines this
 * gate needs are re-derived locally instead — the grammar (what counts as a valid
 * column, a valid authority rung, …) stays a SINGLE source of truth in the leaf;
 * only the trivial string-shape parsing (strip `TRDD-`, split a flow-style list)
 * is duplicated, and it is trivial precisely so that duplication cannot drift.
 *
 * The one piece of "does this id exist" knowledge this gate needs (`resolveId`) is
 * INJECTED by the caller instead — `trdd-store.ts::editTrdd` passes
 * `(id) => Boolean(findTrdd(designDir, id))`, which is the only place `findTrdd`
 * needs to be in scope at all.
 */
import {
  VALID_COLUMNS,
  TERMINAL_DONE,
  AUTHORITY_RANK,
  V1_STATUS_TO_COLUMN,
} from './trdd-vocabulary'

export type EditGuardResult = { ok: true } | { ok: false; error: string }

/** Frontmatter fields that carry a TRDD-id reference (bare or flow-style list). */
const REF_FIELDS = ['blocked-by', 'npt', 'eht', 'parent-trdd', 'supersedes', 'superseded-by'] as const

/** Frontmatter fields whose value must be an ISO-8601 date. */
const DATE_FIELDS = ['created', 'updated', 'approval-datetime'] as const

/**
 * A card in a terminal-DONE column is frozen (IND base §12) — nothing may edit its
 * body or frontmatter except these two fields, which is exactly why `editTrdd`
 * always writes `updated` alongside whatever the caller asked for.
 */
const FROZEN_ALLOWED_FIELDS = new Set(['updated', 'superseded-by'])

/** Strip a `TRDD-` prefix, upcase, and take the first 8 chars — the corpus-wide join key. */
function normalizeRef(ref: string): string {
  return ref.trim().replace(/^TRDD-/i, '').toUpperCase().slice(0, 8)
}

/**
 * Parse a frontmatter reference VALUE — either a bare scalar (`parent-trdd: L55IYKL4`)
 * or a flow-style list (`blocked-by: [TRDD-ABCD1234, TRDD-EFGH5678]`) — into its
 * normalized ids. `[]` / `null` / empty ⇒ no references.
 */
function parseRefList(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '[]' || trimmed.toLowerCase() === 'null') return []
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeRef)
}

/** Same parse, applied to whatever value ALREADY sits in frontmatter (array, string, or absent). */
function refsFromCurrentValue(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => normalizeRef(String(x))).filter(Boolean)
  if (typeof v === 'string') return parseRefList(v)
  return []
}

/** The effective column of a merged (current ∪ edit) frontmatter, applying the v1 `status:` fallback. */
function effectiveColumn(fm: Record<string, unknown>): string {
  const col = fm['column']
  if (typeof col === 'string' && col.trim()) return col.trim()
  const status = fm['status']
  if (typeof status === 'string') {
    const mapped = V1_STATUS_TO_COLUMN[status.trim().toLowerCase()]
    if (mapped) return mapped
  }
  return ''
}

function isIsoDate(raw: string): boolean {
  if (!raw.trim()) return false
  const d = new Date(raw)
  return !Number.isNaN(d.getTime())
}

/**
 * Validate a set of frontmatter field EDITS against a TRDD's CURRENT frontmatter,
 * refusing anything that would leave the card in a state the corpus grammar forbids.
 *
 * `fields` is the exact `{name: value}` map about to be written (every value a
 * plain string, per the line-based grep-first writer's own contract) — INCLUDING
 * `updated`, since `editTrdd` always writes it alongside the caller's edits and the
 * terminal-freeze rule below must see that it is present.
 *
 * `current` is the card's frontmatter BEFORE this edit (`ParsedTrdd.frontmatter`).
 *
 * `resolveId` answers "does a TRDD with this 8-char id exist anywhere in the
 * corpus?" — injected so this module never needs to read the filesystem itself.
 */
export function validateTrddFieldEdits(
  fields: Record<string, string>,
  current: Record<string, unknown>,
  resolveId: (id: string) => boolean,
): EditGuardResult {
  // ── terminal-column freeze (IND base §12) — checked FIRST, on the CURRENT column,
  // never the resultant one: a frozen card's whole point is that nothing may move it. ──
  const currentColumn = effectiveColumn(current)
  if (TERMINAL_DONE.has(currentColumn)) {
    for (const field of Object.keys(fields)) {
      if (!FROZEN_ALLOWED_FIELDS.has(field)) {
        return {
          ok: false,
          error: `TRDD is in terminal column "${currentColumn}" and its body is frozen (IND base §12) — only "updated" and "superseded-by" may be edited, not "${field}"`,
        }
      }
    }
  }

  // ── the resultant merged frontmatter — what the card will read AFTER this write ──
  const merged: Record<string, unknown> = { ...current, ...fields }

  // ── column must be present and in the ratified vocabulary ──
  const resultColumn = effectiveColumn(merged)
  if (!resultColumn) {
    return {
      ok: false,
      error: `this write would leave "column" ABSENT — every TRDD must carry a column from the ratified set [${VALID_COLUMNS.join(', ')}]`,
    }
  }
  if ('column' in fields && !VALID_COLUMNS.includes(resultColumn)) {
    return {
      ok: false,
      error: `"column" value "${fields['column']}" is not in the ratified vocabulary [${VALID_COLUMNS.join(', ')}]`,
    }
  }

  // ── blocked-by non-empty ⟺ column: blocked (IND base) ──
  const resultBlockedBy =
    'blocked-by' in fields ? parseRefList(fields['blocked-by']) : refsFromCurrentValue(current['blocked-by'])
  if (resultBlockedBy.length > 0 && resultColumn !== 'blocked') {
    return {
      ok: false,
      error: `"blocked-by" is non-empty ([${resultBlockedBy.join(', ')}]) but the resulting column is "${resultColumn}" — blocked-by non-empty requires column: blocked`,
    }
  }
  if (resultBlockedBy.length === 0 && resultColumn === 'blocked' && 'column' in fields) {
    return {
      ok: false,
      error: `column is being set to "blocked" but "blocked-by" would be empty — column: blocked requires a non-empty blocked-by`,
    }
  }

  // ── every referenced TRDD id must resolve in the corpus ──
  for (const field of REF_FIELDS) {
    if (!(field in fields)) continue
    for (const ref of parseRefList(fields[field])) {
      if (!resolveId(ref)) {
        return {
          ok: false,
          error: `"${field}" references TRDD-${ref}, which does not resolve to any TRDD in the corpus`,
        }
      }
    }
  }

  // ── mandate authority: a self-issued mandate above your rank is a forged approval ──
  const mandateRaw = merged['mandate']
  const mandateIsTrue = mandateRaw === true || mandateRaw === 'true'
  if (mandateIsTrue) {
    const byRaw = String(merged['mandated-by'] ?? '').trim().toLowerCase()
    const floorRaw = String(merged['min-approval-requirement'] ?? 'none').trim().toLowerCase()
    const rankBy = AUTHORITY_RANK[byRaw === 'self' ? 'none' : byRaw]
    const rankFloor = AUTHORITY_RANK[floorRaw]
    if (rankBy === undefined || rankFloor === undefined) {
      return {
        ok: false,
        error: `mandate names an authority the ladder does not know (mandated-by="${byRaw}", min-approval-requirement="${floorRaw}") — the legal ladder is [${Object.keys(AUTHORITY_RANK).join(', ')}]`,
      }
    }
    if (rankBy < rankFloor) {
      return {
        ok: false,
        error: `mandate: true issued by "${byRaw}" (rank ${rankBy}) on a TRDD whose floor is "${floorRaw}" (rank ${rankFloor}) — that is not an approval, it is a forged one`,
      }
    }
  }

  // ── date fields parse as ISO-8601, and "updated" is never in the future ──
  for (const field of DATE_FIELDS) {
    if (!(field in fields)) continue
    const raw = fields[field]
    if (!isIsoDate(raw)) {
      return { ok: false, error: `"${field}" value "${raw}" does not parse as an ISO-8601 date` }
    }
    if (field === 'updated' && new Date(raw).getTime() > Date.now()) {
      return { ok: false, error: `"updated" value "${raw}" is in the future — never type a timestamp, read the clock` }
    }
  }

  return { ok: true }
}
