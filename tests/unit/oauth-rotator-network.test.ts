import { describe, it, expect } from 'vitest'
import {
  accountEmail,
  usageRequest,
  accountUsage,
  refreshOauthToken,
  util,
} from '@/lib/oauth-rotator/network'

// 0-IMPACT: every test injects a stub `fetchImpl` — no real HTTP, the Claude OAuth API is never hit.

function fakeFetch(
  status: number,
  jsonData: unknown,
  opts: { reject?: boolean; badJson?: boolean } = {},
): typeof fetch {
  return (async () => {
    if (opts.reject) throw new Error('network down')
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (opts.badJson) throw new Error('bad json')
        return jsonData
      },
    }
  }) as unknown as typeof fetch
}

const withTok = (accessToken = 'tok', extra: Record<string, unknown> = {}) => ({
  claudeAiOauth: { accessToken, ...extra },
})

/** Capture the headers each call actually sent, so the UA rule is asserted on the wire. */
function captureFetch(status = 200, jsonData: unknown = {}) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const impl = (async (url: unknown, init: unknown) => {
    const h = ((init as { headers?: Record<string, string> })?.headers ?? {}) as Record<string, string>
    calls.push({ url: String(url), headers: h })
    return { ok: status >= 200 && status < 300, status, json: async () => jsonData }
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('TWO HOSTS, TWO OPPOSITE User-Agents (janitor#117 / TRDD-WBYFTU2L)', () => {
  /**
   * The upstream janitor "genuinely urged" this test, and the reason is that the two rules read
   * as contradictory, so a reasonable refactor unifies them — which re-introduces a DEADLOCK:
   *
   *   api.anthropic.com/api/oauth/usage answers a non-`claude-code` UA with persistent 429s, and
   *   `usageRequest` treats 429 as "this account is maxed". Send the rotator UA there and the LIVE
   *   account looks maxed AND every alternate looks unsafe in the same instant — rotation stalls
   *   exactly when it is needed. Entirely self-inflicted, from a header the server chose.
   *
   *   platform.claude.com/v1/oauth/token does the opposite: it REQUIRES `claude-account-rotator`
   *   (the default UA earns a Cloudflare 1010), so "just set claude-code globally" breaks RENEW.
   *
   * Hence both directions are pinned. Deleting either half must fail.
   */
  it('/usage sends claude-code/<version> — NEVER the rotator UA', async () => {
    const { impl, calls } = captureFetch(200, { a: 1 })
    await usageRequest(withTok(), { fetchImpl: impl, claudeVersion: '2.1.209' })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('api.anthropic.com/api/oauth/usage')
    expect(calls[0].headers['User-Agent']).toBe('claude-code/2.1.209')
    // The half that actually prevents the deadlock:
    expect(calls[0].headers['User-Agent']).not.toBe('claude-account-rotator')
  })

  it('the TOKEN endpoint sends claude-account-rotator — NEVER claude-code (Cloudflare 1010)', async () => {
    const { impl, calls } = captureFetch(200, { access_token: 'new' })
    // refreshOauthToken takes the credential BLOB and reads refreshToken out of it — it returns
    // null before any HTTP call when that field is absent, which would make `calls` empty and the
    // assertion below vacuously unreachable. Seed the refresh token.
    await refreshOauthToken(
      { claudeAiOauth: { accessToken: 'tok', refreshToken: 'refresh-tok' } },
      { fetchImpl: impl, claudeVersion: '2.1.209' },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('platform.claude.com/v1/oauth/token')
    expect(calls[0].headers['User-Agent']).toBe('claude-account-rotator')
    expect(calls[0].headers['User-Agent']).not.toMatch(/^claude-code\//)
  })

  it('falls back to a claude-code/* UA when the version cannot be read — the PREFIX is the access key', async () => {
    const { impl, calls } = captureFetch(200, {})
    await usageRequest(withTok(), { fetchImpl: impl, claudeVersion: '' })

    // The exact version is telemetry; what the endpoint gates on is the `claude-code/` prefix, so
    // an unreadable CLI must still produce a usable UA rather than falling back to the rotator one.
    expect(calls[0].headers['User-Agent']).toMatch(/^claude-code\//)
  })
})

describe('accountEmail (/roles)', () => {
  it("strips the \"'s Organization\" suffix", async () => {
    const f = fakeFetch(200, { organization_name: "x@example.com's Organization" })
    expect(await accountEmail(withTok(), { fetchImpl: f })).toBe('x@example.com')
  })
  it('returns a plain organization_name unchanged, and null for an empty one', async () => {
    expect(await accountEmail(withTok(), { fetchImpl: fakeFetch(200, { organization_name: 'plain' }) })).toBe('plain')
    expect(await accountEmail(withTok(), { fetchImpl: fakeFetch(200, { organization_name: '' }) })).toBeNull()
  })
  it('null on a non-2xx, a network error, or no token', async () => {
    expect(await accountEmail(withTok(), { fetchImpl: fakeFetch(403, null) })).toBeNull()
    expect(await accountEmail(withTok(), { fetchImpl: fakeFetch(0, null, { reject: true }) })).toBeNull()
    expect(await accountEmail({ claudeAiOauth: {} }, { fetchImpl: fakeFetch(200, {}) })).toBeNull()
  })
})

describe('usageRequest (/usage) — status is load-bearing', () => {
  it('200 → [200, data]', async () => {
    const data = { five_hour: { utilization: 42 } }
    expect(await usageRequest(withTok(), { fetchImpl: fakeFetch(200, data) })).toEqual([200, data])
  })
  it('429 → [429, null] (maxed — the rotate-away signal)', async () => {
    expect(await usageRequest(withTok(), { fetchImpl: fakeFetch(429, null) })).toEqual([429, null])
  })
  it('network error → [0, null]; no token → [0, null]', async () => {
    expect(await usageRequest(withTok(), { fetchImpl: fakeFetch(0, null, { reject: true }) })).toEqual([0, null])
    expect(await usageRequest({ claudeAiOauth: {} }, { fetchImpl: fakeFetch(200, {}) })).toEqual([0, null])
  })
  it('accountUsage returns the data on 200, else null', async () => {
    expect(await accountUsage(withTok(), { fetchImpl: fakeFetch(200, { a: 1 }) })).toEqual({ a: 1 })
    expect(await accountUsage(withTok(), { fetchImpl: fakeFetch(429, null) })).toBeNull()
  })
})

describe('refreshOauthToken (RENEW exchange)', () => {
  it('sends a faithful POST (grant_type/client_id/refresh_token + the required UA) and updates the blob', async () => {
    let captured: { url?: string; init?: RequestInit } = {}
    const recording = (async (url: string, init: RequestInit) => {
      captured = { url, init }
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'NEW', refresh_token: 'NEWR', expires_in: 3600 }),
      }
    }) as unknown as typeof fetch
    const out = await refreshOauthToken(withTok('OLD', { refreshToken: 'OLDR', keepMe: 1 }), {
      fetchImpl: recording,
    })
    expect(captured.url).toBe('https://platform.claude.com/v1/oauth/token')
    expect(captured.init!.method).toBe('POST')
    expect(JSON.parse(captured.init!.body as string)).toEqual({
      grant_type: 'refresh_token',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      refresh_token: 'OLDR',
    })
    expect((captured.init!.headers as Record<string, string>)['User-Agent']).toBe('claude-account-rotator')
    const inner = (out as { claudeAiOauth: Record<string, unknown> }).claudeAiOauth
    expect(inner.accessToken).toBe('NEW')
    expect(inner.refreshToken).toBe('NEWR')
    expect(inner.keepMe).toBe(1) // other inner fields preserved
    expect(typeof inner.expiresAt).toBe('number') // computed from expires_in
  })

  it('keeps the OLD refresh token when the response omits one (non-rotating server)', async () => {
    const out = await refreshOauthToken(withTok('OLD', { refreshToken: 'OLDR' }), {
      fetchImpl: fakeFetch(200, { access_token: 'NEW' }),
    })
    expect((out as { claudeAiOauth: Record<string, unknown> }).claudeAiOauth.refreshToken).toBe('OLDR')
  })

  it('null when: no refreshToken in the blob, a non-2xx, or a response without an access token', async () => {
    expect(await refreshOauthToken(withTok('OLD'), { fetchImpl: fakeFetch(200, { access_token: 'x' }) })).toBeNull()
    expect(
      await refreshOauthToken(withTok('OLD', { refreshToken: 'R' }), { fetchImpl: fakeFetch(403, null) }),
    ).toBeNull()
    expect(
      await refreshOauthToken(withTok('OLD', { refreshToken: 'R' }), { fetchImpl: fakeFetch(200, { nope: 1 }) }),
    ).toBeNull()
  })
})

describe('util', () => {
  it('extracts a window utilization percent, else null', () => {
    expect(util({ five_hour: { utilization: 55 } }, 'five_hour')).toBe(55)
    expect(util({ five_hour: {} }, 'five_hour')).toBeNull()
    expect(util(null, 'five_hour')).toBeNull()
    expect(util({ five_hour: { utilization: 'x' } }, 'five_hour')).toBeNull()
  })
})
