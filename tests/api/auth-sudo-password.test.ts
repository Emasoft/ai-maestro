/**
 * Unit tests for POST /api/auth/sudo-password (the R32 mint route).
 *
 * Covers: an AGENT caller → 403 sudo_user_only (R32.2); the system owner →
 * token issued with subject 'system-owner'; the per-subject quota cap; and the
 * operation-path normalization (literal → strict-route template).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentAuthResult } from '@/lib/agent-auth'

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockAuthenticate = vi.fn<() => AgentAuthResult>()
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: () => mockAuthenticate(),
  buildAuthContext: (r: AgentAuthResult) => ({
    agentId: r.agentId,
    isSystemOwner: !r.agentId,
    governanceTitle: r.governanceTitle,
    teamId: r.teamId,
  }),
}))

const mockIssue = vi.fn<(...a: unknown[]) => Promise<{ token: string; expiresAt: number }>>()
const mockCountBySubject = vi.fn<(s: string) => number>(() => 0)
vi.mock('@/lib/sudo-auth', () => ({
  issueSudoToken: (...args: unknown[]) => mockIssue(...args),
  countBySubject: (s: string) => mockCountBySubject(s),
}))

const mockIsLockedDown = vi.fn<() => boolean>(() => false)
vi.mock('@/lib/kill-switch', () => ({
  isLockedDown: () => mockIsLockedDown(),
  recordAuthFailure: vi.fn(),
  recordAuthSuccess: vi.fn(),
}))

const mockCheckRate = vi.fn<() => { allowed: boolean }>(() => ({ allowed: true }))
vi.mock('@/lib/rate-limit', () => ({
  checkAndRecordAttempt: () => mockCheckRate(),
}))

const mockMatchedEntryKey = vi.fn<(m: string, p: string) => string | null>()
vi.mock('@/lib/security-registry', () => ({
  matchedEntryKey: (m: string, p: string) => mockMatchedEntryKey(m, p),
}))

import { POST } from '@/app/api/auth/sudo-password/route'

// ── Helpers ──────────────────────────────────────────────────────────────────
function postRequest(body: unknown): import('next/server').NextRequest {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsLockedDown.mockReturnValue(false)
  mockCheckRate.mockReturnValue({ allowed: true })
  mockCountBySubject.mockReturnValue(0)
  mockMatchedEntryKey.mockReturnValue(null)
  mockIssue.mockResolvedValue({ token: 'tok', expiresAt: 123 })
})

describe('POST /api/auth/sudo-password — R32.2 gate', () => {
  it('refuses an AGENT caller with 403 sudo_user_only', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'agent-1', governanceTitle: 'manager' })
    const res = await POST(postRequest({ password: 'pw' }))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('sudo_user_only')
    // No token is ever minted for an agent.
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('issues a token for the system owner with subject system-owner', async () => {
    mockAuthenticate.mockReturnValue({}) // system owner
    const res = await POST(postRequest({ password: 'pw' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token?: string }
    expect(body.token).toBe('tok')
    expect(mockIssue).toHaveBeenCalledWith('pw', 'system-owner', undefined)
  })

  it('returns 401 when authentication fails (forged cookie)', async () => {
    mockAuthenticate.mockReturnValue({ error: 'Authentication required.', status: 401 })
    const res = await POST(postRequest({ password: 'pw' }))
    expect(res.status).toBe(401)
    expect(mockIssue).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/sudo-password — SUDO-05 quota', () => {
  it('rejects with 429 when the system-owner quota is already at the cap', async () => {
    mockAuthenticate.mockReturnValue({})
    mockCountBySubject.mockReturnValue(2) // at cap
    const res = await POST(postRequest({ password: 'pw' }))
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toBe('sudo_token_quota_exceeded')
    expect(mockIssue).not.toHaveBeenCalled()
  })

  it('allows when under the cap', async () => {
    mockAuthenticate.mockReturnValue({})
    mockCountBySubject.mockReturnValue(1)
    const res = await POST(postRequest({ password: 'pw' }))
    expect(res.status).toBe(200)
    expect(mockIssue).toHaveBeenCalled()
  })
})

describe('POST /api/auth/sudo-password — SUDO-01 operation normalization', () => {
  it('normalizes the literal path to the strict-route template before binding', async () => {
    mockAuthenticate.mockReturnValue({})
    // The registry resolves the literal DELETE /api/agents/abc123 to its template key.
    mockMatchedEntryKey.mockReturnValue('DELETE_/api/agents/[id]')
    const res = await POST(
      postRequest({ password: 'pw', operation: { method: 'delete', path: '/api/agents/abc123' } })
    )
    expect(res.status).toBe(200)
    expect(mockIssue).toHaveBeenCalledWith('pw', 'system-owner', {
      method: 'DELETE',
      path: '/api/agents/[id]',
    })
  })

  it('binds to the literal path when it matches no strict entry', async () => {
    mockAuthenticate.mockReturnValue({})
    mockMatchedEntryKey.mockReturnValue(null)
    const res = await POST(
      postRequest({ password: 'pw', operation: { method: 'POST', path: '/api/unknown' } })
    )
    expect(res.status).toBe(200)
    expect(mockIssue).toHaveBeenCalledWith('pw', 'system-owner', {
      method: 'POST',
      path: '/api/unknown',
    })
  })
})
