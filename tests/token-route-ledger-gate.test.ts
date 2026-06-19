/**
 * Tests for the R34.1 MINT gate + R33 recovery fallback in
 * app/api/v1/auth/token/route.ts, BOTH toggle states.
 *
 * Decision D5: ledger.enforceAidAssociation default OFF → the gate is SKIPPED
 * and a token is minted exactly as before (zero regression). When ON → an AID
 * with no signed-ledger association is refused (403 aid_no_ledger_history);
 * recovery reconstructs title/team from the ledger; the ledger-derived title
 * BEATS the registry value.
 *
 * Everything around the gate (proof, keypair, team, token issue) is mocked so
 * the test isolates the gate behavior. The flag + isAidAssociated +
 * reconstructAgentAuthState are the levers under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  // flag lever
  enforceAidAssociation: false,
  // association lever
  assoc: { ok: false as boolean, agentId: undefined as string | undefined, revoked: false as boolean },
  // recovery lever
  recovered: null as null | { agentId: string; governanceTitle: string; teamId: string | null; fingerprint: string },
  // the agent the registry returns
  agent: {
    id: 'agent-1',
    name: 'alpha',
    governanceTitle: 'autonomous',
    metadata: { amp: { fingerprint: 'SHA256:fp-1' } },
  } as Record<string, unknown>,
  // capture what issueGovernanceToken was called with
  issuedWith: null as null | { agentId: string; name: string; title: string; teamId: string | null; scope: string },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkAndRecordAttempt: () => ({ allowed: true }),
  resetRateLimit: () => {},
}))

vi.mock('@/lib/aid-token', () => ({
  verifyProofWithPublicKeyHex: () => ({ valid: true }),
  issueGovernanceToken: async (agentId: string, name: string, title: string, teamId: string | null, scope: string) => {
    h.issuedWith = { agentId, name, title, teamId, scope }
    return { access_token: 'aim_tk_test', token_type: 'Bearer', expires_in: 3600 }
  },
}))

vi.mock('@/lib/amp-keys', () => ({
  loadKeyPair: () => ({ publicHex: 'deadbeef', privatePem: '', publicPem: '', fingerprint: 'SHA256:fp-1' }),
}))

vi.mock('@/lib/team-registry', () => ({
  loadTeams: () => [],
}))

vi.mock('@/lib/agent-registry', () => ({
  loadAgents: () => [h.agent],
  getAgentByName: () => h.agent,
}))

vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ ledger: { enforceAidAssociation: h.enforceAidAssociation } }),
}))

vi.mock('@/lib/aid-ledger-authority', () => ({
  isAidAssociated: () => h.assoc,
  reconstructAgentAuthState: () => h.recovered,
}))

import { POST } from '@/app/api/v1/auth/token/route'

function makeRequest(): Request {
  const identity = Buffer.from(JSON.stringify({ fingerprint: 'SHA256:fp-1', alias: 'alpha' })).toString('base64url')
  return new Request('http://localhost:23000/api/v1/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:aid:agent-identity',
      agent_identity: identity,
      proof: 'fake-proof',
    }),
  })
}

beforeEach(() => {
  h.enforceAidAssociation = false
  h.assoc = { ok: false, agentId: undefined, revoked: false }
  h.recovered = null
  h.agent = {
    id: 'agent-1',
    name: 'alpha',
    governanceTitle: 'autonomous',
    metadata: { amp: { fingerprint: 'SHA256:fp-1' } },
  }
  h.issuedWith = null
})

describe('token route R34.1 gate — flag OFF (default, zero regression)', () => {
  it('mints a token WITHOUT any ledger association when the flag is OFF', async () => {
    h.enforceAidAssociation = false
    h.assoc = { ok: false, agentId: undefined, revoked: false } // no association at all
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBe('aim_tk_test')
    // Title came from the registry (autonomous), gate did not run.
    expect(h.issuedWith?.title).toBe('autonomous')
  })
})

describe('token route R34.1 gate — flag ON', () => {
  it('REFUSES (403 aid_no_ledger_history) when no association and no recovery', async () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: false, agentId: undefined, revoked: false }
    h.recovered = null
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('aid_no_ledger_history')
    expect(h.issuedWith).toBeNull() // never reached issue
  })

  it('REFUSES when the association points at a DIFFERENT agent', async () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: true, agentId: 'someone-else', revoked: false }
    h.recovered = null
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
  })

  it('REFUSES when the association is revoked (and no recovery)', async () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: false, agentId: 'agent-1', revoked: true }
    h.recovered = null
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
  })

  it('MINTS when a valid association to THIS agent exists', async () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: true, agentId: 'agent-1', revoked: false }
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(h.issuedWith?.agentId).toBe('agent-1')
    // No recovery used → registry title.
    expect(h.issuedWith?.title).toBe('autonomous')
  })

  it('R33 recovery: when not associated but reconstruct succeeds, mint with LEDGER title (beats registry)', async () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: false, agentId: undefined, revoked: false } // token store lost
    // The registry still says 'autonomous', but the ledger reconstructs 'manager'.
    h.recovered = { agentId: 'agent-1', governanceTitle: 'manager', teamId: 'team-x', fingerprint: 'SHA256:fp-1' }
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    // R34: the ledger value is authoritative.
    expect(h.issuedWith?.title).toBe('manager')
    expect(h.issuedWith?.teamId).toBe('team-x')
  })

  it('REFUSES when reconstruct returns a DIFFERENT agent', async () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: false, agentId: undefined, revoked: false }
    h.recovered = { agentId: 'not-agent-1', governanceTitle: 'manager', teamId: null, fingerprint: 'SHA256:fp-1' }
    const res = await POST(makeRequest())
    expect(res.status).toBe(403)
  })
})
