/**
 * Human-user identity types (R36/R37/R38).
 *
 * AI Maestro distinguishes AGENTS (AI clients running in tmux, identified by a
 * `governanceTitle` of type AgentRole) from human USERS (people who drive the
 * web UI). Until the R36/R37/R38 user-authority model, the host modelled a
 * single anonymous web session. These types add a first-class user identity:
 *
 *  - Every user (native or foreign) has an AID (R36.1).
 *  - Exactly one user per host may hold the MAESTRO title — the sole admin
 *    (R36.2). The MAESTRO may appoint one MAESTRO-DELEGATE at a time, which
 *    SUSPENDS the MAESTRO while it acts (R37.2/R37.3).
 *  - Normal users are subordinate to MANAGER + COS, receive tasks via kanban,
 *    and may message only their own ASSISTANT, their own-team COS, and the
 *    MANAGER (R38).
 *
 * Storage: ~/.aimaestro/users.json (lib/user-registry.ts), mirroring the
 * team-registry file/lock/ledger pattern.
 */

/**
 * A user's authority title. ORTHOGONAL to AgentRole (which is for AI agents).
 *  - 'maestro'           — the sole host admin (R36.2). Exactly one per host.
 *  - 'maestro-delegate'  — a user the MAESTRO appointed; while it exists the
 *                          MAESTRO is suspended and its privileges pass here
 *                          (R37.2). At most one at a time.
 *  - 'user'              — a normal (non-MAESTRO) user, subordinate to
 *                          MANAGER + COS (R38).
 */
export type UserTitle = 'maestro' | 'maestro-delegate' | 'user'

/** Record for a single human user, stored in ~/.aimaestro/users.json. */
export interface UserRecord {
  /** Stable UUID for this user. */
  id: string
  /** The user's AID public-key fingerprint / identifier (R36.1). */
  aid: string
  /** Display name. */
  name: string
  /** Optional avatar identifier (AvatarPicker value, /public path, or URL). */
  avatar?: string
  /** Authority title (R36/R37). */
  title: UserTitle
  /** True when this user was registered on THIS host; false when foreign (R35/R40). */
  native: boolean
  /** For a foreign user, the host id where it originates. Absent for native users. */
  homeHostId?: string
  /**
   * Argon2/bcrypt hash of THIS user's own sudo password (R37.4). The migrated
   * first MAESTRO copies the legacy global governance.passwordHash here so the
   * one global password keeps working under the per-user sudo model.
   */
  passwordHash: string | null
  /** ISO timestamp when passwordHash was last set. */
  passwordSetAt: string | null
  /**
   * The id of this user's bound ASSISTANT agent (R39.1). null for the MAESTRO
   * (which uses the MANAGER agent and has no ASSISTANT — R39.1), and null until
   * the ASSISTANT is created (sibling TRDD R39 Phase B).
   */
  assistantAgentId: string | null
  /**
   * ISO timestamp when a foreign user's AID was approved by this host's MAESTRO
   * (R35.2/R40.1). Absent → an unapproved foreign user, whose AID is refused.
   * Native users do not need approval.
   */
  approvedByMaestroAt?: string
  /** ISO timestamp when the record was created. */
  createdAt: string
  /** ISO timestamp when soft-deleted (cemetery model, R39.6). Absent → active. */
  deletedAt?: string
}

/** On-disk file format for the user registry. */
export interface UsersFile {
  /** Strict discriminant for future schema migrations. */
  version: 1
  users: UserRecord[]
}
