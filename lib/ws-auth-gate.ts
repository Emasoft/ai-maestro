import { authenticateFromRequestAsync } from './agent-auth'

/**
 * Deep-validate a WebSocket upgrade request's credentials BEFORE attaching a
 * PTY or opening a privileged socket.
 *
 * WHY (SF3 / TRDD-f1d89143): server.mjs's pre-handshake upgrade gate
 * (`wsHasCredential`) checks the Bearer on PRESENCE/SHAPE only — a forged-shape
 * `Bearer aim_tk_AAAA…` clears it, and the `/term` connection handler
 * previously validated only the session NAME, so a forged bearer reached
 * terminal read/write on any `?name=` session. This reuses the canonical
 * `authenticateFromRequestAsync` (cookie + every bearer class: `aim_tk_` AID,
 * `amp_live_sk_` AMP key, `mst_` session secret, `eyJ` IBCT JWT) instead of
 * re-implementing token parsing (SSOT — TRDD invariant).
 *
 * SAFE AT THE CONNECTION HANDLER: `validateGovernanceToken`, `validateApiKey`,
 * and `validateSessionSecret` are all PURE READS (non-consuming), so calling
 * this here does NOT consume a one-shot AID token before its real downstream
 * consumer — the exact concern that made TRDD-ba9d6df2 defer a gate-level deep
 * check. Fail-closed: any auth error (or a thrown validator) → not authorized.
 *
 * @param headers Node `IncomingMessage.headers` (lowercased keys).
 */
export async function isWsRequestAuthorized(
  headers: Record<string, string | string[] | undefined> | undefined | null,
): Promise<boolean> {
  if (!headers) return false
  const get = (name: string): string | null => {
    const v = headers[name.toLowerCase()]
    if (v == null) return null
    return Array.isArray(v) ? v.join(', ') : v
  }
  try {
    const res = await authenticateFromRequestAsync({ headers: { get } })
    return !res.error
  } catch {
    // Fail closed — a validator that throws must never grant access.
    return false
  }
}
