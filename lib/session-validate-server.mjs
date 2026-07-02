// Full-mode (server.mjs) user-session cookie validator.
//
// WHY THIS FILE EXISTS: server.mjs runs in full mode via plain `node server.mjs`,
// so it can only import .mjs — it CANNOT import the TypeScript `validateSession`
// in lib/session-auth.ts. But it runs in the SAME Node process as the Next.js API
// routes (it calls `app.prepare()`), so it shares `globalThis` with them. The user
// session store that lib/session-auth.ts owns is an in-memory Map attached to
// `globalThis.__aiMaestroSessionsMap` (deliberately global so it survives Next HMR
// and is process-shared). This helper reads THAT shared Map — the single source of
// truth for live sessions — and validates a cookie the same way validateSession does.
//
// WHAT IT FIXES: server.mjs's hasCredential() / wsHasCredential() previously did a
// PRESENCE-ONLY regex check (`/aim_session=.../.test(cookie)`), so any non-empty
// `aim_session` value — a forged cookie from a Tailscale peer or a local process —
// passed the gate and could open a terminal WebSocket or read /api/internal/
// pty-sessions. This is the full-mode counterpart of the a11d1bfb sessions-browser
// fix (which deep-validated the cookie on the browser routes).
//
// SCOPE — COOKIE ONLY, BY DESIGN: the gate also accepts a Bearer token
// (aim_tk_ AID tokens, amp_live_sk_ AMP keys, mst_, eyJ JWTs). Those are NOT
// deep-validated here on purpose: validateSession is a PURE READ (safe at the
// gate), but AID tokens are ONE-SHOT (consumed on first use via active-tokens.json
// + a flock) and JWTs need jose crypto. Deep-validating a bearer at this
// pre-handshake gate would CONSUME a one-shot token before the real downstream
// consumer runs — a bug. So the bearer stays a non-consuming presence check here;
// deep bearer validation is a downstream/separate responsibility (a known follow-up).
//
// CONTRACT (keep in sync with lib/session-auth.ts — that file OWNS the store):
//   • cookie name: aim_session
//   • key: sha256(token) hex
//   • valid iff the hash is in the Map AND Date.now() <= record.expires_at
// Only this tiny read contract is replicated across the .ts/.mjs boundary; the DATA
// (the Map) is read, never duplicated.
import { createHash } from 'crypto'

const SESSION_COOKIE_NAME = 'aim_session'

export function extractSessionToken(cookieHeader) {
  if (!cookieHeader) return null
  // Same character class server.mjs's prior regex used for the cookie value. The
  // `\s*` sits AFTER the (?:^|;) group so it absorbs leading whitespace before the
  // FIRST cookie-pair too — byte-for-byte parity with the canonical split+trim
  // extractor in lib/session-auth.ts (extractSessionFromCookie), so the .mjs gate
  // accepts exactly what the browser routes accept (no false-negative drift on a
  // leading-whitespace cookie). Still fails closed: a match only yields a token the
  // sha256-in-Map check must still pass.
  const m = new RegExp('(?:^|;)\\s*' + SESSION_COOKIE_NAME + '=([A-Za-z0-9_+/=\\-]+)').exec(cookieHeader)
  return m ? m[1] : null
}

export function validateSessionCookie(cookieHeader) {
  const token = extractSessionToken(cookieHeader)
  if (!token) return false
  const map = globalThis.__aiMaestroSessionsMap
  if (!map || typeof map.get !== 'function') return false
  const hash = createHash('sha256').update(token).digest('hex')
  const record = map.get(hash)
  if (!record) return false
  if (Date.now() > record.expires_at) {
    map.delete(hash) // evict the expired record — mirrors validateSession's lazy purge
    return false
  }
  return true
}
