/**
 * Route-level sudo guard.
 *
 * Route handlers classified "strict" in security-registry.json call
 * `requireSudoToken(request)` as the FIRST statement in their handler,
 * before any side effects. The guard:
 *   1. Reads the X-Sudo-Token header
 *   2. Validates + consumes it (one-shot, 60s TTL)
 *   3. On failure, returns a NextResponse to short-circuit the request
 *   4. On success, returns null and the handler proceeds
 *
 * This is a deliberate in-handler check (rather than middleware) because
 * sudo-auth.ts uses bcrypt / crypto / in-memory Maps that are Node-only
 * and incompatible with the Edge runtime that runs middleware.ts.
 *
 * USAGE:
 *   export async function DELETE(request: NextRequest) {
 *     const guard = requireSudoToken(request, 'DELETE', '/api/agents/[id]')
 *     if (guard) return guard
 *     // ... proceed with the destructive operation ...
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateAndConsumeSudoToken } from './sudo-auth'
import { requiresSudo } from './security-registry'

export function requireSudoToken(
  request: NextRequest,
  method: string,
  pathTemplate: string
): NextResponse | null {
  // Skip entirely if the route is NOT classified strict — keep behavior
  // idempotent so callers can add the guard unconditionally without
  // harming normal routes.
  if (!requiresSudo(method, pathTemplate)) {
    return null
  }

  const token = request.headers.get('x-sudo-token')
  const result = validateAndConsumeSudoToken(token)

  if (result.ok) {
    return null
  }

  const reason = result.reason
  const message =
    reason === 'missing'
      ? 'Sudo mode required. POST /api/auth/sudo-password with your governance password to get a token, then retry with X-Sudo-Token header.'
      : reason === 'expired'
        ? 'Sudo token expired (60s TTL). Request a fresh one.'
        : 'Sudo token invalid or already used (tokens are one-shot).'

  return NextResponse.json(
    {
      error: 'sudo_required',
      reason,
      message,
      route: `${method} ${pathTemplate}`,
    },
    { status: 403 }
  )
}
