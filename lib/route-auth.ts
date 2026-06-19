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
import { isLockedDown, recordAuthFailure, recordAuthSuccess } from './kill-switch'

function checkWriteBlock(method: string): NextResponse | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null

  // Kill switch takes precedence — if locked down, reject ALL writes
  if (isLockedDown()) {
    return NextResponse.json(
      { error: 'kill_switch_active', message: 'System is in emergency lockdown due to repeated authentication failures. Try again later or contact the system owner.' },
      { status: 503 },
    )
  }

  // Read-only mode (ledger tamper detection)
  if (isReadOnlyMode()) {
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
  const writeBlock = checkWriteBlock(request.method)
  if (writeBlock) return { ok: false, error: writeBlock }

  const result = authenticateFromRequest(request)
  if (result.error) {
    recordAuthFailure()
    return {
      ok: false,
      error: NextResponse.json(
        { error: result.error },
        { status: result.status ?? 401 }
      ),
    }
  }
  recordAuthSuccess()
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
  const writeBlock = checkWriteBlock(request.method)
  if (writeBlock) return { ok: false, error: writeBlock }

  const result = await authenticateFromRequestAsync(request)
  if (result.error) {
    recordAuthFailure()
    return {
      ok: false,
      error: NextResponse.json(
        { error: result.error },
        { status: result.status ?? 401 }
      ),
    }
  }
  recordAuthSuccess()
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
  const writeBlock = checkWriteBlock(request.method)
  if (writeBlock) return writeBlock

  const result = authenticateFromRequest(request)
  if (result.error) {
    recordAuthFailure()
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 401 }
    )
  }
  recordAuthSuccess()
  return null
}

/**
 * Enforce that the caller is the system owner (web UI user). Used for
 * routes that MUST NOT be callable by any agent, no matter how its AID
 * token is scoped. Examples: governance password change, marketplace
 * registration, domain-level settings, user profile edits.
 */
export function enforceSystemOwner(request: NextRequest): NextResponse | null {
  const writeBlock = checkWriteBlock(request.method)
  if (writeBlock) return writeBlock

  const result = authenticateFromRequest(request)
  if (result.error) {
    recordAuthFailure()
    return NextResponse.json(
      { error: result.error },
      { status: result.status ?? 401 }
    )
  }
  recordAuthSuccess()
  const ctx = buildAuthContext(result)
  if (!ctx.isSystemOwner) {
    return NextResponse.json(
      { error: 'Forbidden — system owner only' },
      { status: 403 }
    )
  }
  return null
}

/**
 * R37 — enforce that the caller is the ACTIVE MAESTRO.
 *
 * This is an explicit, readable alias of {@link enforceSystemOwner}: under the
 * R36/R37/R38 user-authority model (decision D3), `buildAuthContext` redefines
 * `isSystemOwner` to mean "the caller is the active MAESTRO" (`userTitle ∈
 * {maestro, maestro-delegate}`) — see lib/agent-auth.ts. With the model OFF the
 * meaning is the legacy "any logged-in web session", so this gate behaves
 * EXACTLY like enforceSystemOwner does today (zero behavior change).
 *
 * Use this on the new delegate-handoff / user-management routes where the WHY is
 * "only the MAESTRO may do this" rather than the generic "system owner".
 */
export function enforceMaestro(request: NextRequest): NextResponse | null {
  return enforceSystemOwner(request)
}

/** Result of {@link requireUser}: a resolved human-user caller, or a 401/403. */
export type RequireUserResult =
  | { ok: true; userId?: string; userTitle?: AuthContext['userTitle']; context: AuthContext }
  | { ok: false; error: NextResponse }

/**
 * R38.1 exception — admit a caller that is a HUMAN USER (any title, incl. a
 * normal non-MAESTRO user), as opposed to an agent. Used by the few routes a
 * normal user MAY hit (e.g. editing their OWN ASSISTANT profile within R39.4
 * limits, their kanban, a PR request). It does NOT grant admin authority — the
 * handler still authorizes the specific action against `userId`/`userTitle`.
 *
 * Rejects:
 *   - an unauthenticated caller (401),
 *   - an AGENT caller (403) — agents are never "users"; they authorize by AID
 *     + title + portfolio token (R28/R32), not through user-facing routes.
 *
 * FLAG-OFF behavior: with the user-authority model disabled, a logged-in web
 * session has no `userId` (it is the anonymous system owner), so this gate
 * admits it as a user with `userId` undefined — the single-operator UI keeps
 * working exactly as before. With the model ON, `userId`/`userTitle` are the
 * resolved user identity.
 */
export function requireUser(request: NextRequest): RequireUserResult {
  const writeBlock = checkWriteBlock(request.method)
  if (writeBlock) return { ok: false, error: writeBlock }

  const result = authenticateFromRequest(request)
  if (result.error) {
    recordAuthFailure()
    return {
      ok: false,
      error: NextResponse.json({ error: result.error }, { status: result.status ?? 401 }),
    }
  }
  recordAuthSuccess()
  const ctx = buildAuthContext(result)
  // An authenticated AGENT (has agentId) is not a user — refuse. A user/web
  // session has no agentId.
  if (ctx.agentId) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: 'Forbidden — this route is for human users, not agents' },
        { status: 403 }
      ),
    }
  }
  return { ok: true, userId: ctx.userId, userTitle: ctx.userTitle, context: ctx }
}
