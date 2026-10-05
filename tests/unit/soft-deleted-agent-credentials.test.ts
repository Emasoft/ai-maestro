import { describe, it, expect, vi, beforeEach } from 'vitest'

// TRDD-8E6XMDEX: a soft-deleted agent keeps its registry row (resurrection /
// rolled-back delete), so its session secret must not authenticate while
// deletedAt is set, and must authenticate again once deletedAt is removed.
// The registry double is stateful: reads reflect writes. session-secret is real.

interface Row { id: string; name: string; deletedAt?: string; metadata?: Record<string, unknown> }
const store: { rows: Row[] } = { rows: [] }

vi.mock('@/lib/agent-registry', () => ({
  loadAgents: () => store.rows,
  getAgent: (id: string, includeDeleted = false) => {
    const r = store.rows.find(a => a.id === id) ?? null
    return r && r.deletedAt && !includeDeleted ? null : r
  },
}))
vi.mock('@/lib/governance', () => ({ isManager: () => false, isChiefOfStaffAnywhere: () => false }))
vi.mock('@/lib/team-registry', () => ({ loadTeams: () => [] }))
vi.mock('@/lib/security-config', () => ({ loadSecurityConfig: () => ({ ledger: { enforceAidAssociation: false } }) }))

import { authenticateAgent } from '@/lib/agent-auth'
import { generateSessionSecret } from '@/lib/session-secret'

let secret: string
const row = () => store.rows[0]

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
    row().deletedAt = new Date().toISOString()
    const r = authenticateAgent('Bearer ' + secret, null)
    expect(r.status).toBe(401)
    expect(r.error).toBe('Invalid or expired session secret')
    expect(r.agentId).toBeUndefined()
  })

  it('secret authenticates again after deletedAt is removed (rolled-back delete)', () => {
    /** Removing deletedAt restores validity with no other step */
    row().deletedAt = new Date().toISOString()
    delete row().deletedAt
    expect(authenticateAgent('Bearer ' + secret, null).agentId).toBe('agent-1')
  })
})
