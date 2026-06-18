/**
 * Portfolio token crypto binding (R28) — minted/verified with the HOST key.
 *
 * Rationale (why the host key, not the issuer's AID key): the server IS the
 * issuer-of-record. It verifies the issuer agent's AID identity + TITLE before
 * minting (portfolio-issue-guard.ts), so the signature only needs to attest
 * "this host minted this token". The host already owns the signed-ledger trust
 * root (host-keys.ts::signHostAttestation / getHostPublicKeyHex), and
 * verification reuses the same key-rotation-aware path the ledger uses
 * (verifyWithCurrentOrPrevious). R33 recovery is then trivial: on replay the
 * host can re-sign.
 *
 * Rejected alternative — issuer-AID-key signatures — would require persisting
 * and looking up the issuer's public key at every verify, break if the issuer
 * agent is later deleted, and duplicate host-attestation machinery for no gain.
 *
 * The canonical form omits the THREE post-issue-mutable fields
 * (`issuer_sig`, `ledger_seq`, `status`) and uses the same omit-when-absent
 * discipline as signed-ledger.ts so an optional field that is absent never
 * changes the signed bytes.
 */

import { signHostAttestation } from '@/lib/host-keys'
import { verifyWithCurrentOrPrevious } from '@/lib/key-rotation'
import type { PortfolioToken } from '@/types/portfolio'

/**
 * Deterministic JSON of every signed field of a token. Fields are emitted in
 * a FIXED order as a positional array (not an object) so the serialization is
 * stable regardless of key-insertion order. Optional fields are appended ONLY
 * when present (omit-when-absent) — an absent optional never alters the bytes,
 * exactly like the ledger's auth-trio handling.
 *
 * Excluded (post-issue mutations, must NOT be signed):
 *   issuer_sig, ledger_seq, status.
 */
export function canonicalPortfolioToken(
  token: PortfolioToken,
): string {
  const base: unknown[] = [
    token.token_id,
    token.kind,
    token.subject_agent_id,
    token.scope,
    token.issuer_agent_id,
    token.issuer_title,
    token.uses_remaining,
    token.issued_at,
    token.expires_at,
  ]
  // Optional pins / scoping / forward-compat — appended in a FIXED order as a
  // trailing object whose keys are present only when the field is set. The
  // object is added only when at least one optional is present, so a token
  // with no optionals serializes identically to the v0 positional array.
  const optional: Record<string, unknown> = {}
  if (token.target_agent_id !== undefined) optional.target_agent_id = token.target_agent_id
  if (token.target_team_id !== undefined) optional.target_team_id = token.target_team_id
  if (token.issuer_team_id !== undefined) optional.issuer_team_id = token.issuer_team_id
  if (token.attestation_ref !== undefined) optional.attestation_ref = token.attestation_ref
  if (Object.keys(optional).length > 0) {
    base.push(optional)
  }
  return JSON.stringify(base)
}

/**
 * Sign a token with the host key. Returns the base64 Ed25519 signature to
 * store in `token.issuer_sig`. The caller builds the token WITHOUT
 * issuer_sig/ledger_seq/status mattering (they are excluded from the canon).
 */
export function signPortfolioToken(token: PortfolioToken): string {
  return signHostAttestation(canonicalPortfolioToken(token))
}

/**
 * Verify a token's host signature (key-rotation aware). Returns true iff the
 * `issuer_sig` validates against the canonical bytes under the current OR the
 * retained previous host key. Any tampering with a signed field flips this to
 * false (the canon changes, the signature no longer matches).
 */
export function verifyPortfolioToken(token: PortfolioToken): boolean {
  if (!token.issuer_sig) return false
  try {
    return verifyWithCurrentOrPrevious(canonicalPortfolioToken(token), token.issuer_sig)
  } catch {
    return false
  }
}
