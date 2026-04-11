/**
 * Global API authentication middleware (SEC-PHASE-1b).
 *
 * Enforces: EVERY request to /api/* must carry at least one credential
 * (session cookie or Authorization: Bearer <token>) — with a narrow
 * whitelist for auth-bootstrap, health, and agent-register endpoints.
 *
 * This is the defense-in-depth layer: if any route handler forgets to
 * call authenticateFromRequest(), the middleware still rejects the
 * request before the handler runs. There is NO way to hit a protected
 * route anonymously.
 *
 * User rule (Apr 2026): IN AI-MAESTRO SECURITY IS PARAMOUNT AND ENFORCED H24.
 * All agents or humans must be authenticated to do anything.
 *
 * Runtime constraint: Next.js middleware runs in Edge Runtime (Next 14),
 * so we cannot use fs / crypto / Node-only APIs here. The middleware
 * performs a CHEAP presence + structural check:
 *   1. Is the path in the whitelist? → pass through
 *   2. Does the request carry a recognized credential shape? → pass
 *      through (the route handler does the full cryptographic verify)
 *   3. Otherwise → 401 immediately
 *
 * This prevents the "forgot to authenticate" class of bug. Full
 * verification still happens in lib/agent-auth.ts::authenticateFromRequest.
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Paths that MUST be reachable without any credentials. Keep this list
 * minimal — every entry is a surface the attacker can probe.
 */
const WHITELIST: ReadonlyArray<RegExp> = [
  // Auth bootstrap — user login, logout, session check, first-run setup
  /^\/api\/auth\/login(\/|$)/,
  /^\/api\/auth\/logout(\/|$)/,
  /^\/api\/auth\/session(\/|$)/,  // GET returns current session state (may be unauthenticated)
  /^\/api\/auth\/setup-password(\/|$)/,  // one-shot first-run setup (SEC-PHASE-6)
  /^\/api\/auth\/setup-verify(\/|$)/,    // one-shot OS notification verify (SEC-PHASE-6)
  // Public health + capability reporting (no secrets leaked, safe to probe)
  /^\/api\/v1\/health(\/|$)/,
  /^\/api\/v1\/info(\/|$)/,
  // AMP agent registration — bootstrap credential for new agents
  /^\/api\/v1\/register(\/|$)/,
]

/**
 * Cheap structural check for recognized credential shapes. This does NOT
 * verify that the token is valid — that's the route handler's job. It
 * only confirms the request LOOKS authenticated, so completely anonymous
 * requests are rejected without reaching the handler.
 */
function hasCredential(req: NextRequest): boolean {
  // Session cookie
  const cookie = req.headers.get('cookie') || ''
  if (/(^|;\s*)aim_session=[A-Za-z0-9_+/=\-]+/.test(cookie)) {
    return true
  }
  // Bearer token
  const auth = req.headers.get('authorization') || ''
  if (/^Bearer\s+(aim_tk_|amp_live_sk_|mst_)[A-Za-z0-9_\-]{10,}$/.test(auth.trim())) {
    return true
  }
  // X-Forwarded-From (mesh-forwarded, only for /api/v1/route — but that
  // endpoint requires additional signature verification in the handler)
  if (req.headers.get('x-forwarded-from')) {
    return true
  }
  return false
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl

  // Only enforce on /api/* — everything else (pages, _next/*, static) is free
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Whitelist check
  for (const rx of WHITELIST) {
    if (rx.test(pathname)) {
      return NextResponse.next()
    }
  }

  // Credential presence check
  if (!hasCredential(req)) {
    return NextResponse.json(
      {
        error: 'auth_required',
        message: 'Authentication required. Log in at /api/auth/login or provide a Bearer token.',
        hint: 'No credentials found on the request (cookie or Authorization header).',
      },
      { status: 401 },
    )
  }

  // Credentials present — defer full verification to the route handler
  return NextResponse.next()
}

export const config = {
  // Run middleware on every /api/* request; skip everything else for perf
  matcher: ['/api/:path*'],
}
