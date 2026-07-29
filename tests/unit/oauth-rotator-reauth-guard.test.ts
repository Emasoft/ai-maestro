import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { PEER_ADDR_HEADER } from '@/lib/peer-address.mjs'

// The two collaborators are stubbed so this file isolates the CONSOLE gate — the control the USER
// ruled load-bearing. Routed through arrow wrappers and re-implemented in beforeEach: an inline
// `vi.fn(impl)` in the factory cannot be restored, so one test's override would leak into every
// test after it (vi.clearAllMocks clears CALLS, not IMPLEMENTATIONS).
const mockEnforceMaestro = vi.fn()
const mockRequireSudoToken = vi.fn()

vi.mock('@/lib/route-auth', () => ({
  enforceMaestro: (...a: unknown[]) => mockEnforceMaestro(...a),
}))
vi.mock('@/lib/sudo-guard', () => ({
  requireSudoToken: (...a: unknown[]) => mockRequireSudoToken(...a),
}))

import { guardReauthRoute } from '@/lib/oauth-rotator/reauth-guard'

beforeEach(() => {
  vi.clearAllMocks()
  mockEnforceMaestro.mockImplementation(() => null) // authenticated MAESTRO by default
  mockRequireSudoToken.mockImplementation(() => null) // fresh sudo token by default
})

/** A request carrying the address server.mjs stamped from the real TCP socket. Omit `peer` to
 *  simulate a peer the server could not determine at all. */
function req(peer?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (peer !== undefined) headers[PEER_ADDR_HEADER] = peer
  return new NextRequest('http://localhost:23000/api/oauth-rotator/reauth/start', {
    method: 'POST',
    headers,
  })
}

describe('the re-login console gate (TRDD-OX5TT5OT)', () => {
  // NB: the peer header is stamped by the server from req.socket.remoteAddress and any inbound
  // copy is DELETED first — proven in tests/unit/peer-address.test.ts, not re-litigated here. So a
  // Tailscale address in this header is exactly what a remote device produces, which is what makes
  // these cases the real remote branch rather than a loopback that only looks remote.

  it('refuses a phone on the Tailscale VPN even with a perfectly valid MAESTRO session', async () => {
    // The whole ruling in one case: the session is good, the device is wrong, and wrong-device wins.
    const res = guardReauthRoute(req('100.64.1.2'), '/api/oauth-rotator/reauth/start')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect((await res!.json()).error).toBe('console_required')
  })

  it('checks the console BEFORE touching any credential, so the route is not an oracle', () => {
    // Distinct "bad session" vs "not at the console" replies would leak which half a probe got
    // right. A remote caller must get one answer, always, and the auth path must not even run.
    guardReauthRoute(req('100.64.1.2'), '/api/oauth-rotator/reauth/start')
    expect(mockEnforceMaestro).not.toHaveBeenCalled()
    expect(mockRequireSudoToken).not.toHaveBeenCalled()
  })

  it('refuses the Tailscale IPv6 ULA range and the LAN', () => {
    for (const peer of ['fd7a:115c:a1e0::1', '192.168.1.10', '10.0.0.5']) {
      const res = guardReauthRoute(req(peer), '/api/oauth-rotator/reauth/start')
      expect(res, `peer ${peer} must be refused`).not.toBeNull()
      expect(res!.status).toBe(403)
    }
  })

  it('fails CLOSED when the server could not determine the peer at all', () => {
    const res = guardReauthRoute(req(undefined), '/api/oauth-rotator/reauth/start')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('admits the owner at their own keyboard — including the ::ffff: dual-stack form', () => {
    // The `::` bind reports an IPv4 client as ::ffff:127.0.0.1. Miss that branch and the feature
    // is dead for the only person allowed to use it, which reads as "the button is broken".
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(
        guardReauthRoute(req(peer), '/api/oauth-rotator/reauth/start'),
        `peer ${peer} must be admitted`,
      ).toBeNull()
    }
  })
})

describe('the re-login gate is three factors, not one', () => {
  it('returns the MAESTRO refusal at the console — an agent never gets past it', () => {
    const forbidden = NextResponse.json({ error: 'Forbidden — system owner only' }, { status: 403 })
    mockEnforceMaestro.mockImplementation(() => forbidden)
    const res = guardReauthRoute(req('127.0.0.1'), '/api/oauth-rotator/reauth/start')
    expect(res).toBe(forbidden)
    expect(mockRequireSudoToken).not.toHaveBeenCalled()
  })

  it('demands sudo LAST, for the exact path template the registry keys on', () => {
    const needsSudo = NextResponse.json({ error: 'sudo_required' }, { status: 403 })
    mockRequireSudoToken.mockImplementation(() => needsSudo)
    const res = guardReauthRoute(req('127.0.0.1'), '/api/oauth-rotator/reauth/complete')
    expect(res).toBe(needsSudo)
    expect(mockRequireSudoToken).toHaveBeenCalledWith(
      expect.anything(),
      'POST',
      '/api/oauth-rotator/reauth/complete',
    )
  })
})

describe('the sudo factor is actually armed', () => {
  it('both routes are classified strict — requireSudoToken is a silent NO-OP otherwise', async () => {
    // The failure this catches is invisible by inspection: with the entry missing (or the path
    // template mistyped) the guard still READS as three-factor while shipping two, and every test
    // above still passes because they stub the sudo call. Only the real registry can say.
    const { requiresSudo } = await vi.importActual<typeof import('@/lib/security-registry')>(
      '@/lib/security-registry',
    )
    expect(requiresSudo('POST', '/api/oauth-rotator/reauth/start')).toBe(true)
    expect(requiresSudo('POST', '/api/oauth-rotator/reauth/complete')).toBe(true)
    // Non-vacuity: the two above would also pass if requiresSudo answered true for everything.
    expect(requiresSudo('POST', '/api/oauth-rotator/reauth/not-a-route')).toBe(false)
  })
})
