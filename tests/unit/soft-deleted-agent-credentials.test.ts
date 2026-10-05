import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { dirname } from 'path'

// TRDD-8E6XMDEX: a soft-deleted agent keeps its registry row (resurrection /
// rolled-back delete), so NONE of its credentials may authenticate a new request
// while deletedAt is set, and each must authenticate again once deletedAt is removed
// (no revocation, no other step). Paths: session secret, AID governance token,
// AMP API key, IBCT. The registry double is stateful: reads reflect writes.
// session-secret, aid-token and amp-auth are REAL, writing to a temp state root
// (0-IMPACT: ecosystem-constants is redirected before the first import).
// DOUBLED: the registry, governance/team/security-config, and verifyCompactIbct
// (the IBCT host signing key lives in real state; the double returns claims).

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-softdel-cred-'))
  return { FAKE_HOME: path.join(root, 'home'), FAKE_STATE: path.join(root, 'state') }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

interface Row { id: string; name: string; deletedAt?: string; metadata?: Record<string, unknown> }
const store: { rows: Row[] } = { rows: [] }
const ibct = vi.hoisted(() => ({ sub: '' }))

vi.mock('@/lib/agent-registry', () => ({
  loadAgents: () => store.rows,
  loadAgentsStrict: () => store.rows,
  getAgent: (id: string, includeDeleted = false) => {
    const r = store.rows.find(a => a.id === id) ?? null
    return r && r.deletedAt && !includeDeleted ? null : r
  },
}))
vi.mock('@/lib/governance', () => ({ isManager: () => false, isChiefOfStaffAnywhere: () => false }))
vi.mock('@/lib/team-registry', () => ({ loadTeams: () => [] }))
vi.mock('@/lib/security-config', () => ({ loadSecurityConfig: () => ({ ledger: { enforceAidAssociation: false } }) }))
vi.mock('@/lib/ibct', () => ({
  verifyCompactIbct: async () => ({ iss: 'aip:key:ed25519:host', sub: ibct.sub, scope: ['*'], max_depth: 1 }),
}))

import { authenticateAgent, authenticateFromRequestAsync } from '@/lib/agent-auth'
import { generateSessionSecret } from '@/lib/session-secret'
import { issueGovernanceToken, revokeTokensForAgentCompensable } from '@/lib/aid-token'
import { createApiKey } from '@/lib/amp-auth'

afterAll(() => { rmSync(dirname(FAKE_STATE), { recursive: true, force: true }) })

let secret: string


// The real token store persists across tests: start each from zero tokens so counts are exact.
beforeEach(async () => {
  await revokeTokensForAgentCompensable('agent-1')
  await revokeTokensForAgentCompensable('agent-2')
})

const row = () => store.rows[0]
const softDelete = (r: Row = row()) => { r.deletedAt = new Date().toISOString() }

beforeEach(() => {
  const g = generateSessionSecret()
  secret = g.secret
  store.rows = [{ id: 'agent-1', name: 'alpha', metadata: { sessionSecretHash: g.secretHash } }]
})

describe('session secret vs soft-deleted agent', () => {
  it('live agent secret authenticates (positive control)', () => {
    /** Live row with a matching hash resolves to its agent id */
    expect(authenticateAgent('Bearer ' + secret, null).agentId).toBe('agent-1')
  })

  it('same secret is refused once the row is soft-deleted', () => {
    /** Row kept with deletedAt: refused with the invalid-secret 401 */
    softDelete()
    const r = authenticateAgent('Bearer ' + secret, null)
    expect(r.status).toBe(401)
    expect(r.error).toBe('Invalid or expired session secret')
    expect(r.agentId).toBeUndefined()
  })

  it('secret authenticates again after deletedAt is removed (rolled-back delete)', () => {
    /** Removing deletedAt restores validity with no other step */
    softDelete()
    delete row().deletedAt
    expect(authenticateAgent('Bearer ' + secret, null).agentId).toBe('agent-1')
  })
})

describe('AID governance token vs soft-deleted agent', () => {
  it('(a) live agent token authenticates (positive control)', async () => {
    /** A token issued to a live row resolves to its agent id */
    const t = await issueGovernanceToken('agent-1', 'alpha', 'autonomous', null)
    expect(authenticateAgent('Bearer ' + t.access_token, null).agentId).toBe('agent-1')
  })

  it('(b) same token is refused once the row is soft-deleted', async () => {
    /** Row kept with deletedAt: refused with the invalid-token 401 */
    const t = await issueGovernanceToken('agent-1', 'alpha', 'autonomous', null)
    softDelete()
    const r = authenticateAgent('Bearer ' + t.access_token, null)
    expect(r.status).toBe(401)
    expect(r.error).toBe('Invalid or expired governance token')
    expect(r.agentId).toBeUndefined()
  })

  it('(c) revocation still FINDS the soft-deleted holder\'s token', async () => {
    /** The title-change/delete revoker is not blinded by the soft delete */
    await issueGovernanceToken('agent-1', 'alpha', 'autonomous', null)
    softDelete()
    const rev = await revokeTokensForAgentCompensable('agent-1')
    expect(rev.count).toBe(1)
  })

  it('(d) token authenticates again after deletedAt is cleared, nothing else done', async () => {
    /** Fresh agent+token: set then clear deletedAt restores validity */
    store.rows.push({ id: 'agent-2', name: 'beta' })
    const t = await issueGovernanceToken('agent-2', 'beta', 'autonomous', null)
    softDelete(store.rows[1])
    expect(authenticateAgent('Bearer ' + t.access_token, null).status).toBe(401)
    delete store.rows[1].deletedAt
    expect(authenticateAgent('Bearer ' + t.access_token, null).agentId).toBe('agent-2')
  })
})

describe('AMP API key vs soft-deleted agent', () => {
  it('live agent key authenticates (positive control)', async () => {
    /** A key created for a live row resolves to its agent id */
    const k = await createApiKey('agent-1', 'default', 'alpha@default.local')
    expect(authenticateAgent('Bearer ' + k, null).agentId).toBe('agent-1')
  })

  it('same key is refused once the row is soft-deleted, and works again when cleared', async () => {
    /** deletedAt set: 401 invalid key; cleared: authenticates with no other step */
    const k = await createApiKey('agent-1', 'default', 'alpha@default.local')
    softDelete()
    const r = authenticateAgent('Bearer ' + k, null)
    expect(r.status).toBe(401)
    expect(r.error).toBe('Invalid or expired API key')
    expect(r.agentId).toBeUndefined()
    delete row().deletedAt
    expect(authenticateAgent('Bearer ' + k, null).agentId).toBe('agent-1')
  })
})

describe('IBCT vs soft-deleted agent', () => {
  const req = { headers: { get: (n: string) => (n === 'Authorization' ? 'Bearer eyJ.fake.token' : null) } }

  it('live agent IBCT authenticates (positive control)', async () => {
    /** Valid claims whose sub is a live row resolve to its agent id */
    ibct.sub = 'aip:key:ed25519:agent-1'
    expect((await authenticateFromRequestAsync(req)).agentId).toBe('agent-1')
  })

  it('same IBCT is refused once the row is soft-deleted, and works again when cleared', async () => {
    /** deletedAt set: 401 invalid AIP token; cleared: authenticates */
    ibct.sub = 'aip:key:ed25519:agent-1'
    softDelete()
    const r = await authenticateFromRequestAsync(req)
    expect(r.status).toBe(401)
    expect(r.error).toBe('Invalid or expired AIP token')
    delete row().deletedAt
    expect((await authenticateFromRequestAsync(req)).agentId).toBe('agent-1')
  })
})
