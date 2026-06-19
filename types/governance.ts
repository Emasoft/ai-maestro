/**
 * Team Governance types
 *
 * Defines open/closed team types, governance configuration,
 * and role-based access control for team messaging isolation.
 */

import type { AgentRole } from './agent'
import type { TeamType } from './team'

// Re-export TeamType from its canonical location in types/team.ts
export type { TeamType } from './team'

/**
 * GovernanceTitle is the governance-level title: 'manager' | 'chief-of-staff' | 'architect' | 'orchestrator' | 'integrator' | 'member' | 'autonomous' | 'maintainer'.
 * Canonical definition lives in types/agent.ts (AgentRole — the underlying type).
 * This alias provides governance-domain semantics. "Title" distinguishes governance
 * levels from "Role" which refers to role-plugins (specializations like ai-maestro-architect).
 */
export type GovernanceTitle = AgentRole
/** @deprecated Use GovernanceTitle instead */
export type GovernanceRole = GovernanceTitle

/** Governance configuration stored at ~/.aimaestro/governance.json */
export interface GovernanceConfig {
  // Strict discriminant for future schema migrations
  version: 1
  passwordHash: string | null   // bcrypt hash of governance password, null = not set
  passwordSetAt: string | null  // ISO timestamp when password was last set
  managerId: string | null      // Agent UUID of the singleton MANAGER role
  userName?: string             // Display name for the local user (auto-generated on first load if absent)
  /** Avatar identifier for the local user (AvatarPicker value, /public path, or URL) */
  userAvatar?: string
  /**
   * R36/R37/R38 user-authority model master switch (TRDD decision D3).
   *
   * DEFAULT (false / absent): the host behaves EXACTLY as before this model
   * shipped — a single anonymous web session is the system owner, the
   * comm-graph treats the human as one full-`Y` node, sudo verifies the single
   * global governance password. The MAESTRO / MAESTRO-DELEGATE / user entities
   * and the R38.2 comm-graph restrictions are completely INERT.
   *
   * true: the new model activates — `isSystemOwner` becomes "active MAESTRO",
   * the comm-graph fails closed for unresolved user senders and enforces the
   * non-MAESTRO restrictions (R38.2), sudo verifies the acting user's own
   * password (R37.4), and a single MAESTRO-DELEGATE may suspend the MAESTRO.
   *
   * This flag is the ONLY thing that gates every breaking behavior change in
   * the user-authority model; it is what lets the model ship without
   * destabilizing the running single-operator deployment.
   */
  userAuthorityModelEnabled?: boolean
  /** R36/R37: id of the MAESTRO user (set by the one-shot user migration). null = not migrated. */
  maestroUserId?: string | null
  /** R37.2: id of the currently-acting MAESTRO-DELEGATE user, or null when none. */
  maestroDelegateUserId?: string | null
}

/** Default governance config for first-time initialization */
export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  version: 1,
  passwordHash: null,
  passwordSetAt: null,
  managerId: null,
  userAuthorityModelEnabled: false,
  maestroUserId: null,
  maestroDelegateUserId: null,
}

/** Status of a team transfer request */
export type TransferRequestStatus = 'pending' | 'approved' | 'rejected'

/** A request to transfer an agent from one closed team to another */
export interface TransferRequest {
  id: string                        // UUID
  agentId: string                   // Agent being transferred
  fromTeamId: string                // Source closed team
  toTeamId: string                  // Destination team
  requestedBy: string               // Agent UUID of who initiated the transfer
  status: TransferRequestStatus
  createdAt: string                 // ISO timestamp
  resolvedAt?: string               // ISO timestamp when approved/rejected
  resolvedBy?: string               // Agent UUID of COS who approved/rejected
  note?: string                     // Optional note from requester
  rejectReason?: string             // Optional reason for rejection
}

/** File format for transfer requests storage */
export interface TransfersFile {
  // Strict discriminant for future schema migrations
  version: 1
  requests: TransferRequest[]
}

// ─── Multi-Host Governance (Layer 1: State Replication) ────────────────────

/** Types of governance state changes that get broadcast to mesh peers */
export type GovernanceSyncType = 'manager-changed' | 'team-updated' | 'team-deleted' | 'transfer-update'

/** Message payload sent between hosts for governance state synchronization */
export interface GovernanceSyncMessage {
  type: GovernanceSyncType
  fromHostId: string
  timestamp: string          // ISO — used for conflict ordering
  // Phase 2 backlog: Refactor to discriminated union keyed on `type` (e.g., ManagerChangedPayload | TeamUpdatedPayload)
  // to enforce payload shape at the type level instead of relying on runtime checks.
  // Tracked as Phase 2 tech debt (see NT-038).
  payload: Record<string, unknown>  // type-specific data; untyped until Phase 2 discriminated union refactor
}

/** Summary of a team as seen from a peer host (subset of Team) */
export interface PeerTeamSummary {
  id: string
  name: string
  type: TeamType
  chiefOfStaffId: string | null
  agentIds: string[]
}

/** Cached governance state from a single peer host */
export interface GovernancePeerState {
  hostId: string
  managerId: string | null
  managerName: string | null
  teams: PeerTeamSummary[]
  lastSyncAt: string         // ISO — when this peer last sent us an update
  ttl: number                // Seconds before this data is considered stale (default 300)
}

// ─── Cross-Host Role Attestation (Layer 2) ──────────────────────────────────

/** Signed role attestation for cross-host mesh messages */
export interface HostAttestation {
  role: AgentRole
  agentId: string
  hostId: string
  timestamp: string  // ISO
  signature: string  // base64
  recipientHostId?: string  // Binds attestation to intended recipient, prevents cross-target replay
}
