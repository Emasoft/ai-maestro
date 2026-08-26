import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-DQVPODKW — `POST /api/agents/health` authenticates.
 *
 * The route carried ZERO authentication needles and proxies an outbound request to
 * a caller-supplied URL. The card's open question was whether the dashboard calls
 * it pre-login (a real constraint if true). Measured 2026-08-26: the route has NO
 * callers anywhere — app/, components/, hooks/, headless *.mjs, scripts/, and the
 * fleet plugin repos all use `/api/hosts/health` or nothing. So "unauthenticated"
 * was an omission, not a requirement, and the decided policy is authenticated-only
 * (`enforceAuth`) with the SSRF denylist as the second, independent layer.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The proxy must never fire on a refused call — an outbound request made before a
// 401 would make the gate decorative.
const mockProxy = vi.fn()
vi.mock('@/services/agents-core-service', () => ({
  proxyHealthCheck: (...a: unknown[]) => mockProxy(...a),
}))

function req(body: unknown) {
  return new Request('http://localhost/api/agents/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe('TRDD-DQVPODKW — agents/health authenticates before proxying', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockProxy.mockReset()
    mockProxy.mockResolvedValue({ data: { ok: true } })
  })

  it('refuses an unauthenticated caller and never proxies', async () => {
    /** Validates the SSRF proxy is no longer reachable without any credential */
    mockAuthenticate.mockReturnValue({ error: 'Missing or invalid authorization', status: 401 })
    const { POST } = await import('@/app/api/agents/health/route')
    const res = await POST(req({ url: 'https://example.com/health' }) as never)

    expect(res.status).toBe(401)
    expect(mockProxy).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — an authenticated caller passes the gate and reaches the proxy', async () => {
    /** Validates the gate can say yes, so the refusal above is the gate and not a broken route */
    mockAuthenticate.mockReturnValue({ agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member' })
    const { POST } = await import('@/app/api/agents/health/route')
    const res = await POST(req({ url: 'https://example.com/health' }) as never)

    expect(res.status).not.toBe(401)
    expect(mockProxy).toHaveBeenCalledWith('https://example.com/health')
  })
})

/**
 * NEUTER RUN (recorded after first green run):
 *   mutation: s/if (authErr) return authErr/if (false) return authErr/
 *   predicted: the unauthenticated-refusal test reds (route proxies anyway),
 *   the positive control stays green.
 */
