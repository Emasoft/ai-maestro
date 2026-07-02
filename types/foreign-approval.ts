/**
 * Foreign Approval types (R34.2 / R35 / R40).
 *
 * When an agent or user from ANOTHER host wants its AID accepted on this host,
 * its import/registration is NOT auto-accepted. Instead a pending
 * ForeignApprovalEntry is enqueued in ~/.aimaestro/foreign-approvals.json, and
 * this host's MAESTRO must approve it via the UI WITH the sudo password (R35.2).
 * On approval the host re-issues a FRESH native AID for the agent (discarding
 * the foreign key, R34.2) and records aid_reissue + aid_associate +
 * aid_approve_foreign in the signed ledger (which thereafter validates the AID).
 *
 * The file is ledger-tracked exactly like humans.json — see
 * lib/foreign-approval-registry.ts.
 */

/** What kind of foreign principal is awaiting approval. */
export type ForeignApprovalKind = 'agent' | 'user'

/** Decision state of a foreign-approval request. */
export type ForeignApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ForeignApprovalEntry {
  /** Stable id: `${fingerprint}@${sourceHostId}` */
  id: string
  /** The foreign AID fingerprint that requested acceptance. */
  fingerprint: string
  /** Whether this is a foreign agent or a foreign user. */
  kind: ForeignApprovalKind
  /** The host id the foreign principal originates from. */
  sourceHostId: string
  /** Display name for the approval UI. */
  displayName: string
  /** Decision state. */
  status: ForeignApprovalStatus
  /** ISO 8601 timestamp when the request was enqueued. */
  requestedAt: string
  /** ISO 8601 timestamp when the MAESTRO decided. Absent while pending. */
  decidedAt?: string
  /** System-owner / MAESTRO marker recorded on decision. */
  decidedBy?: string
  /**
   * For kind:'agent' — the staged ZIP path under ~/.aimaestro/tmp holding the
   * foreign export. Consumed (materialized + deleted) on approval; deleted on
   * reject. NO keys are imported until approval.
   */
  importPayloadPath?: string
  /** The local agent id created on approval (kind:'agent'). */
  newAgentId?: string
  /** The freshly re-issued NATIVE AID fingerprint minted on approval (R34.2). */
  newFingerprint?: string
  /**
   * R40.2 — for kind:'user', the per-command allowlist the MAESTRO granted this
   * foreign user. v1 restrictable set is {create_agent, create_team}. Absent or
   * empty → the foreign user may call NO restrictable command.
   */
  grantedCommands?: string[]
}

export interface ForeignApprovalFile {
  version: 1
  entries: ForeignApprovalEntry[]
}

const VALID_KINDS: ReadonlySet<string> = new Set(['agent', 'user'])
const VALID_STATUSES: ReadonlySet<string> = new Set(['pending', 'approved', 'rejected'])

/**
 * Runtime type guard for a single ForeignApprovalEntry. Returns true only when
 * every required field is present and well-typed.
 */
export function isValidForeignApprovalEntry(value: unknown): value is ForeignApprovalEntry {
  if (value === null || value === undefined || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0) return false
  if (typeof obj.fingerprint !== 'string' || obj.fingerprint.length === 0) return false
  if (typeof obj.kind !== 'string' || !VALID_KINDS.has(obj.kind)) return false
  if (typeof obj.sourceHostId !== 'string' || obj.sourceHostId.length === 0) return false
  if (typeof obj.displayName !== 'string') return false
  if (typeof obj.status !== 'string' || !VALID_STATUSES.has(obj.status)) return false
  if (typeof obj.requestedAt !== 'string' || obj.requestedAt.length === 0) return false
  return true
}

/**
 * Runtime type guard for the on-disk ForeignApprovalFile. Mirrors the
 * isHumanDirectoryFile / isValidHumanEntry pattern.
 */
export function isForeignApprovalFile(value: unknown): value is ForeignApprovalFile {
  if (value === null || value === undefined || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (obj.version !== 1) return false
  if (!Array.isArray(obj.entries)) return false
  return obj.entries.every(isValidForeignApprovalEntry)
}
