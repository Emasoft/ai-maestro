/**
 * Integration tests for the AMAMA user-presence API
 * (`POST /api/sessions/me/user-input` + `GET /api/users/me/presence`).
 *
 * Spec: design/handoffs/aimaestro-server-presence-api.md (handoff from
 * the AI Maestro Assistant Manager Agent design team, 2026-05-06).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted module mocks ---------------------------------------------------

const { mockAuthenticateFromRequest, presenceFile } = vi.hoisted(() => ({
  mockAuthenticateFromRequest: vi.fn(),
  presenceFile: { last_user_input_epoch: null as number | null },
}))

vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: (...args: unknown[]) => mockAuthenticateFromRequest(...args),
}))

// We replace `lib/user-presence` itself so the file-system + locking
// helpers don't try to write under `~/.aimaestro/` during tests.
vi.mock('@/lib/user-presence', () => ({
  getPresence: vi.fn(() => ({ ...presenceFile })),
  recordUserInput: vi.fn(async (ts: number) => {
    if (!presenceFile.last_user_input_epoch || ts > presenceFile.last_user_input_epoch) {
      presenceFile.last_user_input_epoch = ts
    }
    return presenceFile.last_user_input_epoch
  }),
  nowEpochSeconds: vi.fn(() => 1_700_000_000),
}))

// --- Imports under test -----------------------------------------------------

import { POST as postUserInput } from '@/app/api/sessions/me/user-input/route'
import { GET as getPresence } from '@/app/api/users/me/presence/route'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', {
    method: 'GET',
    headers: new Headers(headers),
  })
}

// --- Tests ------------------------------------------------------------------

describe('AMAMA presence API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    presenceFile.last_user_input_epoch = null
  })

  describe('POST /api/sessions/me/user-input', () => {
    it('rejects unauthenticated callers with 401', async () => {
      mockAuthenticateFromRequest.mockReturnValue({ error: 'auth_required', status: 401 })
      const res = await postUserInput(makeRequest())
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('auth_required')
    })

    it('records the timestamp and returns recorded_at_epoch', async () => {
      mockAuthenticateFromRequest.mockReturnValue({ agentId: undefined }) // system owner
      const res = await postUserInput(makeRequest())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.recorded_at_epoch).toBe(1_700_000_000)
    })
  })

  describe('GET /api/users/me/presence', () => {
    it('rejects unauthenticated callers with 401', async () => {
      mockAuthenticateFromRequest.mockReturnValue({ error: 'auth_required', status: 401 })
      const res = await getPresence(makeRequest())
      expect(res.status).toBe(401)
    })

    it('returns null last_user_input_epoch + server_now_epoch when no POST has happened', async () => {
      mockAuthenticateFromRequest.mockReturnValue({ agentId: undefined })
      const res = await getPresence(makeRequest())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.last_user_input_epoch).toBeNull()
      expect(body.server_now_epoch).toBe(1_700_000_000)
    })

    it('returns the persisted epoch after a POST', async () => {
      mockAuthenticateFromRequest.mockReturnValue({ agentId: undefined })
      // Simulate a prior POST landing.
      presenceFile.last_user_input_epoch = 1_699_999_900
      const res = await getPresence(makeRequest())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.last_user_input_epoch).toBe(1_699_999_900)
      expect(body.server_now_epoch).toBe(1_700_000_000)
      // Caller computes age = server_now - last
      expect(body.server_now_epoch - body.last_user_input_epoch).toBe(100)
    })
  })
})
