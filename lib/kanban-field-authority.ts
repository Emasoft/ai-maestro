/**
 * Kanban field-write authority (ai-maestro#47 verb 3).
 *
 * The team-kanban PUT (`/api/teams/[id]/tasks/[taskId]`) is the ONE endpoint both
 * `amp-kanban-move` (status only) and `amp-kanban-edit` (arbitrary field bag) hit.
 * Team membership (`checkTeamAccess`) is enforced in the service and is unchanged.
 * What was MISSING — and what an agent could exploit through `amp-kanban-edit` —
 * is per-field JUDGMENT authority: nothing stopped a MEMBER from writing
 * `reviewResult=pass` on its OWN card, or moving a card straight to `published`,
 * forging a decision that belongs to another authority using only its own AID.
 *
 * This gate ENFORCES, at the write layer, governance that is ALREADY ratified —
 * the Part B2 transition-authority table plus the NON-EXEMPT Y (release) / Z
 * (escalation) transition sets in `aimaestro-manager-approval-defaults.md`. It
 * invents no rule; it stops a field-write from smuggling a governed transition
 * past those.
 *
 * PURE by design: the route resolves the caller's authority (a single
 * `authorize(auth, 'manage-team')` — MANAGER-by-AID or the human owner) and the
 * card's current state, and passes primitives in. That keeps the MAPPING (which
 * field needs which authority) in one testable place with zero mocking.
 */

/**
 * Status columns whose ENTRY is a governed (NON-EXEMPT) transition — release,
 * escalation, and the terminal decisions. Moving a card INTO one of these, or
 * writing a release-confirmation field, requires MANAGER-by-AID or the human
 * owner. Every other column (backburner, approval, design_ai_review, todo,
 * verify_assumptions, plan, dispatch, dev, testing, ai_review, blocked,
 * live_auditing) is a mechanical (EXEMPT-A) move any team member may make.
 */
export const GOVERNED_TARGET_COLUMNS: ReadonlySet<string> = new Set([
  'human_review', // escalation to USER (Z)
  'complete',     // review verdict accepted (Z) — only ever reached from a review column
  'publish',      // release pipeline entry (Y)
  'deploy',       // release pipeline entry (Y)
  'published',    // release confirmed (Y)
  'live',         // release confirmed (Y)
  'failed',       // permanent-abandon decision (Y)
  'superseded',   // force-supersede (Y)
  // --- 3.0.0 (PRRD G4.1 / G6.1 / G7.1) ---
  // Entering `design` IS the approval verdict: `approval → design` is the COS/MANAGER saying
  // yes (PRRD G4.1), and the only other way in is a design reviewer rejecting back down —
  // also COS/MANAGER. Both hands are governed, so the target is. Without this the approval
  // column the USER just ratified would be a label any member could move a card past, i.e.
  // a gate that exists only in prose.
  'design',
  // Escalation to the human, structurally identical to `human_review` (PRRD G7.1) — and
  // SKIPPED entirely when min-approval-requirement is none, which is a routing decision
  // upstream of this gate, not a licence to enter it unauthorized.
  'design_human_review',
])

/**
 * Governed BACKWARD transitions INTO `dev` (ai-maestro#74 BYPASS 2). `dev` is a mechanical
 * (EXEMPT) target for FORWARD work, so it is deliberately ABSENT from GOVERNED_TARGET_COLUMNS —
 * but two BACKWARD moves into `dev` are NON-EXEMPT and were leaking past both gates:
 *   - human_review → dev — the `|dev` half of the Z escalation set (un-escalating a USER review)
 *   - live_auditing → dev — the Y set (pulling a live-soaking service back to dev)
 * Both require MANAGER-by-AID or the human owner. Because the danger is the SOURCE column, the
 * gate keys these off `currentStatus`, not the target — a target-only check (GOVERNED_TARGET_COLUMNS)
 * structurally cannot see them, which is exactly why the hole existed.
 */
const GOVERNED_BACKWARD_TO_DEV: ReadonlySet<string> = new Set(['human_review', 'live_auditing'])

/** The review columns a card exits when a verdict is rendered on it. */
export const REVIEW_COLUMNS: ReadonlySet<string> = new Set(['ai_review', 'human_review'])

/**
 * The DESIGN-stage review columns (3P-KAN-18) — a separate concern from REVIEW_COLUMNS:
 * they gate a `design_ai_review`/`design_human_review` → `design` return-edge or a
 * → `todo` advance, never the `→ complete` verdict GATE 2 reasons about. Deliberately
 * NOT merged into REVIEW_COLUMNS so GATE 2's self-judgment ban stays scoped to the
 * dev-stage review columns it was written for.
 */
export const DESIGN_REVIEW_COLUMNS: ReadonlySet<string> = new Set(['design_ai_review', 'design_human_review'])

/**
 * The column ids BOTH gates structurally depend on (ai-maestro#74 — the enum hard-lock residual,
 * resolved as Option C).
 *
 * A team may define a custom `kanbanConfig`, and `validStatusesForTeam` then accepts ONLY that
 * team's ids. So if a custom board RENAMED or OMITTED one of these, the predicate that guards the
 * corresponding governed transition could never match, and that transition would silently become
 * UNGATED for that team — e.g. renaming `human_review`→`boss-check` and `complete`→`done` disables
 * the GATE 2 self-review ban outright, because neither id is in REVIEW_COLUMNS /
 * GOVERNED_TARGET_COLUMNS any more. The gate would still "run"; it just could never fire.
 *
 * `setKanbanConfig` therefore REQUIRES a custom set to still contain every id here. Teams keep full
 * freedom to ADD columns and to rename/omit the NON-governed ones (backburner, approval, todo,
 * verify_assumptions, plan, dispatch, testing, blocked).
 * This is derived from the gate's OWN sets rather than re-listed, so a future change to what is
 * governed updates the config check automatically — the two cannot drift.
 */
export const GATE_CRITICAL_COLUMN_IDS: ReadonlySet<string> = new Set<string>([
  ...Array.from(GOVERNED_TARGET_COLUMNS),
  ...Array.from(GOVERNED_BACKWARD_TO_DEV),
  ...Array.from(REVIEW_COLUMNS),
  // `design_ai_review` is not a governed TARGET (the designer submits into it, mechanically),
  // but the design-review return-edge and escalation predicates key on the id, so a board that
  // renamed it would leave them unmatchable — the same hole ai-maestro#74 closed for the
  // dev-stage review columns. Spread the set rather than re-listing, so the two cannot drift.
  ...Array.from(DESIGN_REVIEW_COLUMNS),
  'dev', // the TARGET half of the governed backward moves (human_review|live_auditing → dev)
])

/** Release-confirmation fields — writing one asserts a release authority's action. */
const RELEASE_EVIDENCE_FIELDS = ['publishedVersion', 'liveSince'] as const

export interface KanbanFieldAuthzInput {
  /** The caller's agent id, or undefined for the human/system-owner (dashboard). */
  requesterAgentId: string | undefined
  /**
   * Whether the caller passes `authorize(auth, 'manage-team')` — i.e. is a
   * MANAGER (by AID) or the human system-owner. Resolved by the route so this
   * function stays pure and needs no registry access.
   */
  requesterIsManagerOrOwner: boolean
  /** The card's column BEFORE this write (needed to detect a review-exit). */
  currentStatus: string | undefined
  /** The card's assignee — the agent whose work a verdict would judge. */
  assigneeAgentId: string | null | undefined
  /** The fields being written (only the presence/value of gate fields matters). */
  requested: Record<string, unknown>
}

export interface KanbanFieldAuthzError {
  error: string
  status: 403
  field: string
}

/**
 * True if the write touches any field this gate reasons about. Lets the route
 * skip loading the card's current state for ordinary edits (subject, priority,
 * labels, …) — those keep the team-access ACL as their only gate.
 */
export function touchesGateField(requested: Record<string, unknown>): boolean {
  return (
    'status' in requested ||
    'reviewResult' in requested ||
    RELEASE_EVIDENCE_FIELDS.some((f) => f in requested)
  )
}

/**
 * Returns a 403 error when the write is not authorized, or null when it may
 * proceed. The system-owner (no agent id) is always allowed — the human is the
 * ultimate authority and bypasses both gates.
 */
export function authorizeKanbanFieldWrite(input: KanbanFieldAuthzInput): KanbanFieldAuthzError | null {
  // The human / dashboard has no agent id — ultimate authority, no gate.
  if (input.requesterAgentId === undefined) return null

  const req = input.requested
  const targetStatus = typeof req.status === 'string' ? req.status : undefined
  // A governed FORWARD entry — release / escalation / terminal (GOVERNED_TARGET_COLUMNS)…
  const movesToGovernedColumn = targetStatus !== undefined && GOVERNED_TARGET_COLUMNS.has(targetStatus)
  // …OR a governed BACKWARD un-escalation into `dev` (ai-maestro#74 BYPASS 2). `dev` is not a
  // governed TARGET, so this is keyed off the SOURCE column — the only place the danger is visible.
  const movesBackwardToDev =
    targetStatus === 'dev' &&
    input.currentStatus !== undefined &&
    GOVERNED_BACKWARD_TO_DEV.has(input.currentStatus)
  const movesToGoverned = movesToGovernedColumn || movesBackwardToDev
  const releaseEvidenceField = RELEASE_EVIDENCE_FIELDS.find((f) => f in req)

  // GATE 1 — a governed transition or a release-confirmation write needs
  // MANAGER-by-AID or the human owner (the NON-EXEMPT Y/Z sets).
  if (movesToGoverned || releaseEvidenceField) {
    if (!input.requesterIsManagerOrOwner) {
      const field = movesToGoverned ? 'status' : (releaseEvidenceField as string)
      const what = movesBackwardToDev
        ? `move a card from "${input.currentStatus}" back to dev`
        : movesToGovernedColumn
          ? `move a card to "${targetStatus}"`
          : `set ${field}`
      return {
        error: `Only a MANAGER (by AID) or the human owner may ${what} — it is a governed transition (NON-EXEMPT).`,
        status: 403,
        field,
      }
    }
  }

  // GATE 2 — self-judgment ban: an agent may not render a review VERDICT on a
  // card it is assigned to. A verdict is writing reviewResult, or moving a card
  // out of a review column into `complete`. A different agent of ANY title may
  // review someone else's card — only self-review is refused, which is exactly
  // "an agent cannot set another authority's judgment on its own AID".
  const writesReviewResult = 'reviewResult' in req
  const acceptsReview =
    targetStatus === 'complete' &&
    input.currentStatus !== undefined &&
    REVIEW_COLUMNS.has(input.currentStatus)
  const rendersVerdict = writesReviewResult || acceptsReview
  if (rendersVerdict && input.assigneeAgentId && input.requesterAgentId === input.assigneeAgentId) {
    return {
      error:
        'An agent cannot render a review verdict on a card it is assigned to (no judging your own work).',
      status: 403,
      field: writesReviewResult ? 'reviewResult' : 'status',
    }
  }

  return null
}
