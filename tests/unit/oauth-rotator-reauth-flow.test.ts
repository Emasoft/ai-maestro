import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  startReauth,
  completeReauth,
  pkceChallengeFor,
  __resetPendingReauthsForTest,
} from '@/lib/oauth-rotator/reauth-flow'
import { DEFAULT_OAUTH_SCOPES, OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI } from '@/lib/oauth-rotator/network'
import { loadState, readSlot, rotatorRoot, saveState } from '@/lib/oauth-rotator/slots'

// 0-IMPACT, structurally: HOME points at an isolated temp dir so rotatorRoot() resolves inside it,
// CLAUDE_SAFE_STORAGE_BACKEND=none makes the keychain + secret-tool tiers inert (slot I/O uses the
// temp-dir plaintext path), JANITOR_GLOBAL_STATE_DIR keeps fileSlot's tick-lock in the temp dir,
// and EVERY network call is stubbed. A hard guard below refuses to run before any write if HOME is
// not honored, so a token can never land in the real keychain or the real ~/.claude.

const ENV_KEYS = [
  'HOME',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_ROTATOR_HOME',
  'CLAUDE_SAFE_STORAGE_BACKEND',
  'JANITOR_GLOBAL_STATE_DIR',
] as const

let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-reauth-'))
  process.env.HOME = tmpDir
  delete process.env.CLAUDE_PLUGIN_DATA
  delete process.env.CLAUDE_ROTATOR_HOME
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  process.env.JANITOR_GLOBAL_STATE_DIR = tmpDir
  if (!rotatorRoot().startsWith(tmpDir)) {
    throw new Error(`refusing to run: rotatorRoot() ${rotatorRoot()} escaped tmp ${tmpDir}`)
  }
  __resetPendingReauthsForTest()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

/** A fetch stub serving BOTH network legs of the flow: the token exchange and the /roles lookup. */
function stubFetch(opts?: {
  tokenStatus?: number
  tokenBody?: Record<string, unknown> | null
  rolesBody?: Record<string, unknown> | null
  onTokenBody?: (body: Record<string, unknown>) => void
}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/v1/oauth/token')) {
      if (opts?.onTokenBody) opts.onTokenBody(JSON.parse(String(init?.body ?? '{}')))
      const status = opts?.tokenStatus ?? 200
      const body =
        opts?.tokenBody === undefined
          ? { access_token: 'ACCESS-NEW', refresh_token: 'REFRESH-NEW', expires_in: 3600 }
          : opts.tokenBody
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (body === null) throw new Error('unparseable')
          return body
        },
      } as unknown as Response
    }
    if (u.includes('/oauth/claude_cli/roles')) {
      const body =
        opts?.rolesBody === undefined ? { organization_name: "dead@example.com's Organization" } : opts.rolesBody
      return {
        ok: body !== null,
        status: body === null ? 500 : 200,
        json: async () => body,
      } as unknown as Response
    }
    throw new Error(`unexpected fetch to ${u}`)
  }) as unknown as typeof fetch
}

describe('startReauth — the authorize URL', () => {
  it('derives the PKCE challenge exactly as RFC 7636 §4.2 specifies (its own Appendix-B vector)', () => {
    // The shipped function IS the one under test — startReauth calls pkceChallengeFor, so a
    // regression in the derivation fails here rather than only at the live endpoint.
    expect(pkceChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('carries S256, the exact 4-scope set, the shared client id and the registered redirect URI', () => {
    const { authorizeUrl, state } = startReauth()
    const u = new URL(authorizeUrl)
    expect(u.origin + u.pathname).toBe('https://claude.ai/oauth/authorize')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('client_id')).toBe(OAUTH_CLIENT_ID)
    expect(u.searchParams.get('redirect_uri')).toBe(OAUTH_REDIRECT_URI)
    expect(u.searchParams.get('state')).toBe(state)
    // The 4-scope set is what yields a refresh token; widening it silently breaks the repair.
    expect(u.searchParams.get('scope')).toBe(
      'user:profile user:inference user:sessions:claude_code user:mcp_servers',
    )
    expect(u.searchParams.get('scope')).toBe(DEFAULT_OAUTH_SCOPES)
  })

  it('never emits the PKCE verifier — not in the result, not anywhere in the URL', () => {
    // Pin the randomness so the verifier is KNOWN; the negative cannot be asserted otherwise.
    // randomBytes is called twice: verifier first, then state.
    const bufs = [Buffer.alloc(32, 0xa1), Buffer.alloc(32, 0xb2)]
    let i = 0
    const result = startReauth({ randomBytes: () => bufs[i++] })
    const verifier = bufs[0].toString('base64url')
    const state = bufs[1].toString('base64url')

    expect(result.state).toBe(state)
    expect(result.authorizeUrl).not.toContain(verifier)
    expect(JSON.stringify(result)).not.toContain(verifier)
    // What IS published is the challenge — and it must be the challenge OF that verifier.
    expect(new URL(result.authorizeUrl).searchParams.get('code_challenge')).toBe(
      pkceChallengeFor(verifier),
    )
  })
})

describe('completeReauth — the three state refusals are distinct', () => {
  it('refuses a state it never issued', async () => {
    const r = await completeReauth('never-issued', 'CODE#never-issued', { fetchImpl: stubFetch() })
    expect(r).toEqual({ ok: false, reason: 'unknown_state' })
  })

  it('refuses an EXPIRED state, distinguishably from an unknown one', async () => {
    const t0 = 1_000_000
    const { state } = startReauth({ now: t0 })
    const r = await completeReauth(state, `CODE#${state}`, {
      fetchImpl: stubFetch(),
      now: t0 + 11 * 60 * 1000, // TTL is 10 min
    })
    expect(r).toEqual({ ok: false, reason: 'expired_state' })
  })

  it('refuses a REPLAYED state after a successful completion, distinguishably from unknown', async () => {
    const { state } = startReauth()
    const first = await completeReauth(state, `CODE#${state}`, { fetchImpl: stubFetch() })
    expect(first.ok).toBe(true)
    const replay = await completeReauth(state, `CODE#${state}`, { fetchImpl: stubFetch() })
    expect(replay).toEqual({ ok: false, reason: 'replayed_state' })
  })
})

describe('completeReauth — the pasted string', () => {
  it('refuses a code whose embedded state belongs to a different flow', async () => {
    const { state } = startReauth()
    const r = await completeReauth(state, 'CODE#some-other-flow', { fetchImpl: stubFetch() })
    expect(r).toEqual({ ok: false, reason: 'state_mismatch' })
  })

  it('does NOT burn the flow on a mis-paste — a corrected re-paste still succeeds', async () => {
    const { state } = startReauth()
    expect((await completeReauth(state, 'CODE#wrong', { fetchImpl: stubFetch() })).ok).toBe(false)
    const retry = await completeReauth(state, `CODE#${state}`, { fetchImpl: stubFetch() })
    expect(retry.ok).toBe(true)
  })

  it('accepts a BARE code (no #state) — that page rendering has varied and refusing would kill the only repair path', async () => {
    const { state } = startReauth()
    const r = await completeReauth(state, '  CODE-ONLY  ', { fetchImpl: stubFetch() })
    expect(r.ok).toBe(true)
  })

  it('refuses an empty code without burning the flow', async () => {
    const { state } = startReauth()
    expect(await completeReauth(state, `   #${state}`, { fetchImpl: stubFetch() })).toEqual({
      ok: false,
      reason: 'empty_code',
    })
    expect((await completeReauth(state, `CODE#${state}`, { fetchImpl: stubFetch() })).ok).toBe(true)
  })

  it('sends the stashed verifier — never the challenge — in the grant body', async () => {
    const bufs = [Buffer.alloc(32, 0xa1), Buffer.alloc(32, 0xb2)]
    let i = 0
    const { state } = startReauth({ randomBytes: () => bufs[i++] })
    let body: Record<string, unknown> = {}
    await completeReauth(state, `CODE#${state}`, {
      fetchImpl: stubFetch({ onTokenBody: (b) => (body = b) }),
    })
    expect(body.grant_type).toBe('authorization_code')
    expect(body.code).toBe('CODE')
    expect(body.code_verifier).toBe(bufs[0].toString('base64url'))
    expect(body.redirect_uri).toBe(OAUTH_REDIRECT_URI)
    expect(body.client_id).toBe(OAUTH_CLIENT_ID)
  })
})

describe('completeReauth — filing the slot', () => {
  it('files under the account /roles resolves, NOT the hint, and reports the runway', async () => {
    const { state } = startReauth({ emailHint: 'guessed@example.com' })
    const r = await completeReauth(state, `CODE#${state}`, { fetchImpl: stubFetch() })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.email).toBe('dead@example.com')
    expect(r.hasRefreshToken).toBe(true)
    expect(r.expiresInH).toBeGreaterThan(0.9)
    expect(r.expiresInH).toBeLessThan(1.1)

    const blob = readSlot('dead@example.com')
    expect((blob?.claudeAiOauth as Record<string, unknown>).accessToken).toBe('ACCESS-NEW')
    expect((blob?.claudeAiOauth as Record<string, unknown>).refreshToken).toBe('REFRESH-NEW')
    // Nothing was filed under the hint.
    expect(readSlot('guessed@example.com')).toBeNull()
  })

  it('lifts the DEAD-token retry ban: the replaced index entry carries no refresh_failures / refresh_dead_fp', async () => {
    // Seed the exact state the ban leaves behind (tick.ts writes both fields on a dead refresh).
    const seeded = loadState()
    seeded.slots['dead@example.com'] = {
      captured_at: '2026-07-01T00:00:00+0200',
      fp: 'oldfingerprint00',
      expires_at: 1,
      via: 'seed',
      refresh_failures: 26,
      refresh_dead_fp: 'oldfingerprint00',
    } as unknown as (typeof seeded.slots)[string]
    saveState(seeded)

    const { state } = startReauth()
    expect((await completeReauth(state, `CODE#${state}`, { fetchImpl: stubFetch() })).ok).toBe(true)

    const after = loadState().slots['dead@example.com'] as unknown as Record<string, unknown>
    expect(after.via).toBe('dashboard-reauth')
    expect(after.refresh_failures).toBeUndefined()
    expect(after.refresh_dead_fp).toBeUndefined()
  })

  it('reports hasRefreshToken=false rather than claiming a repair that will die again in hours', async () => {
    const { state } = startReauth()
    const r = await completeReauth(state, `CODE#${state}`, {
      fetchImpl: stubFetch({ tokenBody: { access_token: 'ACCESS-ONLY', expires_in: 3600 } }),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.hasRefreshToken).toBe(false)
  })
})

describe('completeReauth — network failures name themselves', () => {
  it('surfaces the token endpoint HTTP status so a human knows whether to re-paste or restart', async () => {
    const { state } = startReauth()
    const r = await completeReauth(state, `CODE#${state}`, {
      fetchImpl: stubFetch({ tokenStatus: 400, tokenBody: { error: 'invalid_grant' } }),
    })
    expect(r).toEqual({ ok: false, reason: 'exchange_failed', status: 400 })
  })

  it('refuses to file anything when /roles cannot say whose token it is', async () => {
    const { state } = startReauth()
    const r = await completeReauth(state, `CODE#${state}`, {
      fetchImpl: stubFetch({ rolesBody: null }),
    })
    expect(r).toEqual({ ok: false, reason: 'account_unresolved' })
    expect(readSlot('dead@example.com')).toBeNull()
  })
})
