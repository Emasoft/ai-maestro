/**
 * TRDD-SCMPWF6R — the TRDD corpus grammar, as a LEAF module.
 *
 * Every constant here previously lived in `lib/trdd-graph.ts` or `lib/trdd-doctor.ts`,
 * each of which imports `lib/trdd-store.ts` (to read the corpus). The new write-time
 * gate (`lib/trdd-edit-guard.ts`) is called FROM `trdd-store.ts::editTrdd`, so if the
 * gate imported the grammar from either of those two files it would close a cycle:
 * store → guard → graph/doctor → store. Moving the grammar here — importing nothing
 * but `@/types/task` — breaks the cycle and gives the linter, the graph, and the
 * write gate ONE shared vocabulary instead of three copies that could each drift.
 *
 * `lib/trdd-graph.ts` and `lib/trdd-doctor.ts` re-export these same names so every
 * existing importer keeps compiling unchanged — the move is invisible to them.
 */
import { DEFAULT_STATUSES } from '@/types/task'
import type { TrddZone } from './pillar/kinds'

/**
 * v1 TRDDs predate `column:` and carry a six-value `status:` instead. The IND base
 * says tools accept both and apply this mapping read-only. Without it a v1 file
 * reads as column `''`, which is in neither TERMINAL_DONE nor `blocked` — so the
 * day a v1 TRDD becomes someone's child, its parent would be reported as a false
 * completion for a child that finished years ago.
 */
export const V1_STATUS_TO_COLUMN: Readonly<Record<string, string>> = {
  'not-started': 'backburner',
  'in-progress': 'dev',
  completed: 'complete',
  failed: 'failed',
  blocked: 'blocked',
  superseded: 'superseded',
  // Not one of the six documented v1 values — a hand-written v2 folder-lifecycle
  // state in a v1 `status:` field. It is in the corpus (TRDD-1d4ea74e, the
  // package-manager migration the USER declined), and an unmapped status reads as
  // column '', which puts the card on no board at all. Map what exists, not what
  // the enum says should exist.
  cancelled: 'cancelled',
}

/** Columns the flock gate treats as done (IND base: complete|published|live|superseded). */
export const TERMINAL_DONE: ReadonlySet<string> = new Set([
  'complete',
  'completed',
  'published',
  'live',
  'superseded',
])

/** The 22 ratified kanban columns, plus the lifecycle values that bracket them. */
export const BRACKET_COLUMNS = ['proposal', 'planned', 'refused', 'completed', 'cancelled'] as const
export const VALID_COLUMNS: readonly string[] = [...DEFAULT_STATUSES, ...BRACKET_COLUMNS]

/**
 * Where a card with NO `column:` lands (spec 3P-TRDD-11, `PRRD G11.1`, USER 2026-08-23).
 *
 * It used to be a flat `todo`. That was correct while `design` sat AFTER `todo` — the card
 * landed at the head of the work queue and the next agent had to evaluate it. In 3.0.0
 * `design` moved BEFORE `todo`, so `todo` now asserts *approved AND designed*, and inserting
 * it would have the repairer manufacture two claims nobody made. Hence three-way, keyed on
 * what the card can actually prove about itself:
 *
 *   not approved            → `backburner`          (G3.1: backburner IS "not yet approved")
 *   approved, no design yet → `design`              (it needs designing before it can queue)
 *   approved, design present→ `design_ai_review`    (the design exists; it needs reviewing)
 *
 * ONE definition, called by every insertion site. The lint message and the two `--fix` sites
 * each used to spell `todo` by hand, which is three copies of a rule and two chances to drift
 * — and a `--fix` that repairs a shape the lint never described is the worst asymmetry a fix
 * pipeline can have, because the report is the only thing a human reads before running it.
 *
 * DELIBERATELY conservative on `approved:`: only a literal `true` counts. `false`, `rejected`,
 * absent, or unparseable all mean "cannot prove approval", and the safe landing for that is
 * `backburner` — a card parked one column early costs a move, a card queued as approved when
 * it was not is a false claim on the board.
 */
export function defaultColumnForMissing(fm: Record<string, unknown>): string {
  const truthy = (v: unknown) => v === true || String(v ?? '').trim().toLowerCase() === 'true'
  if (!truthy(fm['approved'])) return 'backburner'
  return truthy(fm['design-included']) ? 'design_ai_review' : 'design'
}

/**
 * Does this value name a point in the PIPELINE — in either the v2 or the v1 spelling?
 *
 * The one predicate for "a column value is sitting where it should not be". The linter,
 * `fixCorpus`, and the write gate MUST share it: the linter and fixer disagreed once (the
 * lint checked only `VALID_COLUMNS` while the fixer also accepted the v1 map), which made
 * the fixer repair a shape the linter never reported — the worst asymmetry a fix pipeline
 * can have, because the report is the only thing a human reviews before running `--fix`.
 *
 * Why it must key on the VALUE and never on the field name: `status:` is NOT a retired
 * duplicate of `column:` (USER ruling 2026-07-30). It carries a different aspect, and the
 * pillar specs already use it that way (`status: normative`). A pipeline value in it is
 * provably v1 residue; anything else is the field doing its own job.
 */
export function isPipelineStateValue(raw: string): boolean {
  const key = raw.trim().toLowerCase()
  if (!key) return false
  return Boolean(V1_STATUS_TO_COLUMN[key]) || VALID_COLUMNS.includes(key)
}

/** Working columns — a card here is OPEN. `failed` is OPEN too: it is retryable. */
export const WORKING_COLUMNS = DEFAULT_STATUSES.filter(
  (c) => !['complete', 'published', 'live', 'superseded'].includes(c),
).concat('planned')

/** The authority ladder. A mandate is valid only if the issuer sits at or above the floor. */
export const AUTHORITY_RANK: Record<string, number> = {
  none: 0,
  orchestrator: 1,
  'chief-of-staff': 2,
  manager: 3,
  user: 4,
  maestro: 4, // the human owner, as this project names them
}

/**
 * The DEPRECATED `approval-tier:` decoded to the ladder rung it always meant. The overlay
 * retired the number because reading `2` required a lookup to learn it said "MANAGER"; the
 * field survives only as a read-alias on legacy cards, and is never written on a new one.
 *
 * This decodes against AUTHORITY_RANK above rather than carrying its own ordering — two
 * hand-maintained ladders is the footgun one level up, and the whole point of the migration
 * was to have ONE spelling per rung.
 */
export const TIER_TO_REQUIREMENT: Record<string, string> = {
  '0': 'none',
  '1': 'chief-of-staff',
  '2': 'manager',
  '3': 'user',
}

/**
 * Which zone a column belongs in. `null` means the column implies no constraint.
 *
 * MOVED HERE from `lib/trdd-doctor.ts` (TRDD-I8UC56GZ) so the write-time gate can ask
 * it without importing the 1725-line doctor — which imports `trdd-store` and
 * `trdd-graph`, and would put a corpus walker behind every write. It is pure grammar:
 * a column and one frontmatter field in, a zone out, no filesystem. The doctor
 * re-exports it, so every existing importer is unchanged.
 *
 * `import type` for TrddZone on purpose: `lib/pillar/kinds.ts` imports only `path`, so
 * even a value import would be acyclic — but the type is all this needs, and an erased
 * import cannot become the seam through which the leaf grows a dependency.
 */
export function expectedZone(column: string, fm: Record<string, unknown>): TrddZone | null {
  if (column === 'proposal') return 'proposals'
  if (column === 'refused') return 'refused'
  if (['completed', 'cancelled', 'superseded', 'published', 'live'].includes(column)) return 'archived'
  // `complete` is terminal ONLY when the TRDD ships nothing further. With
  // `release-via: publish|deploy` it still has publish/deploy stages ahead of it,
  // so it legitimately stays OPEN in design/tasks/.
  if (column === 'complete') {
    const via = String(fm['release-via'] ?? 'none').trim()
    return via === 'none' || via === '' ? 'archived' : null
  }
  if (WORKING_COLUMNS.includes(column)) return 'tasks'
  return null
}

/**
 * The DAY part of a frontmatter date, as `YYYY-MM-DD`, or `''` when there is none.
 *
 * Handles BOTH shapes on purpose. A YAML reader may hand back an ISO string or a parsed
 * `Date` depending on its timestamp settings, and which one it is here is not something a
 * rule should silently depend on: `String(someDate)` yields `"Fri Jul 31 2026 …"`, whose
 * first ten characters are not a date at all, so a string-only reader would compare garbage
 * and quietly grandfather every card forever. Both branches are pinned by tests rather than
 * one being assumed and the other left as dead code.
 *
 * MOVED HERE from `lib/trdd-doctor.ts` (TRDD-4P798U6P). `lib/trdd-store.ts` needed this same
 * day-part logic inside `advanceColumn`'s entry gate and could not import it — the doctor
 * imports FROM the store, so store -> doctor would close a cycle — so it re-derived a
 * byte-identical private copy under its own name. One copy here, imported by both,
 * removes the chance of the two silently drifting apart.
 */
export function frontmatterDay(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  return String(v ?? '').trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
}

/**
 * Does this card carry a park justification OTHER than `column === 'blocked'` or a
 * non-empty `blocked-by:` — both of which every caller checks separately, because one is
 * the very column the caller may be deciding to enter and the other already has its own
 * parsed-refs list? A FUTURE `review-after:`, or a `hub-blocked`/`fleet-ask` label.
 *
 * MOVED HERE from `lib/trdd-store.ts`'s own private other-park-form helper (TRDD-4P798U6P). The
 * store needed the doctor's PARKED predicate (TRDD-CV5KDCB7 in `lib/trdd-doctor.ts`) inside
 * `advanceColumn`'s entry gate and could not import it for the same store->doctor cycle
 * reason `frontmatterDay` above states, so it re-derived a private copy of this half too.
 * Two copies of one predicate is exactly the shape `.claude/rules/lessons-verification.md`
 * warns about (a linter and its own `--fix` drifted apart this way): the doctor decides what
 * counts as parked when it LINTS, the store decides separately when it GATES entry into
 * `blocked`, and the first time a fourth park form is added to only one of the two copies,
 * the tool either refuses a park the lint would accept or accepts one the lint later flags.
 *
 * `todayDay` is a parameter rather than computed inside this function so every caller uses
 * the exact local calendar day it already computed for its own message or log line — this
 * function constructs no `Date` of its own, so there is only one `new Date()` per caller to
 * reason about, not two that could read a different instant.
 *
 * `parkReason` returns WHICH form holds (first match wins, in the order below) so a caller
 * that prints "parked because X" prints the reason this predicate decided on, instead of
 * re-deriving one from the same fields — a second copy of the inputs is the drift this
 * extraction exists to remove. `isParkedByOtherForm` is the boolean view of the same call.
 */
export type ParkReason = 'review-after' | 'hub-blocked' | 'fleet-ask'

export function parkReason(fm: Record<string, unknown>, todayDay: string): ParkReason | null {
  // NOT `asList`: that is the REFERENCE-field parser and drops every non-id token, so
  // `labels: [governance, fleet-ask]` reads as [] through it (measured: doctor test F5 red).
  const rawLabels = fm['labels']
  const labels = (Array.isArray(rawLabels)
    ? rawLabels.map(String)
    : String(rawLabels ?? '').replace(/^\s*\[|\]\s*$/g, '').split(','))
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
  const reviewAfter = frontmatterDay(fm['review-after'])
  if (reviewAfter !== '' && reviewAfter > todayDay) return 'review-after'
  if (labels.includes('hub-blocked')) return 'hub-blocked'
  if (labels.includes('fleet-ask')) return 'fleet-ask'
  return null
}

export function isParkedByOtherForm(fm: Record<string, unknown>, todayDay: string): boolean {
  return parkReason(fm, todayDay) !== null
}
