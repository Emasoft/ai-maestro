// The rotator's OAuth API calls (TRDD-1GGQ4HWY Phase E.2).
//
// FAITHFUL port of rotator.py's `account_email` (/roles), `usage_request` (/usage),
// `refresh_oauth_token` (the RENEW token exchange), and `_util`. These are the ONLY network
// surface of the rotation cascade; they read a credential blob and talk to the Claude OAuth API.
// Fail-soft by design — a keepalive/probe failure must never crash the tick.
//
// `fetch` is injectable (`deps.fetchImpl`) so the unit tests are 0-IMPACT: they stub the HTTP and
// never touch the real API. The error mapping matches the Python urllib semantics exactly:
//   • account_email / refresh: any non-2xx or parse failure → null (urllib raises HTTPError, a
//     URLError subclass, caught alongside JSONDecodeError → None).
//   • usage_request: STATUS is load-bearing — 200 → [200, data], a non-2xx → [code, null]
//     (HTTPError.code), a network/parse failure → [0, null].
//
// ⚠️ TWO HOSTS NEED TWO **OPPOSITE** USER-AGENTS. THEY LOOK CONTRADICTORY. THEY ARE NOT.
// (janitor#117, 2026-07-27 — the upstream answer to "what changed since v0.60.1"; their fix is
// TRDD-WEBA1RMF / commit b9d9c75, and the deadlock it cured is TRDD-WBYFTU2L, 2026-07-18.)
//
//   • platform.claude.com/v1/oauth/token  → MUST send `claude-account-rotator`.
//     urllib's/undici's default UA is banned by Cloudflare here (HTTP 403, code 1010).
//   • api.anthropic.com/api/oauth/usage   → MUST send `claude-code/<version>`.
//     This endpoint answers a NON-`claude-code` UA with persistent 429s.
//
// DO NOT "simplify" these into one constant. That unification is the whole bug, and it is a
// DEADLOCK, not a slow path: `usageRequest` reads 429 as "this account is maxed", so a UA-banned
// 429 makes the LIVE account look maxed AND every alternate look unsafe at the same instant —
// rotation stalls exactly when it is needed. A UA the server chose caused it, entirely client-side.
//
// `accountEmail` (/roles) deliberately keeps `claude-account-rotator`: janitor#117 named ONLY the
// usage endpoint, /roles works with this UA today, and changing it on a guess would be inventing a
// fix for a defect nobody has observed. Open question raised upstream rather than assumed.

import { execFileSync } from 'node:child_process'

import { oauthOf, type CredentialBlob } from './slots'

const ROLES_URL = 'https://api.anthropic.com/api/oauth/claude_cli/roles'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const OAUTH_BETA = 'oauth-2025-04-20'

/** The Claude Code OAuth app's client id — IDENTICAL to the janitor rotator's, deliberately: both
 *  sides file into the same keychain slots, so a divergent client id would produce tokens the other
 *  half cannot use. Exported because the AUTHORIZE half (reauth-flow.ts) must send the same one. */
export const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

/** The OAuth app's REGISTERED redirect URI — Anthropic's own manual-callback page, which DISPLAYS
 *  `<code>#<state>` for the human to copy. We cannot register a callback of our own, so the
 *  paste-the-code shape is forced by the registration, not chosen. It must be sent VERBATIM in the
 *  authorization-code grant body (the endpoint checks it against the authorize request). */
export const OAUTH_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'

/**
 * The REDUCED 4-scope set. **This exact set is what yields a REFRESH token** — a wider set does
 * not, and a slot without a refresh token cannot be kept alive, which defeats the whole rotator.
 * Verified against the audited reference implementation; do not "improve" it.
 */
export const DEFAULT_OAUTH_SCOPES =
  'user:profile user:inference user:sessions:claude_code user:mcp_servers'

/** The token endpoint's REQUIRED UA (Cloudflare 1010 without it). Never send this to /usage. */
const ROTATOR_USER_AGENT = 'claude-account-rotator'

/** Fallback when `claude --version` cannot be read — still a `claude-code/*` UA, which is what the
 *  /usage endpoint gates on; the exact version is telemetry, the prefix is the access key. */
const CLAUDE_CODE_UA_FALLBACK = 'claude-code/0.0.0'

let cachedClaudeCodeUA: string | null = null

/**
 * `claude-code/<version>` for the /usage endpoint, derived once from `claude --version` and cached
 * for the process. Resolution failure is NON-FATAL by design — this whole module is fail-soft, and
 * a probe that threw because a CLI was missing would be a worse outcome than a probe that sends a
 * slightly-wrong version. Exported for the test that pins the two-UA rule.
 */
export function claudeCodeUserAgent(deps?: NetworkDeps): string {
  if (deps?.claudeVersion !== undefined) {
    const pinned = deps.claudeVersion.trim()
    return pinned ? `claude-code/${pinned}` : CLAUDE_CODE_UA_FALLBACK
  }
  if (cachedClaudeCodeUA !== null) return cachedClaudeCodeUA
  let ua = CLAUDE_CODE_UA_FALLBACK
  try {
    // The try/catch guards the CLI CALL, not the import: `node:child_process` is a core module and
    // cannot fail to resolve, while `claude --version` can be missing, slow, or unrunnable. This
    // used to lazy-`require` the module behind an eslint-disable naming a rule this project does
    // not configure, so the directive itself failed the build (`Definition for rule ... was not
    // found`). A static import removes both the lazy load and the bogus suppression; nothing
    // client-side imports this module, so there is no bundle to keep it out of.
    const out = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 5_000 }).trim()
    // `claude --version` prints e.g. "2.1.209 (Claude Code)" — take the leading semver token.
    const m = /^(\d+\.\d+\.\d+[^\s]*)/.exec(out)
    if (m) ua = `claude-code/${m[1]}`
  } catch {
    // Missing CLI, timeout, permission error — keep the fallback.
  }
  cachedClaudeCodeUA = ua
  return ua
}

/** Dependency seam so tests stub the HTTP (default = the platform `fetch`). */
export interface NetworkDeps {
  fetchImpl?: typeof fetch
  /** Pin the `claude --version` string instead of shelling out (tests; 0-IMPACT). */
  claudeVersion?: string
}

function resolveFetch(deps?: NetworkDeps): typeof fetch {
  return deps?.fetchImpl ?? fetch
}

/**
 * One JSON HTTP call with a hard timeout, mapped to the urllib semantics the callers expect:
 *   • fetch throws (network / abort / timeout)  → { status: 0, json: null }
 *   • response is non-2xx                        → { status, json: null }   (no body read)
 *   • 2xx but the body is not parseable JSON     → { status: 0, json: null } (Python JSONDecodeError)
 *   • 2xx + parseable                            → { status, json }
 */
async function httpJson(
  url: string,
  opts: { method?: string; headers: Record<string, string>; body?: string; timeoutMs: number },
  fetchImpl: typeof fetch,
): Promise<{ status: number; json: unknown | null }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: ac.signal,
    })
    if (!res.ok) return { status: res.status, json: null } // non-2xx → HTTPError.code, no body
    try {
      return { status: res.status, json: await res.json() }
    } catch {
      return { status: 0, json: null } // 2xx, unparseable → Python's JSONDecodeError → (0, None)
    }
  } catch {
    return { status: 0, json: null } // network / abort / timeout → URLError/TimeoutError → (0, None)
  } finally {
    clearTimeout(timer)
  }
}

/** Resolve the account email via /roles ("<email>'s Organization" → "<email>"), or null on any
 * failure. Network call (20 s). */
export async function accountEmail(blob: CredentialBlob, deps?: NetworkDeps): Promise<string | null> {
  const tok = oauthOf(blob).accessToken
  if (typeof tok !== 'string' || !tok) return null
  const { json } = await httpJson(
    ROLES_URL,
    {
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json',
        'anthropic-beta': OAUTH_BETA,
        // /roles keeps the rotator UA — see the two-UA note at the top of this file.
        'User-Agent': ROTATOR_USER_AGENT,
      },
      timeoutMs: 20_000,
    },
    resolveFetch(deps),
  )
  if (json === null || typeof json !== 'object') return null
  const name = (json as Record<string, unknown>).organization_name
  if (typeof name !== 'string') return null
  const marker = "'s Organization"
  const email = name.endsWith(marker) ? name.slice(0, -marker.length).trim() : name.trim()
  return email || null
}

/**
 * Probe /api/oauth/usage — costs ZERO inference quota. Returns [httpStatus, data]. The STATUS is
 * load-bearing and MUST NOT collapse to null: 200 → [200, data]; 429 → the account is maxed (for
 * the LIVE account, the signal to rotate AWAY; for an alternate, "not a safe target"); 401/403/0 →
 * bad token / network error → "unknown, don't act". Network call (20 s).
 */
export async function usageRequest(
  blob: CredentialBlob,
  deps?: NetworkDeps,
): Promise<[number, unknown | null]> {
  const tok = oauthOf(blob).accessToken
  if (typeof tok !== 'string' || !tok) return [0, null]
  const { status, json } = await httpJson(
    USAGE_URL,
    {
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json',
        'anthropic-beta': OAUTH_BETA,
        // ⚠️ MUST be `claude-code/<version>`, NOT the rotator UA. A non-`claude-code` UA earns
        // persistent 429s here, and a 429 at this call site is read as "account maxed" — which
        // is the rotation deadlock (janitor#117 / TRDD-WBYFTU2L).
        'User-Agent': claudeCodeUserAgent(deps),
      },
      timeoutMs: 20_000,
    },
    resolveFetch(deps),
  )
  return [status, json]
}

/** The usage dict on HTTP 200, else null (a display convenience). */
export async function accountUsage(blob: CredentialBlob, deps?: NetworkDeps): Promise<unknown | null> {
  const [status, data] = await usageRequest(blob, deps)
  return status === 200 ? data : null
}

/**
 * Exchange a SLOT's refreshToken for a fresh token pair and return a NEW `{ claudeAiOauth }` blob
 * (accessToken / refreshToken / expiresAt updated, other inner fields kept), or null on any
 * failure. Fail-soft. ONLY ever call on SLOT tokens — the LIVE credential's refresh is owned by
 * Claude Code (refreshing it here would race Claude's single-use rotating grant). Network call (30 s).
 */
export async function refreshOauthToken(
  blob: CredentialBlob,
  deps?: NetworkDeps,
): Promise<CredentialBlob | null> {
  const inner = oauthOf(blob)
  const rtok = inner.refreshToken ?? inner.refresh_token
  if (typeof rtok !== 'string' || !rtok) return null
  const body = JSON.stringify({
    grant_type: 'refresh_token',
    client_id: OAUTH_CLIENT_ID,
    refresh_token: rtok,
  })
  const { json } = await httpJson(
    TOKEN_URL,
    {
      method: 'POST',
      // The token endpoint REQUIRES the rotator UA — Cloudflare 1010 without it.
      headers: { 'Content-Type': 'application/json', 'User-Agent': ROTATOR_USER_AGENT },
      body,
      timeoutMs: 30_000,
    },
    resolveFetch(deps),
  )
  if (json === null || typeof json !== 'object') return null
  const tok = json as Record<string, unknown>
  const access = tok.access_token ?? tok.accessToken
  if (typeof access !== 'string' || !access) return null
  let expiresAt: unknown = tok.expiresAt
  if (expiresAt === undefined && typeof tok.expires_in === 'number') {
    expiresAt = Math.floor((Date.now() / 1000 + tok.expires_in) * 1000)
  }
  // A rotating endpoint returns a NEW refresh token; keep the old one if the response omits it
  // (non-rotating server) so we never lose the ability to refresh again.
  const newInner: Record<string, unknown> = { ...inner }
  newInner.accessToken = access
  const newRefresh = tok.refresh_token ?? tok.refreshToken ?? rtok
  newInner.refreshToken = newRefresh
  if (expiresAt !== undefined && expiresAt !== null) newInner.expiresAt = expiresAt
  return { claudeAiOauth: newInner }
}

/** The token endpoint accepted the grant and returned a usable access token. */
export interface CodeExchangeOk {
  ok: true
  blob: CredentialBlob
  /** False when the response carried NO refresh token. The blob is still usable, but it behaves
   *  like a setup-token — it cannot be keepalive-refreshed, so it will expire for good in hours.
   *  Surfaced rather than swallowed: a re-login whose whole PURPOSE is to restore a dead refresh
   *  would otherwise report success while having repaired nothing. */
  hasRefreshToken: boolean
}
/** The grant was refused, unreachable, or answered without an access token. `status` is the HTTP
 *  code (0 = network error / abort / unparseable body), which is what tells a human whether to
 *  retry the paste or start a new login. */
export interface CodeExchangeErr {
  ok: false
  status: number
}
export type CodeExchangeResult = CodeExchangeOk | CodeExchangeErr

/**
 * Exchange a PKCE authorization code for a token PAIR. This is the AUTHORIZE half's counterpart to
 * {@link refreshOauthToken}: it mints a brand-new credential from a human's fresh consent, which is
 * the ONLY repair for a slot whose refresh token is dead.
 *
 * Faithful to the janitor's `slot_capture_browser._exchange` — same endpoint, same JSON body keys,
 * same 30 s timeout, and the same `claude-account-rotator` UA (Cloudflare answers the default UA
 * with 403/1010 here). It lives in THIS module precisely so that UA is inherited rather than
 * hand-rolled at a second call site, where it would drift.
 *
 * Unlike the fail-soft probes above it returns a DISCRIMINATED result rather than null. Those are
 * background probes whose failure must never crash a tick; this one is an interactive operation
 * whose failure a human has to act on, and "null" cannot tell them whether the code expired (400)
 * or the network was down (0).
 */
export async function exchangeAuthorizationCode(
  args: { code: string; verifier: string; state: string },
  deps?: NetworkDeps,
): Promise<CodeExchangeResult> {
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    client_id: OAUTH_CLIENT_ID,
    code: args.code,
    redirect_uri: OAUTH_REDIRECT_URI,
    code_verifier: args.verifier,
    state: args.state,
  })
  const { status, json } = await httpJson(
    TOKEN_URL,
    {
      method: 'POST',
      // The token endpoint REQUIRES the rotator UA — Cloudflare 1010 without it. (anthropic-beta
      // is NOT needed for a token grant.)
      headers: { 'Content-Type': 'application/json', 'User-Agent': ROTATOR_USER_AGENT },
      body,
      timeoutMs: 30_000,
    },
    resolveFetch(deps),
  )
  if (json === null || typeof json !== 'object') return { ok: false, status }
  const tok = json as Record<string, unknown>
  const access = tok.access_token ?? tok.accessToken
  if (typeof access !== 'string' || !access) return { ok: false, status }
  const refresh = tok.refresh_token ?? tok.refreshToken
  const hasRefreshToken = typeof refresh === 'string' && refresh.length > 0
  let expiresAt: unknown = tok.expiresAt
  if (expiresAt === undefined && typeof tok.expires_in === 'number') {
    expiresAt = Math.floor((Date.now() / 1000 + tok.expires_in) * 1000)
  }
  // `scope` comes back space-delimited. Python's bare .split() drops empties; the filter is what
  // reproduces that (a JS split on /\s+/ alone yields an empty leading element on " a b").
  const scopeVal = typeof tok.scope === 'string' ? tok.scope : ''
  const scopes = (scopeVal || DEFAULT_OAUTH_SCOPES).trim().split(/\s+/).filter(Boolean)
  const inner: Record<string, unknown> = {
    accessToken: access,
    refreshToken: hasRefreshToken ? refresh : null,
    expiresAt: expiresAt ?? null,
    scopes,
    subscriptionType: typeof tok.subscriptionType === 'string' ? tok.subscriptionType : 'max',
  }
  return { ok: true, blob: { claudeAiOauth: inner }, hasRefreshToken }
}

/** Extract one window's utilization percent (0-100) from a usage dict, or null. */
export function util(usage: unknown, window: string): number | null {
  if (!usage || typeof usage !== 'object') return null
  const w = (usage as Record<string, unknown>)[window]
  if (!w || typeof w !== 'object') return null
  const u = (w as Record<string, unknown>).utilization
  return typeof u === 'number' ? u : null
}
