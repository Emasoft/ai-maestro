import type { JsonPatch } from './json-patch'

/**
 * LedgerOp — the taxonomy of recorded operations.
 *
 * The three legacy values (`create` / `update` / `delete`) are retained
 * for backward compatibility with ledger entries written before the
 * per-op extension (2026-04-20, TRDD-eac02238). New entries SHOULD use
 * the operation-specific names so a state-restore tool can replay
 * operations in order.
 *
 * The set is intentionally additive. `verify()` does NOT enum-check
 * `op` — it only validates hash chain + signature — so a newer ledger
 * file with an op the current binary doesn't know is still verifiable.
 * However, callers SHOULD stick to the declared taxonomy so that
 * external audit tools can group events.
 */
export type LedgerOp =
  // ── Legacy / generic (pre-extension) ─────────────────────────
  | 'create' | 'update' | 'delete'
  // ── Agent lifecycle ──────────────────────────────────────────
  | 'create_agent' | 'delete_agent'
  | 'change_title' | 'change_plugin' | 'change_client'
  | 'change_team' | 'change_name' | 'change_folder'
  | 'change_avatar' | 'change_cli_args' | 'change_model'
  | 'change_metadata'
  | 'install_element' | 'change_skill' | 'change_agent_def'
  | 'change_command' | 'change_rule' | 'change_output_style'
  | 'change_mcp' | 'change_lsp' | 'change_hook'
  | 'send_message'
  // ── R9.13 enforcement (TRDD-c7a81642) ────────────────────────
  | 'hibernate_role_missing' | 'hibernate_role_missing_at_boot'
  | 'wake' | 'hibernate'
  // ── Team lifecycle ───────────────────────────────────────────
  | 'create_team' | 'delete_team' | 'update_team'
  // ── Group lifecycle ──────────────────────────────────────────
  | 'create_group' | 'delete_group' | 'update_group'
  // ── Governance ───────────────────────────────────────────────
  | 'set_password' | 'set_manager' | 'set_user' | 'set_avatar'
  // ── Cemetery ─────────────────────────────────────────────────
  | 'archive_agent' | 'purge_cemetery'
  // ── Marketplace ──────────────────────────────────────────────
  | 'add_marketplace' | 'remove_marketplace' | 'update_marketplace'
  // ── System tracker (TRDD-7123d51a §9 follow-up, #242) ────────
  /**
   * Emitted by `lib/system-tracker.ts` when a client binary version
   * changes between scans. The diff carries { old, new, client } on a
   * path like `/system/clientVersions/<client>`.
   */
  | 'change_client_version'
  // ── Portfolio / secure-enclave tokens (R28) ──────────────────
  /**
   * The host-signed portfolio ledger chain (R34 anchor). `issue` records a
   * mint, `consume` a one-shot approval spend, `revoke` an explicit/cascade
   * revocation. Appended to a SEPARATE ledger (portfolios.ledger.json), never
   * the agent-registry ledger.
   */
  | 'issue_portfolio_token' | 'consume_portfolio_token' | 'revoke_portfolio_token'

/**
 * LedgerActor — who initiated the operation.
 *
 * - `user`   — human via UI (cookie-auth session).
 * - `agent`  — agent via API with AID proof-of-possession (Bearer token).
 * - `system` — internal (startup scan, PG04 auto-repair, subconscious tracker).
 */
export type LedgerActor = 'user' | 'agent' | 'system'

export interface LedgerEntry {
  seq: number
  ts: string
  prevHash: string
  op: LedgerOp
  path: string
  diff: JsonPatch
  signerHostId: string
  signerKeyFingerprint: string
  /**
   * Authorization context — optional, additive (TRDD-eac02238).
   *
   * Legacy v1 entries (written before 2026-04-20) do NOT carry these
   * fields. When absent, the field is OMITTED from the canonicalized
   * form so that old entries verify identically pre/post upgrade.
   *
   * `authAction` is a short machine-readable name of the authorization
   * check that passed (typically matches `op` but can differ for
   * higher-level pipelines that gate multiple ops).
   */
  authAction?: string
  /** The agent id that initiated this op (only set when authActor='agent'). */
  authAgentId?: string
  /** Who initiated the op — see {@link LedgerActor}. */
  authActor?: LedgerActor
  signature: string
}

/** Options for SignedLedger.append() — keeps call-site backward compatible. */
export interface AppendOptions {
  authAction?: string
  authAgentId?: string
  authActor?: LedgerActor
}

export interface LedgerFile {
  version: 1
  entries: LedgerEntry[]
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; seq: number; reason: string }

export interface LedgerStats {
  entryCount: number
  lastSeq: number
  lastTs: string
  rootHash: string
}
