/**
 * R5 — Transfer Rules, pinned against the two REAL route handlers.
 *
 * WHAT IS UNDER TEST, AND WHAT IS NOT
 * -----------------------------------
 * These seven rules are enforced by route handlers, not by a gate-labelled pipeline, so there is
 * no `ops` trace to assert against. The honest substitute is to drive the ACTUAL exported `POST`
 * of each route with a real `NextRequest` and fake only the layers BELOW the guard — the team /
 * transfer stores and the authority oracle. The guard logic itself is never mocked, so deleting
 * any one of these checks makes its named test fail. Each test was proven that way before landing
 * (see the neuter runs recorded in TRDD-H4Y9F25J).
 *
 * WHY THE ERROR MESSAGE IS ASSERTED, NOT JUST THE STATUS
 * -----------------------------------------------------
 * The create route returns 400 from FIVE different guards and 404 from two. A test that asserted
 * only `status === 400` would pass while a completely different guard fired — which is the exact
 * false-green this campaign exists to eliminate. Every assertion below pins a distinctive fragment
 * of the guard's own message, so the test can only pass when the intended guard is the one that
 * refused.
 *
 * ORDERING MATTERS IN THE FIXTURES
 * --------------------------------
 * The create route checks, in order: authority (R5.2) → self-transfer (R5.6) → source exists →
 * agent-in-source → destination exists (R5.5) → COS-immobility (R5.4) → source-is-closed →
 * duplicate (R5.8). A fixture that trips an EARLIER guard would give a passing test for the wrong
 * reason, so each case below is built to reach exactly the guard it names.
 *
 * 0-IMPACT: every module that touches the filesystem (both registries, the file lock, the agent
 * registry, the notifier, auth) is mocked, so this file writes nothing outside the test process.
 * `@/lib/validation` is deliberately left REAL — it is a pure regex with no imports, and keeping it
 * live means the fixtures must use genuine UUIDs, exercising the same validation production does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockTeamValidationException } from '../test-utils/service-mocks'

// ---------------------------------------------------------------------------
// The layers BELOW the guards. Declared before the route imports (vi.mock is hoisted).
// ---------------------------------------------------------------------------

const mockLoadTeams = vi.fn()
const mockSaveTeams = vi.fn()

vi.mock('@/lib/team-registry', () => ({
  loadTeams: (...a: unknown[]) => mockLoadTeams(...a),
  saveTeams: (...a: unknown[]) => mockSaveTeams(...a),
  TeamValidationException: MockTeamValidationException,
}))

const mockLoadTransfers = vi.fn()
const mockCreateTransferRequest = vi.fn()
const mockGetPendingTransfersForAgent = vi.fn()
const mockGetTransferRequest = vi.fn()
const mockResolveTransferRequest = vi.fn()
const mockRevertTransferToPending = vi.fn()

vi.mock('@/lib/transfer-registry', () => ({
  loadTransfers: (...a: unknown[]) => mockLoadTransfers(...a),
  createTransferRequest: (...a: unknown[]) => mockCreateTransferRequest(...a),
  getPendingTransfersForAgent: (...a: unknown[]) => mockGetPendingTransfersForAgent(...a),
  getTransferRequest: (...a: unknown[]) => mockGetTransferRequest(...a),
  resolveTransferRequest: (...a: unknown[]) => mockResolveTransferRequest(...a),
  revertTransferToPending: (...a: unknown[]) => mockRevertTransferToPending(...a),
}))

const mockIsManager = vi.fn()
const mockIsChiefOfStaffAnywhere = vi.fn()
const mockGetManagerId = vi.fn()

vi.mock('@/lib/governance', () => ({
  isManager: (id: string) => mockIsManager(id),
  isChiefOfStaffAnywhere: (id: string) => mockIsChiefOfStaffAnywhere(id),
  getManagerId: () => mockGetManagerId(),
}))

// The caller's identity comes from the authenticated header, never the body — that is what stops
// impersonation. The tests exercise the guards ABOVE that, so the auth itself is faked to the
// header, exactly as the other route tests in this repo do.
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: (req: { headers: { get(name: string): string | null } }) => {
    const agentId = req.headers.get('X-Agent-Id')
    return agentId ? { agentId } : { error: 'Authentication required', status: 401 }
  },
}))

const mockAcquireLock = vi.fn()
vi.mock('@/lib/file-lock', () => ({ acquireLock: (...a: unknown[]) => mockAcquireLock(...a) }))

vi.mock('@/lib/agent-registry', () => ({ getAgent: vi.fn(() => null) }))
vi.mock('@/lib/notification-service', () => ({ notifyAgent: vi.fn(() => Promise.resolve()) }))

import { POST as createTransfer } from '@/app/api/governance/transfers/route'
import { POST as resolveTransfer } from '@/app/api/governance/transfers/[id]/resolve/route'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Fixtures — real UUIDs, because `isValidUuid` is left live.
// ---------------------------------------------------------------------------

const AGENT = '11111111-1111-4111-8111-111111111111'
const COS_SRC = '22222222-2222-4222-8222-222222222222'
const MANAGER = '33333333-3333-4333-8333-333333333333'
const OUTSIDER = '44444444-4444-4444-8444-444444444444'
const COS_DST = '55555555-5555-4555-8555-555555555555'
const TEAM_SRC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEAM_DST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TEAM_OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const TEAM_GONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const XFER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

type Team = {
  id: string
  name: string
  type: string
  chiefOfStaffId: string
  agentIds: string[]
  createdAt: string
  updatedAt: string
}

const team = (over: Partial<Team> & { id: string }): Team => ({
  name: `team-${over.id.slice(0, 4)}`,
  type: 'closed',
  chiefOfStaffId: COS_SRC,
  agentIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/** Source holds the agent and its own COS; destination is a distinct closed team. */
const twoTeams = (): Team[] => [
  team({ id: TEAM_SRC, chiefOfStaffId: COS_SRC, agentIds: [AGENT, COS_SRC] }),
  team({ id: TEAM_DST, chiefOfStaffId: COS_DST, agentIds: [] }),
]

/** The same pair plus a THIRD closed team that already holds the agent — the R5.7 violation. */
const threeTeamsWithConflict = (): Team[] => [
  ...twoTeams(),
  team({ id: TEAM_OTHER, chiefOfStaffId: OUTSIDER, agentIds: [AGENT] }),
]

const pendingTransfer = (over: Record<string, unknown> = {}) => ({
  id: XFER,
  agentId: AGENT,
  fromTeamId: TEAM_SRC,
  toTeamId: TEAM_DST,
  requestedBy: COS_SRC,
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/** POST /api/governance/transfers — caller identity travels in the header, as in production. */
function createReq(body: Record<string, unknown>, callerId: string | null): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (callerId) headers['X-Agent-Id'] = callerId
  return new NextRequest('http://localhost:23000/api/governance/transfers', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

/** POST /api/governance/transfers/[id]/resolve */
function resolveReq(body: Record<string, unknown>, callerId: string | null): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (callerId) headers['X-Agent-Id'] = callerId
  return new NextRequest(`http://localhost:23000/api/governance/transfers/${XFER}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  })
}

const resolveParams = { params: Promise.resolve({ id: XFER }) }

/** The body every create-route test starts from; each case perturbs exactly one field. */
const validCreateBody = { agentId: AGENT, fromTeamId: TEAM_SRC, toTeamId: TEAM_DST }

beforeEach(() => {
  vi.clearAllMocks()

  // Authority oracle: exactly one MANAGER, exactly one COS (of the source team).
  mockIsManager.mockImplementation((id: string) => id === MANAGER)
  mockIsChiefOfStaffAnywhere.mockImplementation((id: string) => id === COS_SRC || id === COS_DST)
  mockGetManagerId.mockReturnValue(MANAGER)

  mockLoadTeams.mockReturnValue(twoTeams())
  mockSaveTeams.mockReturnValue(undefined)
  mockLoadTransfers.mockReturnValue([])
  mockGetPendingTransfersForAgent.mockReturnValue([])
  mockCreateTransferRequest.mockResolvedValue(pendingTransfer())
  mockGetTransferRequest.mockReturnValue(pendingTransfer())
  mockResolveTransferRequest.mockResolvedValue(pendingTransfer({ status: 'approved' }))
  mockAcquireLock.mockResolvedValue(vi.fn())
})

// ---------------------------------------------------------------------------
// R5.2 — only MANAGER or COS may CREATE a transfer request
// Guard: app/api/governance/transfers/route.ts:97-99
// ---------------------------------------------------------------------------

describe('R5.2 — only MANAGER or Chief-of-Staff can create transfer requests', () => {
  it('refuses a requester who is neither MANAGER nor COS (403)', async () => {
    /** An ordinary agent cannot move anybody: the authority check refuses before any team is read. */
    const res = await createTransfer(createReq(validCreateBody, OUTSIDER))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/Only MANAGER or Chief-of-Staff/)
    // Proof the refusal is the guard's and not an accident downstream: nothing was written.
    expect(mockCreateTransferRequest).not.toHaveBeenCalled()
  })

  it('admits the MANAGER (201) — the positive control that keeps the test honest', async () => {
    /** Without this, the 403 case above would still pass if EVERY request were rejected. */
    const res = await createTransfer(createReq(validCreateBody, MANAGER))
    expect(res.status).toBe(201)
    expect(mockCreateTransferRequest).toHaveBeenCalledTimes(1)
  })

  it('admits a Chief-of-Staff (201)', async () => {
    /** The second admitted title; pins the `||` branch rather than just the MANAGER branch. */
    const res = await createTransfer(createReq(validCreateBody, COS_SRC))
    expect(res.status).toBe(201)
  })

  it('refuses an unauthenticated caller before any authority check (401)', async () => {
    /** requestedBy comes from the authenticated identity, never the body — no header, no transfer. */
    const res = await createTransfer(createReq(validCreateBody, null))
    expect(res.status).toBe(401)
    expect(mockCreateTransferRequest).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// R5.3 — only the SOURCE team's COS or the MANAGER may resolve
// Guard: app/api/governance/transfers/[id]/resolve/route.ts:85-90
// ---------------------------------------------------------------------------

describe('R5.3 — only the source team COS or MANAGER can approve/reject a transfer', () => {
  it('refuses a resolver who is neither the source COS nor MANAGER (403)', async () => {
    /** Authority to resolve is scoped to the SOURCE team; an outsider cannot approve the move. */
    const res = await resolveTransfer(resolveReq({ action: 'approve' }, OUTSIDER), resolveParams)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/Only the source team COS or MANAGER/)
    expect(mockResolveTransferRequest).not.toHaveBeenCalled()
  })

  it('refuses the DESTINATION team COS — authority is source-scoped, not merely COS-ness (403)', async () => {
    /**
     * The sharp edge of R5.3: `isChiefOfStaffAnywhere` is true for the destination COS, yet the
     * guard tests `fromTeam.chiefOfStaffId === resolvedBy`. Swapping one for the other would leave
     * every other test in this file green — so this case is what pins the SOURCE half of the rule.
     */
    const res = await resolveTransfer(resolveReq({ action: 'approve' }, COS_DST), resolveParams)
    expect(res.status).toBe(403)
    expect(mockResolveTransferRequest).not.toHaveBeenCalled()
  })

  it('admits the source team COS (200)', async () => {
    const res = await resolveTransfer(resolveReq({ action: 'approve' }, COS_SRC), resolveParams)
    expect(res.status).toBe(200)
    expect(mockResolveTransferRequest).toHaveBeenCalledTimes(1)
  })

  it('admits the MANAGER (200)', async () => {
    const res = await resolveTransfer(resolveReq({ action: 'approve' }, MANAGER), resolveParams)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// R5.4 — a COS cannot be transferred out of their own team
// Guard: app/api/governance/transfers/route.ts:149-151
// ---------------------------------------------------------------------------

describe('R5.4 — the Chief-of-Staff cannot be transferred out of their own team', () => {
  it('refuses a transfer whose subject is the source team COS (400)', async () => {
    /**
     * Moving the COS out would orphan the team (no team without a COS, R3/R11). The message is
     * asserted because the create route has four other 400s; only this one names the COS.
     */
    const res = await createTransfer(
      createReq({ ...validCreateBody, agentId: COS_SRC }, MANAGER),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Chief-of-Staff out of their team/)
    expect(mockCreateTransferRequest).not.toHaveBeenCalled()
  })

  it('permits transferring an ordinary member of the same team (201)', async () => {
    /** Same team, same fixture — the ONLY difference is which agent is being moved. */
    const res = await createTransfer(createReq(validCreateBody, MANAGER))
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// R5.5 — the destination team must exist when the request is created
// Guard: app/api/governance/transfers/route.ts:143-146
// ---------------------------------------------------------------------------

describe('R5.5 — the destination team must exist', () => {
  it('refuses a transfer to a team that is not in the registry (404)', async () => {
    /** Referential integrity: a request pointing at a non-existent team could never be completed. */
    const res = await createTransfer(
      createReq({ ...validCreateBody, toTeamId: TEAM_GONE }, MANAGER),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Destination team not found/)
    expect(mockCreateTransferRequest).not.toHaveBeenCalled()
  })

  it('is re-checked at APPROVAL time, when the team may have been deleted meanwhile (404)', async () => {
    /**
     * The create-time check is not sufficient on its own — a team can be deleted between request
     * and approval. The resolve route re-checks BEFORE marking the transfer approved, so a
     * vanished destination never leaves an "approved but not moved" record on disk.
     */
    mockLoadTeams.mockReturnValue([team({ id: TEAM_SRC, agentIds: [AGENT] })])
    const res = await resolveTransfer(resolveReq({ action: 'approve' }, MANAGER), resolveParams)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/Destination team no longer exists/)
    expect(mockResolveTransferRequest).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// R5.6 — source and destination must differ
// Guard: app/api/governance/transfers/route.ts:124-126
// ---------------------------------------------------------------------------

describe('R5.6 — source and destination teams must be different', () => {
  it('refuses a self-transfer (400)', async () => {
    /**
     * A no-op that would still create a pending request and consume an approval. Note this guard
     * runs BEFORE the teams are loaded, so it refuses even for a perfectly valid team id.
     */
    const res = await createTransfer(
      createReq({ ...validCreateBody, toTeamId: TEAM_SRC }, MANAGER),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/must be different/)
    expect(mockCreateTransferRequest).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// R5.7 — approval re-checks the single-closed-team constraint (R4.1)
// Guard: app/api/governance/transfers/[id]/resolve/route.ts:103-127
// ---------------------------------------------------------------------------

describe('R5.7 — approval verifies the agent is not already in another closed team', () => {
  it('refuses approval when the agent already belongs to a third closed team (409)', async () => {
    /**
     * R4.1 can be satisfied when the request is CREATED and violated by the time it is approved.
     * The check therefore lives on the approval path, and — like R5.5's re-check — it runs before
     * `resolveTransferRequest`, so a violation never leaves an approved-but-unmoved record.
     */
    mockLoadTeams.mockReturnValue(threeTeamsWithConflict())
    const res = await resolveTransfer(resolveReq({ action: 'approve' }, MANAGER), resolveParams)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already in another closed team/)
    expect(mockResolveTransferRequest).not.toHaveBeenCalled()
  })

  it('approves the identical transfer once the third team is gone (200)', async () => {
    /** Same request, same resolver — only the conflicting membership differs. */
    const res = await resolveTransfer(resolveReq({ action: 'approve' }, MANAGER), resolveParams)
    expect(res.status).toBe(200)
  })

  it('does NOT block a REJECTION, which moves nobody (200)', async () => {
    /**
     * The constraint guards the destination membership; rejecting the transfer creates no
     * membership at all. A guard that also refused rejections would strand the request forever.
     */
    mockLoadTeams.mockReturnValue(threeTeamsWithConflict())
    const res = await resolveTransfer(resolveReq({ action: 'reject' }, MANAGER), resolveParams)
    expect(res.status).toBe(200)
    expect(mockResolveTransferRequest).toHaveBeenCalledTimes(1)
  })

  it('exempts a privileged agent (the MANAGER) from the single-closed-team constraint (200)', async () => {
    /**
     * The rule is about NORMAL agents; the MANAGER and any COS legitimately span teams. Pinning the
     * exemption stops a future "tighten the check" from silently locking the MANAGER out.
     */
    mockLoadTeams.mockReturnValue([
      team({ id: TEAM_SRC, agentIds: [MANAGER, COS_SRC] }),
      team({ id: TEAM_DST, chiefOfStaffId: COS_DST }),
      team({ id: TEAM_OTHER, chiefOfStaffId: OUTSIDER, agentIds: [MANAGER] }),
    ])
    mockGetTransferRequest.mockReturnValue(pendingTransfer({ agentId: MANAGER }))
    const res = await resolveTransfer(resolveReq({ action: 'approve' }, MANAGER), resolveParams)
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// R5.8 — duplicate pending requests are refused
// Guard: app/api/governance/transfers/route.ts:160-164
// ---------------------------------------------------------------------------

describe('R5.8 — duplicate pending transfer requests are prevented', () => {
  it('refuses a second request for the same agent between the same two teams (409)', async () => {
    /** Two pending requests for one move would let one approval fire twice. */
    mockGetPendingTransfersForAgent.mockReturnValue([pendingTransfer()])
    const res = await createTransfer(createReq(validCreateBody, MANAGER))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already exists/)
    // The refusal returns the blocking request, so the caller can act on it rather than guess.
    expect(body.existingRequest?.id).toBe(XFER)
    expect(mockCreateTransferRequest).not.toHaveBeenCalled()
  })

  it('permits a request to a DIFFERENT destination while one is pending (201)', async () => {
    /**
     * "Duplicate" is the (agent, source, destination) triple — not merely "this agent has a pending
     * request". A guard that keyed on the agent alone would pass the case above and fail here.
     */
    mockGetPendingTransfersForAgent.mockReturnValue([pendingTransfer({ toTeamId: TEAM_OTHER })])
    mockLoadTeams.mockReturnValue(threeTeamsWithConflict())
    const res = await createTransfer(createReq(validCreateBody, MANAGER))
    expect(res.status).toBe(201)
    expect(mockCreateTransferRequest).toHaveBeenCalledTimes(1)
  })
})
