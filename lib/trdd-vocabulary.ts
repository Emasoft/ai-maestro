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

/** The 17 ratified kanban columns, plus the lifecycle values that bracket them. */
export const BRACKET_COLUMNS = ['proposal', 'planned', 'refused', 'completed', 'cancelled'] as const
export const VALID_COLUMNS: readonly string[] = [...DEFAULT_STATUSES, ...BRACKET_COLUMNS]

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
