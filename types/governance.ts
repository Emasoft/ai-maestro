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

/**
 * Resolved SMTP submission settings for the recovery email (TRDD-P7XKV3N9) — NON-secret.
 * The app-password is stored separately in the OS credential store (lib/smtp-credential),
 * NEVER here. Structurally mirrors lib/smtp-autodetect SmtpConfig; kept in types/ to avoid
 * a types→lib import.
 */
export interface RecoverySmtpConfig {
  host: string
  port: number
  secure: boolean // true = implicit TLS (465); false = STARTTLS (587)
  usernameFormat: 'full' | 'local'
  /**
   * The explicit SMTP login id, when the MAESTRO entered one (TRDD-P7XKV3N9). Some
   * providers authenticate with a userid that is NEITHER the full email nor its
   * local-part, so `usernameFormat` cannot derive it. When present it is used verbatim
   * at both verify and send time (see resolveAuthUser); absent ⇒ derive from
   * usernameFormat (backward-compatible with configs stored before this field existed).
   */
  username?: string
}

/** Governance configuration stored at ~/.aimaestro/governance.json */
export interface GovernanceConfig {
  // Strict discriminant for future schema migrations
  version: 1
  passwordHash: string | null   // bcrypt hash of governance password, null = not set
  passwordSetAt: string | null  // ISO timestamp when password was last set
  /**
   * ISO timestamp of a deliberate invalidation (TRDD-P7XKV3N9), else null.
   *
   * Set together with `passwordHash: null` — the hash is DESTROYED, not flagged,
   * so no code path that checks only `passwordHash` can accidentally keep
   * honouring a credential the owner revoked. This field is what distinguishes
   * "never had a password" from "had one, and it was revoked", which is the
   * difference between first-run setup and a forced rotation.
   *
   * Cleared by setPassword().
   */
  passwordInvalidatedAt?: string | null
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
  /**
   * Recovery email (TRDD-P7XKV3N9) — the address a password-reset 2FA code is sent to so a
   * REMOTE device (iPad/iPhone) can recover when console presence isn't available. Non-secret.
   * The SMTP app-password is NOT here — it lives in the OS credential store, independent of
   * the governance password the reset flow may be resetting. null/absent = not configured.
   */
  recoveryEmail?: string | null
  /** ISO timestamp when recoveryEmail was proven via a received 2FA code, else null. */
  recoveryEmailVerifiedAt?: string | null
  /** Resolved SMTP settings for recoveryEmail (from autodetect). null when unconfigured. */
  recoverySmtp?: RecoverySmtpConfig | null
  /**
   * R16/TRDD-7U927FCM: the owner explicitly chose to rely on console/passkey recovery
   * INSTEAD of a recovery email at first-run. Set true when they take the "use
   * console/passkey instead" opt-out on the required-recovery gate. Together with a verified
   * recoveryEmail it is what makes recovery setup "complete" so the gate stops blocking app
   * entry — never a hard block that locks the owner out on a host with no reachable SMTP.
   * null/absent = not opted out.
   */
  recoveryOptOut?: boolean
  /**
   * TRDD-A9335BZ6 — the dev-mode login credential, so development continues
   * while the owner is away. Absent/null = never configured.
   *
   * This is where the ENABLE SWITCH lives, deliberately: it is dashboard-owned
   * rather than an `AI_MAESTRO_DEV_MODE` env var, because a bare env read that
   * can weaken authentication is the pattern TRDD-CC9PY337 deletes rather than
   * gates (a same-UID agent can `export` one into ~/.zshrc). Do not add such a
   * read — `tests/unit/test-only-env.test.ts` fences it.
   */
  devModeLogin?: DevModeLoginConfig | null
}

/** TRDD-A9335BZ6. Owner-minted dev-login credential; see `lib/dev-mode-token.ts`. */
export interface DevModeLoginConfig {
  /** The dashboard-owned switch. False ⇒ even a correct token is refused. */
  enabled: boolean
  /** SHA-256 hex of the token. The plaintext is never stored — it is shown once at mint. */
  tokenHash: string | null
  createdAt: string | null
  lastUsedAt: string | null
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
