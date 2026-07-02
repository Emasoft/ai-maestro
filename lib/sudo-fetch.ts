/**
 * sudoFetch — a drop-in fetch wrapper that transparently handles the
 * sudo-mode 403 retry loop.
 *
 * FLOW:
 *   1. Call fetch with whatever headers the caller passed.
 *   2. If the response is NOT 403 sudo_required, return it unchanged.
 *   3. If it IS 403 sudo_required, call getToken(reason) to obtain a
 *      fresh sudo token. If the user cancels (token is null), propagate
 *      the original 403 response.
 *   4. Re-call fetch with an added X-Sudo-Token header and return the
 *      retry response.
 *
 * The caller provides a `getToken` closure (typically wired through the
 * useSudo() hook) so the fetch wrapper stays UI-agnostic. This means
 * sudoFetch works in client components via the hook AND in non-React
 * contexts like scripts or tests by passing a custom resolver.
 *
 * USAGE in a client component:
 *
 *   const { requestSudoToken } = useSudo()
 *   const res = await sudoFetch('/api/agents/abc', {
 *     method: 'DELETE',
 *   }, requestSudoToken)
 */

/**
 * The resolver is asked for a sudo token. It receives the human-facing reason
 * and, when sudoFetch can derive it, the (method, path) of the action being
 * confirmed so the resolver can op-bind the minted token (SUDO-01, R32). The
 * `operation` is optional so existing resolvers that ignore it keep working.
 */
export type SudoTokenResolver = (
  reason: string,
  operation?: SudoOperation
) => Promise<string | null>

export interface SudoOperation {
  method: string
  /** Literal request path (e.g. /api/agents/abc123). The server normalizes it
   * to the strict-route template before binding the token. */
  path: string
}

interface SudoErrorBody {
  error?: string
  reason?: string
  message?: string
  route?: string
}

/** Best-effort extraction of the method + path from a fetch input/init so the
 * minted token can be op-bound. Falls back to undefined (unbound) on anything
 * non-string we can't safely parse. */
function deriveOperation(input: RequestInfo | URL, init: RequestInit): SudoOperation | undefined {
  const method = (init.method || 'GET').toUpperCase()
  let url: string | undefined
  if (typeof input === 'string') url = input
  else if (input instanceof URL) url = input.toString()
  else if (typeof Request !== 'undefined' && input instanceof Request) url = input.url
  if (!url) return undefined
  try {
    // Resolve relative URLs against the page origin when available so we can
    // isolate the pathname; fall back to a raw split if there's no DOM.
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const path = new URL(url, base).pathname
    return { method, path }
  } catch {
    return undefined
  }
}

export async function sudoFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  getToken: SudoTokenResolver
): Promise<Response> {
  // First attempt — unchanged request
  const firstResponse = await fetch(input, init)
  if (firstResponse.status !== 403) return firstResponse

  // Clone so we can peek at the body without consuming the original
  let body: SudoErrorBody
  try {
    body = await firstResponse.clone().json() as SudoErrorBody
  } catch {
    return firstResponse // Not JSON → not our 403
  }

  if (body.error !== 'sudo_required') return firstResponse

  // Ask for a sudo token. The modal shows the server's natural-language
  // message (e.g. "Delete /api/agents/abc") so the user sees exactly
  // what they're confirming. Pass the operation so the resolver can op-bind.
  const reason = body.message || `Sudo mode required for ${body.route || 'this action'}.`
  const token = await getToken(reason, deriveOperation(input, init))
  if (!token) {
    // User cancelled — return the original 403 so the caller knows the
    // action did not proceed. The caller's error handler should treat
    // this as "aborted by user".
    return firstResponse
  }

  // Retry with the token. Merge headers so any caller-supplied headers
  // (Authorization, Content-Type, etc.) are preserved.
  const mergedHeaders = new Headers(init.headers)
  mergedHeaders.set('X-Sudo-Token', token)
  const retryInit: RequestInit = { ...init, headers: mergedHeaders }
  return fetch(input, retryInit)
}

/**
 * mintSudoToken — exchange a governance password directly for a sudo
 * token, without going through the SudoContext modal. This is intended
 * for callers that have already collected the password through their
 * own inline UI and want to avoid the second password prompt.
 *
 * Throws an Error with a descriptive message on:
 *   - 403 password mismatch ("invalid password")
 *   - 503 governance password not configured
 *   - any other non-OK response (server error, network failure, etc.)
 *
 * Why this exists: scenarios SCEN-007/009/010/011 reported that the
 * TitleAssignmentDialog prompted for the password TWICE — once inline
 * via GovernancePasswordDialog (needed because legacy team-governance
 * routes like /api/governance/manager and /api/teams/{id}/chief-of-staff
 * still want password in the body), and a second time via the sudo
 * modal triggered by `sudoFetch` retrying PATCH /api/agents/{id}. By
 * pre-minting the sudo token from the inline password, the same
 * keystrokes cover both legacy + strict routes and the user sees only
 * one prompt.
 */
export async function mintSudoToken(password: string, operation?: SudoOperation): Promise<string> {
  const res = await fetch('/api/auth/sudo-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `operation` is optional (two-phase rollout, R-3): when supplied the
    // server op-binds the token to that (method, path); omitted → unbound.
    body: JSON.stringify(operation ? { password, operation } : { password }),
  })
  if (res.status === 403) {
    throw new Error('invalid password')
  }
  if (res.status === 503) {
    throw new Error('Governance password not configured on this host.')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }))
    const msg = (body as { error?: string }).error || `HTTP ${res.status}`
    throw new Error(msg)
  }
  const data = await res.json() as { token: string; expiresAt: number }
  return data.token
}

/**
 * sudoFetchWithToken — like `sudoFetch`, but uses a pre-minted sudo
 * token instead of calling a UI resolver on 403. Sends the token on
 * the FIRST request so no retry is needed in the happy path. If the
 * token is rejected (expired / replayed / malformed), the caller gets
 * the 403 unchanged — no fallback prompt is shown, the caller decides
 * what to do.
 *
 * Useful when the caller has already collected the password and minted
 * a token via `mintSudoToken`, and wants to make multiple strict calls
 * without re-prompting.
 */
export async function sudoFetchWithToken(
  input: RequestInfo | URL,
  init: RequestInit,
  token: string
): Promise<Response> {
  const mergedHeaders = new Headers(init.headers)
  mergedHeaders.set('X-Sudo-Token', token)
  const tokenInit: RequestInit = { ...init, headers: mergedHeaders }
  return fetch(input, tokenInit)
}
