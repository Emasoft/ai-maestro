/**
 * SECURITY REGRESSION — POST /api/agents/[id]/amp-init let an agent re-mint
 * its OWN Ed25519 AMP identity keys (TRDD-YEE33F3A Part 2).
 *
 * The route's doc comment CLAIMED "Per-agent self-init is rejected to prevent
 * agents from re-minting their own identity" — but the guard read
 * `if (auth.agentId && auth.agentId !== id)`, so the self case (`agentId ===
 * id`) was the one case it never checked. The comment described the intent;
 * the code inverted it. Under TRDD-D3RP7KQZ an agent may drive its own
 * surface but never reconfigure itself, and the keypair is the sharpest
 * configuration it has: re-minting silently invalidates every signature its
 * peers trust.
 *
 * A SECOND hole the audit's table never listed: a model-ON non-maestro USER
 * principal resolves to { userId, userTitle: 'user' } with NO agentId. The
 * hand-rolled guard keyed on `auth.agentId`, so that principal skipped it
 * entirely and could re-mint ANY agent's keys. `authorize()`'s M1/U1 branch
 * denies it; the hand-rolled check could not, because it never asked.
 *
 * THE CONTRACT (system owner or MANAGER-on-other, never self): `authorize`
 * ('modify-agent') supplies the floor (self ban, user-principal ban,
 * fail-closed auth), then an in-route tighten-only branch narrows the
 * matrix's COS-on-team grant back out — key rotation is an identity
 * operation, not team coordination.
 *
 * THE DENIAL ASSERTION IS THAT NOTHING RUNS. child_process is mocked and
 * execFile must never be called on a refusal. Allowed callers are proved by
 * the guard PASSING into the 404 for an unknown agent (registry mocked to
 * null) — the run itself is never exercised here, so no real key is minted.
 *
 * FALSIFIED against the pre-fix route (guard reverted, suite re-run): the
 * three closures fail exactly — self-remint ×2 (member, MANAGER) and the
 * user-principal case reach the registry instead of 403 — while the
 * cross-agent refusals and the allowed cases still pass, since those were
 * the halves the old guard did cover.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAgentAuth, mockRegistry, mockGovernance, mockTeams, mockExec } = vi.hoisted(() => ({
  mockAgentAuth: { authenticateFromRequest: vi.fn() },
  mockRegistry: { getAgent: vi.fn(), updateAgent: vi.fn() },
  mockGovernance: { isManager: vi.fn(), isChiefOfStaffAnywhere: vi.fn(() => false) },
  mockTeams: { loadTeams: vi.fn(() => []) },
  mockExec: { execFile: vi.fn() },
}))

vi.mock('@/lib/agent-auth', () => mockAgentAuth)
vi.mock('@/lib/agent-registry', () => mockRegistry)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeams)
vi.mock('child_process', () => ({ default: mockExec, ...mockExec }))
// lib/authorization is REAL — the matrix under test is the fix.

import { POST } from '@/app/api/agents/[id]/amp-init/route'

const TARGET = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

function post(id: string = TARGET) {
  const req = new Request(`http://localhost:23000/api/agents/${id}/amp-init`, { method: 'POST' })
  return POST(req as never, { params: { id } as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGovernance.isChiefOfStaffAnywhere.mockReturnValue(false)
  mockTeams.loadTeams.mockReturnValue([])
  // Unknown agent by default: an ALLOWED caller lands on 404, proving the
  // guard passed without ever reaching execFile.
  mockRegistry.getAgent.mockReturnValue(null)
})

describe('POST /api/agents/[id]/amp-init — authorization (TRDD-YEE33F3A Part 2)', () => {
  it('an agent re-minting its OWN keys is DENIED — the closed self hole', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ agentId: TARGET, governanceTitle: 'member' })
    const res = await post(TARGET)
    expect(res.status).toBe(403)
    expect(mockExec.execFile).not.toHaveBeenCalled()
  })

  it('the MANAGER re-minting its OWN keys is DENIED — self ban has no title exemption', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ agentId: TARGET, governanceTitle: 'manager' })
    mockGovernance.isManager.mockImplementation((id: string) => id === TARGET)
    const res = await post(TARGET)
    expect(res.status).toBe(403)
    expect(mockExec.execFile).not.toHaveBeenCalled()
  })

  it('a model-ON non-maestro USER principal is DENIED — the second closed hole', async () => {
    // { userId, no agentId } skipped the old `auth.agentId`-keyed guard entirely.
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ userId: 'user-1', userTitle: 'user' })
    const res = await post(TARGET)
    expect(res.status).toBe(403)
    expect(mockExec.execFile).not.toHaveBeenCalled()
  })

  it('a non-MANAGER agent targeting ANOTHER agent is DENIED', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ agentId: OTHER, governanceTitle: 'member' })
    mockGovernance.isManager.mockReturnValue(false)
    const res = await post(TARGET)
    expect(res.status).toBe(403)
    expect(mockExec.execFile).not.toHaveBeenCalled()
  })

  it("the target's own COS is DENIED — the tighten-only narrowing is load-bearing", async () => {
    // The modify-agent matrix ALLOWS a COS on its own team member; this route
    // must stay narrower. Same team ⇒ authorize() passes ⇒ only the in-route
    // isManager branch stands between the COS and a fleet-trust rotation.
    mockAgentAuth.authenticateFromRequest.mockReturnValue({
      agentId: OTHER,
      governanceTitle: 'chief-of-staff',
      teamId: 'team-1',
    })
    mockTeams.loadTeams.mockReturnValue([
      { id: 'team-1', agentIds: [TARGET, OTHER], chiefOfStaffId: OTHER },
    ] as never)
    mockGovernance.isManager.mockReturnValue(false)
    const res = await post(TARGET)
    expect(res.status).toBe(403)
    expect(mockExec.execFile).not.toHaveBeenCalled()
  })

  it('an errored auth result is DENIED fail-closed, not read as the owner', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ error: 'token_invalid', status: 401 })
    const res = await post(TARGET)
    expect(res.status).toBe(401)
    expect(mockExec.execFile).not.toHaveBeenCalled()
  })

  it('the system owner passes the guard (404 for an unknown agent proves passage)', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({})
    const res = await post(TARGET)
    expect(res.status).toBe(404)
    expect(mockExec.execFile).not.toHaveBeenCalled()
  })

  it('the MANAGER targeting ANOTHER agent passes the guard', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ agentId: OTHER, governanceTitle: 'manager' })
    mockGovernance.isManager.mockImplementation((id: string) => id === OTHER)
    const res = await post(TARGET)
    expect(res.status).toBe(404)
    expect(mockExec.execFile).not.toHaveBeenCalled()
  })
})
