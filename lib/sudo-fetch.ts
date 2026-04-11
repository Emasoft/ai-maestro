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

export type SudoTokenResolver = (reason: string) => Promise<string | null>

interface SudoErrorBody {
  error?: string
  reason?: string
  message?: string
  route?: string
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
  // what they're confirming.
  const reason = body.message || `Sudo mode required for ${body.route || 'this action'}.`
  const token = await getToken(reason)
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
