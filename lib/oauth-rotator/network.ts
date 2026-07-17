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
// The `User-Agent: claude-account-rotator` header is REQUIRED: urllib's default UA is banned by
// Cloudflare at the token endpoint (HTTP 403 / code 1010), so every call sends this UA.

import { oauthOf, type CredentialBlob } from './slots'

const ROLES_URL = 'https://api.anthropic.com/api/oauth/claude_cli/roles'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const OAUTH_BETA = 'oauth-2025-04-20'
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const USER_AGENT = 'claude-account-rotator'

/** Dependency seam so tests stub the HTTP (default = the platform `fetch`). */
export interface NetworkDeps {
  fetchImpl?: typeof fetch
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
        'User-Agent': USER_AGENT,
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
        'User-Agent': USER_AGENT,
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
  const body = JSON.stringify({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: rtok })
  const { json } = await httpJson(
    TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
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

/** Extract one window's utilization percent (0-100) from a usage dict, or null. */
export function util(usage: unknown, window: string): number | null {
  if (!usage || typeof usage !== 'object') return null
  const w = (usage as Record<string, unknown>)[window]
  if (!w || typeof w !== 'object') return null
  const u = (w as Record<string, unknown>).utilization
  return typeof u === 'number' ? u : null
}
