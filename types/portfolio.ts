/**
 * Portfolio / secure-enclave token model (R28).
 *
 * The portfolio is a per-agent, server-stored "secure enclave" holding the
 * approval and mandate tokens that constitute the THIRD authorization check —
 * after (1) AID identity and (2) TITLE privilege. A privileged operation is
 * "fulfilled only if all three pass" (R28.3).
 *
 * Two token kinds:
 *  - `approval` — ONE-SHOT authority for a single privileged operation
 *    (uses_remaining = 1, consumed after the op's side effect persists).
 *  - `mandate`  — STANDING authority over a scope for a bounded window
 *    (uses_remaining = null, never consumed, only checked), e.g. the R30
 *    team-creation mandate a MANAGER grants a COS.
 *
 * Scope grammar reuses the IBCT `resource:action` form (see
 * lib/ibct-scope-check.ts) so the verifier shares one normalizer
 * (`agent:create`, `team:create`, wildcard `agent:*`).
 *
 * R34 anti-forgery: a token's JSON record alone is NOT trusted. It must be
 * ledger-anchored — `ledger_seq` resolves to an `issue_portfolio_token` entry
 * in the host-signed portfolio ledger. A token written straight to the file
 * with no chained, host-signed ledger entry is refused.
 */

/** A portfolio token is either a one-shot approval or a standing mandate. */
export type PortfolioTokenKind = 'approval' | 'mandate'

/**
 * The issuer of a portfolio token is always a governance authority.
 *
 * `user` is the HUMAN OWNER (the dashboard / system-owner path). It is on the
 * ladder above `manager` and no agent can ever hold it — which is what makes a
 * USER-reserved decision unforgeable by the whole fleet, MANAGER included. It has
 * to be here: without it, a token minted by the human owner would record
 * `manager`, and a `user`-tier card approved by the owner would then verify as
 * "issuer authority below what this card requires" — the one approval that must
 * always hold, failing.
 */
export type PortfolioIssuerTitle = 'manager' | 'chief-of-staff' | 'user'

/**
 * The reserved `issuer_agent_id` of a token minted by the HUMAN OWNER, who has no
 * agent record.
 *
 * The issuer re-check (portfolio-check.issuerStillValid) exists to kill a token
 * whose issuer was DEMOTED. The human owner has no title to lose and no registry
 * row to look up, so a naive lookup finds nothing and denies — which would mean
 * the owner's own approvals could never verify. This sentinel is what that check
 * recognizes instead. It is not a hole: forging it requires forging the host's
 * Ed25519 signature over the token, which is exactly what a forger cannot do.
 */
export const SYSTEM_OWNER_ISSUER = 'system-owner'

/** Lifecycle status of a token record. */
export type PortfolioTokenStatus = 'active' | 'consumed' | 'revoked' | 'expired'

export interface PortfolioToken {
  /** Public handle for revoke / audit / ledger cross-reference (UUID). */
  token_id: string
  kind: PortfolioTokenKind
  /** The empowered agent = portfolio owner (whose enclave stores this token). */
  subject_agent_id: string
  /**
   * Required scope in IBCT `resource:action` form, e.g. `agent:create`.
   * `*:*` or `resource:*` wildcards are honored by the same normalizer the
   * IBCT scope check uses.
   */
  scope: string
  /** Approval tokens MAY pin a single target agent. */
  target_agent_id?: string
  /** Approval tokens MAY pin a single target team. */
  target_team_id?: string
  /**
   * Approval/mandate tokens MAY pin a single TRDD (`trdd-id`, 8-char base36).
   * This is what makes a TRDD approval verifiable: the token says "the authority
   * that signed me approved THIS card", so a forged `## Approval log` line on a
   * different card cannot borrow it. Omitted when absent (omit-when-absent
   * canonicalization), so every pre-existing token's signed bytes are unchanged.
   */
  target_trdd_id?: string
  /** The agent that minted this token. */
  issuer_agent_id: string
  /** The issuer's governance title AT MINT TIME. */
  issuer_title: PortfolioIssuerTitle
  /** For COS mandates: the team whose membership the mandate is scoped to. */
  issuer_team_id?: string
  /** Approval = 1 (one-shot); mandate = null (unlimited until expiry/revoke). */
  uses_remaining: number | null
  /** ISO 8601 mint timestamp. */
  issued_at: string
  /** ISO 8601 expiry, or null for never-expires (revoke-only). */
  expires_at: string | null
  /** Ed25519 host signature over canonicalPortfolioToken(token) (base64). */
  issuer_sig: string
  /** R34 ledger anchor — seq of the `issue_portfolio_token` entry. */
  ledger_seq: number | null
  status: PortfolioTokenStatus
  /**
   * RESERVED (forward-compat with the deferred code-signing layer). Binds a
   * mandate to a signed-artifact digest so it cannot be replayed against
   * tampered code. Omitted entirely when absent (omit-when-absent
   * canonicalization). Reserving it now avoids a later token-schema migration.
   */
  attestation_ref?: string
}

/** A subject agent's entire portfolio = all the tokens stored in its enclave. */
export interface AgentPortfolio {
  agent_id: string
  tokens: PortfolioToken[]
  updated_at: string
}
