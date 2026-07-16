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
 * owner. Every other column (todo, design, dispatch, dev, testing, ai_review,
 * blocked, live_auditing, backburner) is a mechanical (EXEMPT-A) move any team
 * member may make.
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
])

/** The review columns a card exits when a verdict is rendered on it. */
export const REVIEW_COLUMNS: ReadonlySet<string> = new Set(['ai_review', 'human_review'])

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
  const movesToGoverned = targetStatus !== undefined && GOVERNED_TARGET_COLUMNS.has(targetStatus)
  const releaseEvidenceField = RELEASE_EVIDENCE_FIELDS.find((f) => f in req)

  // GATE 1 — a governed transition or a release-confirmation write needs
  // MANAGER-by-AID or the human owner (the NON-EXEMPT Y/Z sets).
  if (movesToGoverned || releaseEvidenceField) {
    if (!input.requesterIsManagerOrOwner) {
      const field = movesToGoverned ? 'status' : (releaseEvidenceField as string)
      const what = movesToGoverned ? `move a card to "${targetStatus}"` : `set ${field}`
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
