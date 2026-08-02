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
  /^\/api\/auth\/setup-init(\/|$)/,    // first-run bootstrap step 1 — dispatch OS notification (SEC-PHASE-6)
  /^\/api\/auth\/setup-verify(\/|$)/,  // first-run bootstrap step 2 — verify code + persist password (SEC-PHASE-6)
  // Password invalidation (TRDD-P7XKV3N9) — SELF-AUTHENTICATING, like the two
  // lines above. Its input IS the credential (plus a code delivered to the
  // physical desktop), so requiring a session first would be circular: the whole
  // point is to revoke a password you can still use, including from a CLI with no
  // cookie jar. It is NOT an open door — the handler demands the correct password,
  // a console-local connection, an OS-delivered one-shot code, and it rate-limits
  // per peer.
  /^\/api\/governance\/password\/invalidate(\/|$)/,
  // Password RESET / forgot-password (TRDD-P7XKV3N9 sibling) — SELF-AUTHENTICATING by
  // console presence + an OS-delivered one-shot code, with NO old password. It MUST be
  // reachable while LOGGED OUT (the whole point is you cannot log in), so it cannot
  // require a session. The handler enforces console-locality, verifies the code, and
  // rate-limits per peer. Also used from Settings while logged in — a session, if
  // present, is simply not required here.
  /^\/api\/governance\/password\/reset(\/|$)/,
  // Public health + capability reporting (no secrets leaked, safe to probe)
  /^\/api\/v1\/health(\/|$)/,
  /^\/api\/v1\/info(\/|$)/,
  // AMP agent registration — bootstrap credential for new agents
  /^\/api\/v1\/register(\/|$)/,
  // AID proof-of-possession challenge (TRDD-15ff13ae) — anonymous bootstrap,
  // like /register: the agent has no governance token yet (getting one is the
  // point of the challenge→token exchange). Returns only a random single-use
  // 30s-TTL nonce (no lookup, no secret); the real auth is the Ed25519 proof
  // verified at /api/v1/auth/token. Rate-limited + store-capped in the handler.
  /^\/api\/v1\/auth\/challenge(\/|$)/,
  // Statusline INGEST (TRDD-D8OYFG35) — the ONE write-shaped entry on this list, and the
  // narrowest. Claude Code runs the user's `statusLine` command in a plain terminal that has no
  // cookie jar and no AID token, so requiring a credential would make the primary case — the
  // human's own status bar — permanently 401. What keeps it from being an open door is that the
  // handler is CONSOLE-ONLY (`isConsolePeer`, so no device on the Tailscale VPN can reach it at
  // all), it accepts DATA and confers no capability, it returns `{ ok, sessionId }` and no secret,
  // and it is rate-limited and size-capped per peer. Its entire blast radius is: a process already
  // running as the user on this machine can make one session's cached 5h/7d gauge lie — and that
  // same process could equally run `claude` itself. Note the asymmetry with the READ routes below
  // it (`GET /api/statusline*`), which are NOT whitelisted: they serve the fleet and go through
  // normal auth.
  /^\/api\/statusline\/ingest(\/|$)/,
]

/**
 * Cheap structural check for recognized credential shapes. This does NOT
 * verify that the token is valid — that's the route handler's job. It
 * only confirms the request LOOKS authenticated, so completely anonymous
 * requests are rejected without reaching the handler.
 *
 * SRV-CRIT-02 fix (2026-05-04): the X-Forwarded-From branch is now
 * pathname-scoped. Previous version returned true for ANY request that
 * carried this header (even an empty value), which let any caller bypass
 * the credential check on every protected /api/* route. The header is
 * only meaningful for mesh-forwarded AMP traffic, which exclusively lands
 * on /api/v1/route, and that handler does its own Ed25519 signature
 * verification before trusting the forwarded identity.
 */
function hasCredential(req: NextRequest, pathname: string): boolean {
  // Session cookie
  const cookie = req.headers.get('cookie') || ''
  if (/(^|;\s*)aim_session=[A-Za-z0-9_+/=\-]+/.test(cookie)) {
    return true
  }
  // Bearer token
  const auth = req.headers.get('authorization') || ''
  if (/^Bearer\s+(aim_tk_|amp_live_sk_|mst_|eyJ)[A-Za-z0-9_\-\.]{10,}$/.test(auth.trim())) {
    return true
  }
  // X-Forwarded-From — pathname-scoped to /api/v1/route ONLY.
  // The header by itself is not a credential; it just declares the
  // forwarded identity. The /api/v1/route handler verifies the
  // accompanying Ed25519 signature before trusting it. On any other
  // path, this header is ignored and the request must produce a real
  // credential (cookie or bearer).
  //
  // SRV-MIN-03 fix: reject empty / whitespace-only header values explicitly.
  // The previous truthy check would accept any non-undefined string —
  // including a single space — as a valid credential signal. Now the
  // value MUST be non-empty after trimming.
  if (pathname === '/api/v1/route') {
    const xff = req.headers.get('x-forwarded-from')
    if (xff && xff.trim().length > 0) {
      return true
    }
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
  if (!hasCredential(req, pathname)) {
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
