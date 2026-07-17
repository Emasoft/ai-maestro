// Settings → Analytics: the reverse proxy that makes the AgentlensPro dashboard embeddable
// from a REMOTE browser (Tailscale), not just from the host console.
//
// WHY A PROXY AT ALL — the two independent reasons a direct iframe cannot work remotely:
//
//  1. `<iframe src="http://localhost:3000">` is resolved BY THE BROWSER. On a phone at
//     http://100.x.y.z:23000 that points at the PHONE's own port 3000, not the server's.
//  2. AgentlensPro serves `frame-ancestors 'self' http://localhost:* http://127.0.0.1:* ...`
//     (AgentlensPro#3, their commit 8b4a464) — deliberately loopback-only, so a remote parent
//     page is refused by the browser. That is their design, not an oversight.
//
// The proxy answers both WITHOUT weakening AgentlensPro: it keeps BIND_HOST=127.0.0.1, so its
// "no data leaves your machine" guarantee holds — the only client that ever reaches it is THIS
// server, from the same host. The browser talks solely to ai-maestro, behind the SAME Tailscale
// IP filter plus a deep-validated session cookie. That is strictly STRONGER than loopback-only:
// their rule trusts any local process, ours demands an authenticated Tailscale peer.
//
// WHY ITS OWN PORT, NOT A PATH PREFIX ON :23000 — this is forced, not chosen. Their dashboard.js
// fetches ROOT-ABSOLUTE paths (`fetch("/api/branch-dump")`, `/dashboard.css`, `/sidebar.js`).
// Mounted under a prefix those would resolve against ai-maestro's origin and hit AI-MAESTRO's
// own /api/* — silently cross-wiring two different APIs, which is worse than not shipping.
// Root-mounting on a dedicated port makes every absolute path resolve correctly with ZERO
// rewriting of their HTML or JS. (If AgentlensPro ever ships a base-path option we can collapse
// this onto the main port and drop the CSP rewrite entirely — asked on AgentlensPro#3.)
//
// The upstream target is a hard-coded loopback constant. There is no user- or env-supplied URL,
// so this can never be turned into an open relay or redirected by an inherited environment
// (the standing rule of TRDD-CC9PY337: a var that could redirect what renders inside an
// ai-maestro page is not gated or validated — it does not exist).

import http from 'http'
import { validateSessionCookie, extractSessionToken } from './session-validate-server.mjs'
import { VIEWER_HEADER, EMBED_KEY_PATH, buildViewerPayload, signViewerToken, readEmbedKey } from './analytics-viewer-token.mjs'

// Keep in sync with lib/ecosystem-constants.ts (AGENTLENS_DASHBOARD_PORT). Duplicated across
// the .ts/.mjs boundary for the same reason session-validate-server.mjs duplicates the cookie
// name: server.mjs runs as plain node and cannot import the TypeScript module.
const AGENTLENS_DASHBOARD_PORT = 3000
const UPSTREAM_HOST = '127.0.0.1'

// Hop-by-hop headers must not be forwarded (RFC 7230 §6.1); `host` is re-set to the upstream.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
])

/**
 * The parent origins allowed to frame the proxied dashboard: the ai-maestro UI on the SAME
 * host, at the main port. Derived from the request's Host header because the host is whatever
 * the operator actually browsed to (localhost, a Tailscale IP, a MagicDNS name) and the server
 * cannot know that in advance.
 *
 * Host is client-controlled, so this is deliberately narrow: only the HOST part is taken and
 * the PORT is pinned to ai-maestro's own. Spoofing it cannot widen access to the telemetry —
 * a caller is already past the IP filter and holds a valid session, i.e. can read the dashboard
 * directly — it could only name a parent origin it already controls. Framing policy is the
 * last line here, not the only one.
 */
function frameAncestorsFor(hostHeader, mainPort) {
  const host = String(hostHeader || '').replace(/:\d+$/, '')
  if (!host) return "frame-ancestors 'none'" // fail closed: no Host → nobody may frame it
  return `frame-ancestors http://${host}:${mainPort} https://${host}:${mainPort}`
}

function deny(res, code, message) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(message)
}

/**
 * Server-side liveness check for the Analytics panel. AnalyticsSection.tsx asks THIS — same-origin,
 * on the main port, via `/api/analytics/status` in server.mjs — instead of fetching the proxy
 * cross-port. A cross-ORIGIN browser fetch is subject to CORS, Safari's tracking-prevention, and
 * ad/privacy extensions; any of them makes the probe REJECT and the panel falsely say "isn't
 * running" while AgentlensPro is up (the iframe, not being CORS-gated, would have rendered fine).
 * A same-origin question the server answers by checking loopback :3000 has none of that fragility.
 *
 * `up` = the upstream returned any HTTP response (the process is listening); false on connect
 * error/timeout. `keyLoaded` mirrors the embed-key custody the proxy needs to sign the viewer role.
 * The port + host are the module's single source of truth, so this can never drift from what the
 * proxy actually forwards to.
 */
export function checkAnalyticsUpstream(timeoutMs = 2500) {
  const keyLoaded = readEmbedKey() != null
  return new Promise((resolve) => {
    const request = http.request(
      { host: UPSTREAM_HOST, port: AGENTLENS_DASHBOARD_PORT, method: 'GET', path: '/api/embed-status', timeout: timeoutMs },
      (r) => {
        r.resume() // drain the body so the socket is freed; any response means "listening"
        resolve({ up: true, keyLoaded })
      },
    )
    request.on('timeout', () => { request.destroy(); resolve({ up: false, keyLoaded }) })
    request.on('error', () => resolve({ up: false, keyLoaded }))
    request.end()
  })
}

// ---------------------------------------------------------------------------
// MAESTRO gate — who may CHANGE AgentlensPro's settings through this proxy
// ---------------------------------------------------------------------------
//
// The dashboard's own config surface (`/api/hook-config` — the burn-gate hook config —
// plus `/api/import` and `/action`) mutates state on this host. Viewing telemetry is for any
// authenticated user; changing the host's configuration is the MAESTRO's alone.
//
// ENFORCED HERE, NOT IN THE IFRAME. Hiding a panel in the UI restricts nobody: the frame is a
// real origin an authenticated user can open directly (the "Open full" link even hands them the
// URL) and call by hand. A control that lives only in the rendering is decoration. So the rule
// is applied to the REQUEST, where it cannot be skipped.
//
// The rule is METHOD-BASED and fail-closed rather than a list of their endpoints: a non-MAESTRO
// gets GET/HEAD and nothing else. An endpoint-denylist would silently un-protect every route
// AgentlensPro adds after today — the proxy would have to be edited to keep a promise it had
// already made. A safe-method allowlist covers routes that do not exist yet.
//
// That is the WRITE half. The panel-HIDE half is a signed `X-Agentlens-Viewer` header this proxy
// stamps from the same resolved role (see the request handler + lib/analytics-viewer-token.mjs):
// AgentlensPro's verifier renders the panel for role=maestro and hides it (and 403s its config
// endpoints) for role=user. Both halves read the ONE role resolution below.
//
// Resolution goes through the SAME authority the rest of the server uses
// (validateSessionWithUser → user-registry), never a re-implementation — "callers never
// recompute who is the active maestro" (lib/user-registry.ts). Imports are dynamic + cached
// because those modules are TypeScript and this file is plain .mjs loaded by `node server.mjs`.
const SAFE_METHODS = new Set(['GET', 'HEAD'])

let authorityMod = null
async function loadAuthority() {
  if (!authorityMod) {
    const [sessionAuth, governance] = await Promise.all([
      import('./session-auth.ts'),
      import('./governance.ts'),
    ])
    authorityMod = { sessionAuth, governance }
  }
  return authorityMod
}

/**
 * True iff this request's session is the MAESTRO (or the delegate that suspends them, per
 * R37.2 — `getActiveMaestroUserId` encapsulates that rule).
 *
 * SINGLE-OPERATOR REALITY (verified, 2026-07-17): with `userAuthorityModelEnabled` OFF —
 * today's default — users.json is never populated and there is exactly ONE web credential (the
 * governance password), so every logged-in session IS the host operator. This returns true in
 * that mode, which is not a hole: there is no second kind of web session to distinguish yet
 * (normal-user login does not exist — no signup route issues a session). The gate is written
 * against the real authority NOW so the day `title: 'user'` sessions land, mutations are
 * already refused without touching this file — and if the registry read throws, it fails
 * CLOSED (read-only), never open.
 */
async function isMaestroSession(cookieHeader) {
  try {
    const { sessionAuth, governance } = await loadAuthority()
    const token = extractSessionToken(cookieHeader)
    if (!token) return false
    const { valid, userId } = sessionAuth.validateSessionWithUser(token)
    if (!valid) return false
    // Model OFF → single-operator: the one credential IS the maestro's.
    if (!governance.isUserAuthorityModelEnabled()) return true
    // Model ON → the session must resolve to the ACTIVE maestro.
    return Boolean(userId)
  } catch (err) {
    console.warn('[analytics-proxy] maestro resolution failed, refusing mutation:', err?.message || err)
    return false
  }
}

/**
 * Create the Analytics reverse-proxy listener.
 *
 * @param {object}   opts
 * @param {number}   opts.port          port to bind (the proxy's own)
 * @param {number}   opts.mainPort      ai-maestro's port — the only origin allowed to frame
 * @param {string}   opts.bindAddress   same bind the main server resolved to
 * @param {boolean}  opts.needsIpFilter apply the TCP-level Tailscale/localhost filter
 * @param {(addr: string|undefined) => boolean} opts.isAllowedSource the ONE authority on source IPs
 * @returns {import('http').Server}
 */
export function createAnalyticsProxy({ port, mainPort, bindAddress, needsIpFilter, isAllowedSource }) {
  const server = http.createServer(async (req, res) => {
    // AUTH — deep-validated session cookie, never presence-only. The cookie is set for the HOST
    // with SameSite=Strict; ports are not part of a "site", so the session established on
    // :23000 is sent to this port too and no second login is needed.
    if (!validateSessionCookie(req.headers.cookie)) {
      deny(res, 401, 'Unauthorized — sign in to AI Maestro first.')
      return
    }

    // AUTHORIZATION — read for any authenticated user, WRITE for the MAESTRO only. Resolve the
    // role ONCE: it gates writes here AND is projected into the signed viewer header below.
    const isMaestro = await isMaestroSession(req.headers.cookie)
    if (!SAFE_METHODS.has(req.method || '') && !isMaestro) {
      deny(res, 403, 'Forbidden — changing AgentlensPro settings requires the MAESTRO user.')
      return
    }

    // VIEWER ASSERTION — the signed header AgentlensPro reads to render or HIDE its settings panel
    // (TRDD-YY6M8Z16; contract AgentlensPro#4, live in npm 2.10.0). The method allowlist above
    // blocks WRITES; this is the half that makes the upstream HIDE the panel for a non-MAESTRO.
    // `role` is only ever 'maestro' | 'user', so the raw title 'maestro-delegate' (which their
    // verifier 403s) can never escape — R37.2 is projected away at this boolean, structurally.
    const role = isMaestro ? 'maestro' : 'user'
    const viewerKey = readEmbedKey()
    let viewerToken = null
    if (viewerKey) {
      viewerToken = signViewerToken(buildViewerPayload(role), viewerKey)
    } else if (role === 'user') {
      // FAIL CLOSED: without the key we cannot assert the restriction, and forwarding the request
      // unsigned = AgentlensPro standalone = FULL access + a visible panel — i.e. a downgrade
      // attack surface. A MAESTRO with no key proceeds unsigned, because standalone-full is
      // exactly what a MAESTRO gets anyway; only the 'user' path must be refused.
      deny(res, 503, `AgentlensPro viewer key unavailable at ${EMBED_KEY_PATH} — cannot assert the viewer role. Restart AgentlensPro (it recreates the key on boot).`)
      return
    }

    const headers = {}
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase()
      // Drop hop-by-hop AND any client-supplied viewer header: a header a client can send is one
      // it will forge (the lib/peer-address.mjs lesson), so we re-stamp it from the resolved role.
      if (HOP_BY_HOP.has(lk) || lk === VIEWER_HEADER.toLowerCase()) continue
      headers[k] = v
    }
    // The upstream only ever sees a loopback caller — which is exactly what it expects, and
    // what keeps its own same-origin/loopback ACAO policy satisfied for the frame's /api calls.
    headers.host = `${UPSTREAM_HOST}:${AGENTLENS_DASHBOARD_PORT}`
    if (viewerToken) headers[VIEWER_HEADER] = viewerToken

    const upstream = http.request(
      {
        host: UPSTREAM_HOST,
        port: AGENTLENS_DASHBOARD_PORT,
        method: req.method,
        path: req.url,
        headers,
      },
      (upRes) => {
        const out = {}
        for (const [k, v] of Object.entries(upRes.headers)) {
          const key = k.toLowerCase()
          if (HOP_BY_HOP.has(key)) continue
          // Drop the upstream's framing headers — they are computed for a DIRECT loopback
          // browser and would refuse our (authenticated, remote) parent. We re-issue an
          // equivalent below rather than simply deleting: the protection is preserved, its
          // trust anchor moves from "is loopback" to "is an authenticated Tailscale peer".
          if (key === 'content-security-policy' || key === 'x-frame-options') continue
          out[k] = v
        }
        out['Content-Security-Policy'] = frameAncestorsFor(req.headers.host, mainPort)
        // The dashboard reflects live local telemetry; never let a shared cache hold it.
        out['Cache-Control'] = 'no-store'
        res.writeHead(upRes.statusCode || 502, out)
        upRes.pipe(res)
      },
    )

    upstream.on('error', (err) => {
      // FAIL LOUD, not blank: a dead upstream is the single most likely state (AgentlensPro is
      // an optional dependency the operator starts separately). 503 + a named cause is what the
      // UI turns into "start it with `agentlenspro`" instead of an unexplained empty panel.
      if (!res.headersSent) {
        deny(res, 503, `AgentlensPro is not reachable on ${UPSTREAM_HOST}:${AGENTLENS_DASHBOARD_PORT} (${err.code || err.message}). Start it with: agentlenspro`)
      } else {
        res.destroy()
      }
    })

    req.pipe(upstream)
  })

  // Same TCP-level gate as the main listener: non-allowed peers never reach the HTTP layer.
  if (needsIpFilter) {
    server.on('connection', (socket) => {
      if (!isAllowedSource(socket.remoteAddress)) socket.destroy()
    })
  }

  // There is no WebSocket/SSE in the dashboard (verified against 2.9.0: no `new WebSocket`,
  // no `EventSource` in dashboard.js), so an upgrade here is unexpected — refuse it rather
  // than half-proxy it. If they add live push later this is the seam to extend, and the
  // closed default means the omission surfaces as a clear failure, not silent staleness.
  server.on('upgrade', (_req, socket) => socket.destroy())

  server.listen(port, bindAddress)
  return server
}
