/**
 * Tests for the R34.1 SPEND gate (assertAidLedgerBacked) in lib/agent-auth.ts,
 * BOTH toggle states, across all three agent auth paths:
 *   - Case 3a: aim_tk_* AID governance token
 *   - Case 3b: mst_* session secret
 *   - IBCT: eyJ* compact token (authenticateFromRequestAsync)
 *
 * Decision D5: enforceAidAssociation default OFF → the gate is a no-op and auth
 * succeeds exactly as before R34 (zero regression). When ON → an agent whose
 * fingerprint has no current ledger association is rejected (403).
 *
 * Two mocking mechanisms, targeting two disjoint resolution paths:
 *   - vi.mock for the STATIC imports agent-auth uses (amp-auth, aid-token,
 *     session-auth, session-secret, ibct, security-config, aid-ledger-authority,
 *     and agent-registry's static getAgent) — vite resolves these.
 *   - Module._resolveFilename redirect to .cjs stubs for the RUNTIME
 *     `require('./agent-registry' | './governance' | './team-registry')` calls in
 *     findAgentBySessionSecret / resolveGovernanceContext — vitest does NOT
 *     resolve a bare relative `require('./x')` to .ts, and vi.mock cannot
 *     intercept a runtime require (documented gotcha). The static and runtime
 *     agent-registry views read the SAME globalThis.__SPEND_AGENT.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import path from 'path'
import { Module } from 'module'

// Redirect the RUNTIME relative requires to .cjs stubs.
const STUB_DIR = path.join(__dirname, '__agent_auth_spend_stubs__')
const REDIRECTS: Record<string, string> = {
  'agent-registry': path.join(STUB_DIR, 'agent-registry.cjs'),
  'governance': path.join(STUB_DIR, 'governance.cjs'),
  'team-registry': path.join(STUB_DIR, 'team-registry.cjs'),
}
const _origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  // ONLY the bare relative `./x` form (the runtime require). The `@/lib/x`
  // (static-import) form is left to vite + vi.mock.
  for (const [name, stub] of Object.entries(REDIRECTS)) {
    if (request === `./${name}`) return stub
  }
  return _origResolve.call(this, request, ...rest)
}
afterAll(() => {
  ;(Module as unknown as { _resolveFilename: unknown })._resolveFilename = _origResolve
})

const h = vi.hoisted(() => ({
  enforceAidAssociation: false,
  assoc: { ok: true as boolean, agentId: 'agent-1' as string | undefined, revoked: false as boolean },
  aidRecord: {
    agent_id: 'agent-1',
    governance_title: 'autonomous',
    team_id: null as string | null,
    subject_type: 'agent' as string,
  } as Record<string, unknown> | null,
  ibctClaims: { iss: 'aip:key:ed25519:abc', sub: 'aip:key:ed25519:agent-1', scope: ['*'], max_depth: 3 } as Record<string, unknown>,
}))

vi.mock('@/lib/amp-auth', () => ({ authenticateRequest: () => ({ authenticated: false }) }))
vi.mock('@/lib/aid-token', () => ({ validateGovernanceToken: () => h.aidRecord }))
vi.mock('@/lib/session-auth', () => ({
  extractSessionFromCookie: () => null,
  validateSessionWithUser: () => ({ valid: false }),
}))
vi.mock('@/lib/session-secret', () => ({
  isSessionSecret: (t: string) => t.startsWith('mst_'),
  validateSessionSecret: () => true,
}))
vi.mock('@/lib/ibct', () => ({ verifyCompactIbct: async () => h.ibctClaims }))
vi.mock('@/lib/agent-registry', () => ({
  // STATIC-import view (assertAidLedgerBacked's getAgent). Reads the same global
  // the runtime .cjs stub reads so both paths see one agent.
  loadAgents: () => [(globalThis as Record<string, unknown>).__SPEND_AGENT],
  getAgent: () => (globalThis as Record<string, unknown>).__SPEND_AGENT,
}))
vi.mock('@/lib/governance', () => ({
  isManager: () => false,
  isChiefOfStaffAnywhere: () => false,
  isUserAuthorityModelEnabled: () => false,
}))
vi.mock('@/lib/team-registry', () => ({ loadTeams: () => [] }))
vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ ledger: { enforceAidAssociation: h.enforceAidAssociation } }),
}))
vi.mock('@/lib/aid-ledger-authority', () => ({ isAidAssociated: () => h.assoc }))

import { authenticateAgent, authenticateFromRequestAsync } from '@/lib/agent-auth'

function setAgent(a: Record<string, unknown>): void {
  ;(globalThis as Record<string, unknown>).__SPEND_AGENT = a
}

beforeEach(() => {
  h.enforceAidAssociation = false
  h.assoc = { ok: true, agentId: 'agent-1', revoked: false }
  setAgent({ id: 'agent-1', name: 'alpha', metadata: { sessionSecretHash: 'hash', amp: { fingerprint: 'SHA256:fp-1' } } })
  h.aidRecord = { agent_id: 'agent-1', governance_title: 'autonomous', team_id: null, subject_type: 'agent' }
  h.ibctClaims = { iss: 'aip:key:ed25519:abc', sub: 'aip:key:ed25519:agent-1', scope: ['*'], max_depth: 3 }
})

function ibctRequest() {
  return { headers: { get: (n: string) => (n === 'Authorization' ? 'Bearer eyJfake.token.here' : null) } }
}

describe('agent-auth SPEND gate — flag OFF (default, zero regression)', () => {
  it('case 3a aim_tk_: succeeds even with NO ledger association', () => {
    h.enforceAidAssociation = false
    h.assoc = { ok: false, agentId: undefined, revoked: false }
    const res = authenticateAgent('Bearer aim_tk_xyz', null, null)
    expect(res.agentId).toBe('agent-1')
    expect(res.error).toBeUndefined()
  })

  it('case 3b mst_: succeeds even with NO ledger association', () => {
    h.enforceAidAssociation = false
    h.assoc = { ok: false, agentId: undefined, revoked: false }
    const res = authenticateAgent('Bearer mst_secret', null, null)
    expect(res.agentId).toBe('agent-1')
    expect(res.error).toBeUndefined()
  })

  it('IBCT: succeeds even with NO ledger association', async () => {
    h.enforceAidAssociation = false
    h.assoc = { ok: false, agentId: undefined, revoked: false }
    const res = await authenticateFromRequestAsync(ibctRequest())
    expect(res.agentId).toBe('agent-1')
    expect(res.error).toBeUndefined()
  })
})

describe('agent-auth SPEND gate — flag ON', () => {
  it('case 3a aim_tk_: REJECTS (403) an unbacked agent', () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: false, agentId: undefined, revoked: false }
    const res = authenticateAgent('Bearer aim_tk_xyz', null, null)
    expect(res.status).toBe(403)
    expect(res.error).toContain('aid_no_ledger_history')
  })

  it('case 3a aim_tk_: PASSES a backed agent', () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: true, agentId: 'agent-1', revoked: false }
    const res = authenticateAgent('Bearer aim_tk_xyz', null, null)
    expect(res.agentId).toBe('agent-1')
    expect(res.error).toBeUndefined()
  })

  it('case 3a aim_tk_: REJECTS when association points at a different agent', () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: true, agentId: 'someone-else', revoked: false }
    const res = authenticateAgent('Bearer aim_tk_xyz', null, null)
    expect(res.status).toBe(403)
  })

  it('case 3b mst_: REJECTS (403) an unbacked agent', () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: false, agentId: undefined, revoked: false }
    const res = authenticateAgent('Bearer mst_secret', null, null)
    expect(res.status).toBe(403)
    expect(res.error).toContain('aid_no_ledger_history')
  })

  it('case 3b mst_: PASSES a backed agent', () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: true, agentId: 'agent-1', revoked: false }
    const res = authenticateAgent('Bearer mst_secret', null, null)
    expect(res.agentId).toBe('agent-1')
  })

  it('IBCT: REJECTS (403) an unbacked agent', async () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: false, agentId: undefined, revoked: false }
    const res = await authenticateFromRequestAsync(ibctRequest())
    expect(res.status).toBe(403)
    expect(res.error).toContain('aid_no_ledger_history')
  })

  it('IBCT: PASSES a backed agent', async () => {
    h.enforceAidAssociation = true
    h.assoc = { ok: true, agentId: 'agent-1', revoked: false }
    const res = await authenticateFromRequestAsync(ibctRequest())
    expect(res.agentId).toBe('agent-1')
  })

  it('REJECTS an agent whose registry record has no fingerprint', () => {
    h.enforceAidAssociation = true
    setAgent({ id: 'agent-1', name: 'alpha', metadata: { sessionSecretHash: 'hash' } }) // no amp.fingerprint
    h.assoc = { ok: true, agentId: 'agent-1', revoked: false }
    const res = authenticateAgent('Bearer aim_tk_xyz', null, null)
    expect(res.status).toBe(403)
  })
})
