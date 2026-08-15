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
import {
  backoffMs,
  classify429,
  readCooldowns,
  serverRetryAtMs,
  USAGE_TTL_MS,
  withProbeLock,
  writeCooldowns,
  type CooldownEntry,
  type UsageReason,
} from './usage-cooldown'

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
  /** Test seam for the 429 back-off state. Default = the file-backed store in
   *  `usage-cooldown.ts`. Injecting an in-memory one keeps a unit test 0-IMPACT: without it a
   *  test that drives a 429 would write the DEVELOPER'S real machine-wide rotator state. */
  cooldownStore?: {
    read: () => Record<string, CooldownEntry>
    write: (data: Record<string, CooldownEntry>) => void
  }
  /** Test seam for the cross-process probe lock. Default = the real O_EXCL lock. A unit test has
   *  no second process, so it passes a pass-through; a CONTENTION test passes `async () => null`,
   *  which is what a real contended acquire returns. */
  probeLock?: <T>(fn: () => Promise<T>) => Promise<T | null>
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
): Promise<{ status: number; json: unknown | null; headers?: Record<string, string> }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: ac.signal,
    })
    // Response headers are lowercased into a plain record so callers can read `retry-after` /
    // `anthropic-ratelimit-*` without depending on the Headers object (which a stubbed fetch in a
    // test may not fully implement). Collected on BOTH paths — the 429 back-off needs them from
    // the non-2xx path, which is exactly the one that used to return before touching them.
    const headers = readHeaders(res)
    if (!res.ok) return { status: res.status, json: null, headers } // non-2xx → code, no body
    try {
      return { status: res.status, json: await res.json(), headers }
    } catch {
      return { status: 0, json: null, headers } // 2xx, unparseable → JSONDecodeError → (0, None)
    }
  } catch {
    return { status: 0, json: null } // network / abort / timeout → URLError/TimeoutError → (0, None)
  } finally {
    clearTimeout(timer)
  }
}

/** Lowercase-keyed copy of a response's headers. Tolerates a stub whose `headers` is missing or
 *  is a plain object rather than a real `Headers` — a probe must never throw on telemetry. */
function readHeaders(res: Response): Record<string, string> | undefined {
  try {
    const h = (res as { headers?: unknown }).headers
    if (!h) return undefined
    const out: Record<string, string> = {}
    if (typeof (h as Headers).forEach === 'function') {
      ;(h as Headers).forEach((v, k) => {
        out[k.toLowerCase()] = v
      })
      return out
    }
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
      if (typeof v === 'string') out[k.toLowerCase()] = v
    }
    return out
  } catch {
    return undefined
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
  opts?: UsageProbeOpts,
): Promise<[number, unknown | null]> {
  const r = await usageProbe(blob, deps, opts)
  return [r.status, r.data]
}

/** Extra inputs to {@link usageProbe}. Optional so every existing call site keeps compiling. */
export interface UsageProbeOpts {
  /** Stable per-account identity (the rotator's email) that the back-off state is keyed by.
   *  WITHOUT it the cooldown machinery is skipped entirely and the probe behaves exactly as it
   *  did before TRDD-W4T70Y3R — state that cannot be attributed to an account must not be
   *  attributed to all of them. */
  accountKey?: string
}

/** A usage reading plus HOW it was obtained. #94 recommends reporting the reason rather than
 *  re-deriving it downstream, which is what stops a throttle being read as an exhausted account
 *  after the fact. */
export interface UsageOutcome {
  /** The ROTATOR-VISIBLE status, preserving the existing contract: 200 usable, 429 the account
   *  really is maxed, 0 unknown-don't-act. A throttle deliberately never surfaces as 429. */
  status: number
  data: unknown | null
  reason: UsageReason
  /** Age of a served cached reading, ms. Present only when `data` came from the cache — this is
   *  the "staleness surfaced rather than rendered as live" the card requires. */
  ageMs?: number
  /** Epoch ms before which we will not probe again. */
  retryAtMs?: number
}

/**
 * Probe /api/oauth/usage with 429 back-off and a TTL cache (TRDD-W4T70Y3R; recipe from
 * `Emasoft/ai-maestro#94`). Costs ZERO inference quota.
 *
 * The rotator-visible status keeps its old meanings exactly. What changes is that a 429 no longer
 * automatically means "maxed": a THROTTLE 429 resolves to the last known reading (flagged stale)
 * or to 0/unknown, never to 429 — because reporting a rate limit as an exhausted account is what
 * made a transient throttle self-sustaining. See `classify429` for the split, and the header of
 * `usage-cooldown.ts` for why the cache is a correctness requirement rather than a nicety.
 */
export async function usageProbe(
  blob: CredentialBlob,
  deps?: NetworkDeps,
  opts?: UsageProbeOpts,
): Promise<UsageOutcome> {
  const tok = oauthOf(blob).accessToken
  if (typeof tok !== 'string' || !tok) return { status: 0, data: null, reason: 'error' }

  const key = opts?.accountKey?.trim()
  const fetchOnce = () =>
    httpJson(
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

  // No account identity ⇒ no attributable back-off state ⇒ behave exactly as before.
  if (!key) {
    const { status, json } = await fetchOnce()
    return { status, data: json, reason: status === 200 ? 'fresh' : status === 429 ? 'quota_429' : 'error' }
  }

  const store = deps?.cooldownStore ?? { read: readCooldowns, write: writeCooldowns }
  const lock = deps?.probeLock ?? withProbeLock

  /** Serve the cache when it is inside the TTL, else the given unknown-shaped outcome. */
  const cachedOr = (entry: CooldownEntry | undefined, reason: UsageReason, now: number): UsageOutcome => {
    if (entry?.cachedAtMs !== undefined) {
      const age = now - entry.cachedAtMs
      if (age >= 0 && age < USAGE_TTL_MS) {
        return { status: 200, data: entry.cachedData ?? null, reason, ageMs: age, retryAtMs: entry.cooldownUntilMs }
      }
    }
    return { status: 0, data: null, reason, retryAtMs: entry?.cooldownUntilMs }
  }

  /**
   * What to answer while a cooldown holds — WITHOUT touching the network.
   *
   * A QUOTA cooldown keeps answering 429. Suppressing the probe must not suppress the ANSWER:
   * `autoRotate` needs two consecutive 429s on the live account to rotate away, so reporting
   * "unknown" here would strand the rotator on a maxed account. The fact is stable until the
   * window resets, so replaying it costs nothing and stops the 60-knocks-an-hour that #94
   * measured re-arming the lockout.
   *
   * A THROTTLE cooldown falls back to the cached reading (or unknown) — there we have no reason
   * to believe anything about the account's quota at all.
   */
  const duringCooldown = (entry: CooldownEntry, now: number): UsageOutcome =>
    entry.lastKind === 'quota_429'
      ? { status: 429, data: null, reason: 'quota_429', retryAtMs: entry.cooldownUntilMs }
      : cachedOr(entry, 'cooldown', now)

  const now0 = Date.now()
  const pre = store.read()[key]
  if (pre && now0 < pre.cooldownUntilMs) return duringCooldown(pre, now0)

  const result = await lock(async (): Promise<UsageOutcome> => {
    // RE-CHECK AFTER ACQUIRING. Two callers can both pass the cooldown check above before either
    // fires; without this re-read they double-hit, and — reading the same consecutive count —
    // both compute the SAME back-off, so the escalation silently fails to escalate. #94 flags
    // this as the subtle clause, and it is the reason to copy their recipe rather than re-derive.
    const now = Date.now()
    const all = store.read()
    const entry = all[key]
    if (entry && now < entry.cooldownUntilMs) return duringCooldown(entry, now)

    const { status, json, headers } = await fetchOnce()

    if (status === 200) {
      all[key] = { consecutive429: 0, cooldownUntilMs: 0, cachedAtMs: now, cachedData: json }
      store.write(all)
      return { status: 200, data: json, reason: 'fresh' }
    }

    if (status === 429) {
      const kind = classify429(headers, entry)
      const consecutive = (entry?.consecutive429 ?? 0) + 1
      // The SERVER's instant wins when it named one; the exponential is only the fallback.
      const retryAtMs = serverRetryAtMs(headers, now) ?? now + backoffMs(consecutive)
      all[key] = {
        consecutive429: consecutive,
        cooldownUntilMs: retryAtMs,
        lastKind: kind,
        // The cached reading SURVIVES a 429 — it is the only thing keeping rotation from going
        // blind during a THROTTLE back-off, which is the deadlock this change exists to avoid.
        cachedAtMs: entry?.cachedAtMs,
        cachedData: entry?.cachedData,
      }
      store.write(all)
      if (kind === 'quota_429') return { status: 429, data: null, reason: 'quota_429', retryAtMs }
      return { ...cachedOr(all[key], 'throttle_429', now), retryAtMs }
    }

    // 401/403/0 — bad token or network. Untouched by the back-off: tick.ts already answers these
    // with a refresh-and-reprobe, and putting them in the 429 counter would let an expired token
    // suppress the probe that is trying to heal it.
    return { status, data: json, reason: 'error' }
  })

  // Lock contended ⇒ another process is probing this very moment. Do NOT fetch (that is the whole
  // point of the lock); serve the cache if we have a fresh one.
  if (result === null) return cachedOr(store.read()[key], 'lock_contended', Date.now())
  return result
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

/** One MODEL-SCOPED usage window, parsed out of the response's `limits[]` array. */
export interface ScopedLimit {
  /** `scope.model.display_name`, e.g. `Fable`. */
  model: string
  /** 0-100. ⚠ The field is `percent` here, NOT `utilization` — `limits[]` entries and the
   *  top-level buckets spell the same quantity differently. */
  percent: number | null
  /** ISO 8601, when this window rolls over. May carry fractional seconds, may not. */
  resetsAt: string | null
  /** The SERVER's own classification of the window (e.g. `normal`). Read and logged; our
   *  thresholds still decide. Recorded so a future tuning pass can compare the two. */
  severity: string | null
  /** Whether the server considers this the currently-binding window. TRI-STATE (TRDD-IZ6KU37Y,
   *  mirroring the janitor's `models_in_use`): `true`/`false` are the server's own words; `null`
   *  means the payload omitted the field. The distinction is load-bearing for the models-in-use
   *  evidence rule — an explicit `false` WITHDRAWS the evidence that a model is in use, while a
   *  missing field does not. Collapsing null into false would silently unveto candidates
   *  whenever the API drops the field. */
  isActive: boolean | null
}

/**
 * The model-scoped windows in a usage response — the ONLY place a per-model limit is reachable.
 *
 * Why this exists (TRDD-JI7F1236): the rotator used to decide everything from `five_hour` and
 * `seven_day`, and a model-scoped weekly window (Fable 5 has one) lives in NEITHER. An account
 * whose scoped window is exhausted while 5h/7d sit low therefore looked healthy in both
 * directions — we would not rotate away from it, and we would happily rotate ONTO it, after
 * which every call on that model fails.
 *
 * The flat `seven_day_opus` / `_sonnet` / `_cowork` / `_omelette` keys are NOT an alternative:
 * they still exist in the payload but are NULL (verified against the live API 2026-08-01) —
 * the API moved model-scoped limits into `limits[]` and left the old keys behind as null.
 *
 * Entries are selected by CARRYING A MODEL NAME rather than by `kind === 'weekly_scoped'`: the
 * un-scoped `session` / `weekly_all` entries are verified duplicates of the two top-level
 * buckets (60/60 and 62/62 on a live probe), so keying on the model name both excludes them and
 * survives the server introducing a new `kind`.
 */
export function scopedLimits(usage: unknown): ScopedLimit[] {
  if (!usage || typeof usage !== 'object') return []
  const raw = (usage as Record<string, unknown>).limits
  if (!Array.isArray(raw)) return []
  const out: ScopedLimit[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const scope = e.scope as { model?: { display_name?: unknown } } | undefined
    const name = scope?.model?.display_name
    if (typeof name !== 'string' || !name) continue // un-scoped ⇒ duplicates a top-level bucket
    out.push({
      model: name,
      percent: typeof e.percent === 'number' ? e.percent : null,
      resetsAt: typeof e.resets_at === 'string' ? e.resets_at : null,
      severity: typeof e.severity === 'string' ? e.severity : null,
      isActive: typeof e.is_active === 'boolean' ? e.is_active : null,
    })
  }
  return out
}

/** The worst (highest) percent across the model-scoped windows, or null when none reports a
 *  number. Null is NOT zero: an unknown window must never look like an empty one. */
export function worstScopedPercent(usage: unknown): number | null {
  let worst: number | null = null
  for (const l of scopedLimits(usage)) {
    if (l.percent === null) continue
    if (worst === null || l.percent > worst) worst = l.percent
  }
  return worst
}

/**
 * The EARLIEST reset instant across every window in the response (the two top-level buckets and
 * every scoped one), as epoch ms — or null when the payload carries no parseable timestamp.
 *
 * This is what lets "all paid accounts maxed" say WHEN a window returns instead of polling
 * blindly. `Date.parse` handles both ISO 8601 forms the API is known to emit (with and without
 * fractional seconds), so no format branch is needed.
 */
/**
 * The FIVE-HOUR bucket's reset instant as epoch SECONDS, or null. Epoch seconds — not ms —
 * because its consumer matches it against agentlenspro's `resets_5h` field (epoch sec), where it
 * is the account-attribution cohort key: two accounts' 5h windows reset at different instants,
 * so an agentlens row whose `resets_5h` equals the live account's is the live account's row
 * (TRDD-SLSSUIQ8). Rounding, not truncation, so a fractional-second ISO stamp cannot land one
 * second off the cohort and silently exclude every row.
 */
export function fiveHourResetSec(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null
  const b = (usage as Record<string, unknown>).five_hour
  if (!b || typeof b !== 'object') return null
  const s = (b as Record<string, unknown>).resets_at
  if (typeof s !== 'string' || !s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : Math.round(t / 1000)
}

export function earliestResetMs(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  const stamps: unknown[] = []
  for (const w of ['five_hour', 'seven_day']) {
    const b = u[w]
    if (b && typeof b === 'object') stamps.push((b as Record<string, unknown>).resets_at)
  }
  for (const l of scopedLimits(usage)) stamps.push(l.resetsAt)
  let earliest: number | null = null
  for (const s of stamps) {
    if (typeof s !== 'string' || !s) continue
    const t = Date.parse(s)
    if (Number.isNaN(t)) continue
    if (earliest === null || t < earliest) earliest = t
  }
  return earliest
}
