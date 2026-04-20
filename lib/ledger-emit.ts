/**
 * Ledger emit helpers — Phase 1.0.A of TRDD-eac02238.
 *
 * Bridges element-management-service's Change*, Create*, Delete*, and
 * Install* pipelines to the signed ledger so each operation gets a
 * discrete per-op audit entry (in addition to the coarse save-level
 * entry emitted by lib/agent-registry.ts::saveAgents() and friends).
 *
 * DESIGN
 * ------
 * - Each Change* function in element-management-service calls
 *   `emitAgentOp()` (or the matching helper for teams/groups/
 *   governance) AFTER its gates pass and AFTER the underlying
 *   registry mutation has been persisted. The emit is fire-and-forget
 *   to avoid nested-lock contention and to match the existing
 *   save-level policy (see lib/agent-registry.ts:246).
 * - The diff passed in should be scoped to the actual field(s)
 *   changed by the operation — NOT the full registry. This is what
 *   makes per-op entries more useful than save-level entries for
 *   state-restore replay (see TRDD-eac02238-derived #233).
 * - When the AuthContext is available, the caller MUST pass it so
 *   authAction/authAgentId/authActor fields are included on the
 *   ledger entry. System-initiated operations (startup scans,
 *   PG04 auto-repair) pass `authActor: 'system'`.
 *
 * FAILURES
 * --------
 * Per TRDD §5, `append()` is called without await. If the ledger
 * append fails (disk full, chain break, crypto error), the error
 * is logged to the console with the `AUDIT GAP` prefix. A future
 * follow-up (TRDD-eac02238-derived #234) surfaces these as a UI
 * banner in Settings → Diagnostics.
 */

import type { JsonPatch } from '@/types/json-patch'
import type { LedgerOp, LedgerActor } from '@/types/ledger'
import { registryLedger } from '@/lib/agent-registry'

/** Authorization source hints that map to LedgerActor. */
export interface EmitAuthContext {
  /** When present, the authorization action that was evaluated (e.g. 'change-title'). */
  action?: string
  /** When present, the agent that initiated the op (AID-authenticated calls only). */
  agentId?: string | null
  /** Who initiated the op. Pass 'system' for internal/auto-repair paths. */
  actor?: LedgerActor
}

/**
 * Emit a per-operation ledger entry against agents/registry.json.
 *
 * Fire-and-forget — the caller should NOT await this. Errors are
 * logged; the calling Change* function still succeeds.
 *
 * @param op        — operation name from the extended LedgerOp taxonomy
 * @param diff      — JSON-patch of the specific field(s) this op changed
 * @param auth      — optional authorization context for audit trail
 */
export function emitAgentOp(
  op: LedgerOp,
  diff: JsonPatch,
  auth?: EmitAuthContext,
): void {
  const opts = auth
    ? {
        authAction: auth.action,
        authAgentId: auth.agentId ?? undefined,
        authActor: auth.actor,
      }
    : undefined
  registryLedger
    .append(op, 'agents/registry.json', diff, opts)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ledger-emit] AUDIT GAP: ${op} on agents/registry.json NOT recorded: ${msg}`)
    })
}
