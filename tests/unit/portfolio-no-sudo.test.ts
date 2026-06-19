/**
 * R32 REGRESSION (CRITICAL) — an agent NEVER faces a sudo gate on the portfolio
 * route. The portfolio approval/mandate token IS the R28 substitute for sudo on
 * agent calls; the dashboard mint path also stays sudo-free here (canIssue
 * grants system-owner). This test LOCKS R32 in two ways:
 *
 *  1. STATIC invariant — the portfolio route source never imports/calls
 *     requireSudoToken, and security-registry.json does NOT classify any
 *     portfolio route as strict (so requireSudoToken would be a no-op even if
 *     called).
 *  2. BEHAVIORAL — an agent (MANAGER) Bearer POST with NO X-Sudo-Token header
 *     succeeds (201). If the route had a sudo gate, a missing token would 403.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── Behavioral mocks: a MANAGER agent caller, store/ledger/sign stubbed so the
//    handler runs without touching disk. ──────────────────────────────────────
const { mockAuth, mockStore, mockLedger, mockSign, mockGuard } = vi.hoisted(() => ({
  mockAuth: {
    // A verified MANAGER agent (agentId set) — NOT a system-owner. The most
    // important case: a real agent caller must pass with no sudo token.
    authenticateFromRequest: vi.fn(() => ({ agentId: 'mgr-1', governanceTitle: 'manager', teamId: null })),
    buildAuthContext: vi.fn((a: { agentId?: string; governanceTitle?: string; teamId?: string | null }) => ({
      agentId: a.agentId,
      isSystemOwner: !a.agentId,
      governanceTitle: a.governanceTitle,
      teamId: a.teamId,
    })),
  },
  mockStore: {
    issueToken: vi.fn(() => Promise.resolve()),
    setLedgerSeq: vi.fn(() => Promise.resolve()),
    findActiveTokens: vi.fn(() => []),
    loadPortfolio: vi.fn(() => []),
    getTokenById: vi.fn(() => undefined),
    revokeToken: vi.fn(() => Promise.resolve(true)),
  },
  mockLedger: {
    emitPortfolioOp: vi.fn(() => Promise.resolve(7)), // a real anchor seq
    issueDiff: vi.fn(() => []),
    revokeDiff: vi.fn(() => []),
  },
  mockSign: {
    signPortfolioToken: vi.fn(() => 'host-sig'),
  },
  mockGuard: {
    // The MANAGER is allowed to mint.
    canIssue: vi.fn(() => ({ ok: true })),
  },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/portfolio-store', () => mockStore)
vi.mock('@/lib/portfolio-ledger', () => mockLedger)
vi.mock('@/lib/portfolio-sign', () => mockSign)
vi.mock('@/lib/portfolio-issue-guard', () => mockGuard)
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))

import { POST } from '@/app/api/agents/[id]/portfolio/route'
import { NextRequest } from 'next/server'
import { requiresSudo } from '@/lib/security-registry'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.authenticateFromRequest.mockReturnValue({ agentId: 'mgr-1', governanceTitle: 'manager', teamId: null })
})

function postRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost:23000/api/agents/sub-1/portfolio'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' }, // deliberately NO x-sudo-token
    body: JSON.stringify(body),
  } as any)
}

describe('R32 — agent portfolio mint requires NO sudo token (behavioral)', () => {
  it('a MANAGER agent POST with NO X-Sudo-Token succeeds (201)', async () => {
    const req = postRequest({ kind: 'mandate', scope: 'agent:create' })
    const res = await POST(req, { params: Promise.resolve({ id: 'sub-1' }) })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.scope).toBe('agent:create')
    // Sanity: the request never carried a sudo token, and the handler still
    // minted (proving no sudo gate intercepted it).
    expect(req.headers.get('x-sudo-token')).toBeNull()
  })

  it('the route does NOT 403 with a sudo_required error when the token is absent', async () => {
    const req = postRequest({ kind: 'approval', scope: 'agent:create' })
    const res = await POST(req, { params: Promise.resolve({ id: 'sub-1' }) })
    expect(res.status).not.toBe(403)
    const json = await res.json()
    expect(json.error).not.toBe('sudo_required')
  })
})

describe('R32 — static invariants', () => {
  it('the portfolio route source never IMPORTS or CALLS requireSudoToken', () => {
    const routePath = path.join(
      process.cwd(),
      'app',
      'api',
      'agents',
      '[id]',
      'portfolio',
      'route.ts',
    )
    const src = fs.readFileSync(routePath, 'utf-8')
    // The doc comment legitimately MENTIONS requireSudoToken ("does NOT call
    // requireSudoToken"); the invariant is that it's never imported or invoked.
    // Strip block + line comments, then assert no import / no call survives.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/^\s*\/\/.*$/gm, '') // line comments
    expect(code).not.toMatch(/import[\s\S]*requireSudoToken/)
    expect(code).not.toMatch(/requireSudoToken\s*\(/)
  })

  it('security-registry does NOT classify the portfolio route as strict (agent path stays sudo-free)', () => {
    expect(requiresSudo('POST', '/api/agents/[id]/portfolio')).toBe(false)
    expect(requiresSudo('GET', '/api/agents/[id]/portfolio')).toBe(false)
    expect(requiresSudo('DELETE', '/api/agents/[id]/portfolio')).toBe(false)
  })
})
