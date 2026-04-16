/**
 * Route-level authentication helper (SEC-PHASE-1c, #94).
 *
 * The global /api/* middleware in middleware.ts enforces a structural
 * credential check — it rejects requests with no cookie and no Bearer
 * token. But the middleware is a structural filter only (regex-matches
 * the credential shape), not a cryptographic verifier. A request with a
 * syntactically-valid-looking `aim_session=xxxxxxxx` cookie that isn't in
 * the in-memory sessions map WILL pass the middleware. Every API handler
 * that mutates state MUST therefore call requireAuth() as the first
 * statement so the cryptographic verification happens before any side
 * effect.
 *
 * USAGE:
 *
 *   export async function POST(request: NextRequest) {
 *     const auth = requireAuth(request)
 *     if ('error' in auth) return auth.error   // 401 response
 *     const ctx = auth.context                 // AuthContext, use downstream
 *     ...
 *   }
 *
 * Or, when you just need the guard and don't need the context:
 *
 *   const err = enforceAuth(request)
 *   if (err) return err
 *
 * For strict (destructive) routes, ALSO call requireSudoToken(request)
 * from lib/sudo-guard.ts — sudo-mode is layered on top of plain auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateFromRequest,
  authenticateFromRequestAsync,
  buildAuthContext,
  type AuthContext,
} from './agent-auth'
import { isReadOnlyMode, getTamperDetails } from './ledger-startup'

function checkReadOnly(method: string): NextResponse | null {
  if (isReadOnlyMode() && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    return NextResponse.json(
      { error: 'read_only_mode', message: 'Server is in read-only mode due to ledger tamper detection', details: getTamperDetails() },
      { status: 503 },
    )
  }
  return null
}

export type RequireAuthResult =
  | { ok: true; context: AuthContext; agentId?: string }
  | { ok: false; error: NextResponse }

/**
 * Verify the request's credentials. On success returns the resolved
 * AuthContext. On failure returns a NextResponse 401 that the handler
 * should return immediately to short-circuit the request.
 *
 * The handler remains in charge of authorization (whether this caller
 * can perform this specific action) — this function only verifies
 * authentication (whether this caller IS who they claim to be).
 *
 * USAGE:
 *   const auth = requireAuth(request)
 *   if (!auth.ok) return auth.error
 *   const ctx = auth.context
 */
export function requireAuth(request: NextRequest): RequireAuthResult {
  const roBlock = checkReadOnly(request.method)
  if (roBlock) return { ok: false, error: roBlock }

  const result = authenticateFromRequest(request)
  if (result.error) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: result.error },
        { status: result.status ?? 401 }
      ),
    }
  }
  return {
    ok: true,
    context: buildAuthContext(result),
    agentId: result.agentId,
  }
}

/**
 * Async variant that additionally verifies AIP compact IBCT tokens (JWT/EdDSA).
 * Falls back to sync auth for all non-IBCT token types. Use this in routes
 * where agents may present IBCT tokens for scope-verified delegation.
 */
export async function requireAuthAsync(request: NextRequest): Promise<RequireAuthResult> {
  const roBlock = checkReadOnly(request.method)
  if (roBlock) return { ok: false, error: roBlock }

  const result = await authenticateFromRequestAsync(request)
  if (result.error) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: result.error },
        { status: result.status ?? 401 }
      ),
    }
  }
  return {
    ok: true,
    context: buildAuthContext(result),
    agentId: result.agentId,
  }
}

/**
 * Lightweight variant of requireAuth for handlers that don't need the
 * AuthContext downstream. Returns NextResponse on failure, null on
 * success. Handy for mutations where authorization is uniform — e.g.
 * "any authenticated caller can call this".
 */
export function enforceAuth(request: NextRequest): NextResponse | null {
  const roBlock = checkReadOnly(request.method)
  if (roBlock) return roBlock

  const result = authenticateFromRequest(request)
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 401 }
    )
  }
  return null
}

/**
 * Enforce that the caller is the system owner (web UI user). Used for
 * routes that MUST NOT be callable by any agent, no matter how its AID
 * token is scoped. Examples: governance password change, marketplace
 * registration, domain-level settings, user profile edits.
 */
export function enforceSystemOwner(request: NextRequest): NextResponse | null {
  const roBlock = checkReadOnly(request.method)
  if (roBlock) return roBlock

  const result = authenticateFromRequest(request)
  if (result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 401 }
    )
  }
  const ctx = buildAuthContext(result)
  if (!ctx.isSystemOwner) {
    return NextResponse.json(
      { error: 'Forbidden — system owner only' },
      { status: 403 }
    )
  }
  return null
}
