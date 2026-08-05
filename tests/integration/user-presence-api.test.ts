/**
 * Integration tests for the AMAMA user-presence API
 * (`POST /api/sessions/me/user-input` + `GET /api/users/me/presence`).
 *
 * Spec: design/handoffs/aimaestro-server-presence-api.md (handoff from
 * the AI Maestro Assistant Manager Agent design team, 2026-05-06).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted module mocks ---------------------------------------------------

const { mockAuthenticateFromRequest, mockGetAgent, presenceFile } = vi.hoisted(() => ({
  mockAuthenticateFromRequest: vi.fn(),
  mockGetAgent: vi.fn(),
  presenceFile: { last_user_input_epoch: null as number | null },
}))

vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: (...args: unknown[]) => mockAuthenticateFromRequest(...args),
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
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

/**
 * The injected-prompt VETO (ai-maestro#117).
 *
 * WHY. `UserPromptSubmit` fires for EVERY prompt, and injection is literal keystrokes
 * (`sendKeys(…, {literal:true})`), so the hook cannot tell an injected prompt from a typed
 * one. It POSTs this route, and `fleet-recovery-runner` reads the record as "a human is at
 * the keyboard, defer" — so every queued task silently stood recovery down. The hook cannot
 * know; the SERVER does, because it did the injecting.
 *
 * These use the REAL `injectedPrompts` map rather than a double: the whole mechanism is the
 * wiring between the send sites and this route, and a faithful double of the map would still
 * pass if that wiring were broken.
 *
 * THE DIRECTION — veto on POSITIVE evidence only — is what must never invert: inferring "not
 * human" from a MISSING mark would make recovery race a live user, which is worse than the bug
 * this fixes.
 *
 * MEASURED, and not what I first wrote here. I labelled `records presence when there is NO
 * mark` the load-bearing direction guard. It is not: neutering `injectedAt !== undefined` to
 * `=== undefined` reddens the OTHER THREE and leaves that one GREEN. With no mark `injectedAt`
 * is `undefined`, so `Date.now() - undefined` is `NaN`, `NaN <= MAX_AGE` is false, and the age
 * check accidentally rescues the inverted branch into recording presence anyway.
 *
 * So the direction IS pinned — by the ensemble, not by the test named for it. Keep all four:
 * dropping any of the three on the grounds that "the direction test covers it" would leave the
 * inversion undetected. And do not trust the NaN rescue as a safety property; it is an accident
 * of evaluation order that a reorder would remove.
 */
import { injectedPrompts } from '@/services/shared-state'

const AGENT = { id: 'agent-1', name: 'alpha', sessions: [] as { status: string; index: number }[] }
// computeSessionName(name, 0) === name, so 'alpha' is this agent's session name.
const SESSION = 'alpha'

describe('user-input: injected-prompt veto (#117)', () => {
  beforeEach(() => {
    injectedPrompts.clear()
    presenceFile.last_user_input_epoch = null
    mockGetAgent.mockReturnValue(AGENT)
    mockAuthenticateFromRequest.mockReturnValue({ agentId: 'agent-1' })
  })

  it('records presence when there is NO mark — the direction guard', async () => {
    const res = await postUserInput(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveProperty('recorded_at_epoch')
    expect(presenceFile.last_user_input_epoch).toBe(1_700_000_000)
  })

  it('vetoes the echo of a fresh injection, and does NOT advance presence', async () => {
    injectedPrompts.set(SESSION, Date.now())
    const res = await postUserInput(makeRequest())
    expect(await res.json()).toEqual({ recorded: false, reason: 'injected_prompt' })
    expect(presenceFile.last_user_input_epoch).toBeNull()
  })

  it('CONSUMES the mark — the next prompt records normally', async () => {
    injectedPrompts.set(SESSION, Date.now())
    await postUserInput(makeRequest()) // vetoed, spends the mark
    const res = await postUserInput(makeRequest())
    expect(await res.json()).toHaveProperty('recorded_at_epoch')
    expect(presenceFile.last_user_input_epoch).toBe(1_700_000_000)
    expect(injectedPrompts.has(SESSION)).toBe(false)
  })

  it('discards a mark whose echo never arrived, rather than eating a real keystroke', async () => {
    injectedPrompts.set(SESSION, Date.now() - 120_000) // far past INJECTION_ECHO_MAX_AGE_MS
    const res = await postUserInput(makeRequest())
    expect(await res.json()).toHaveProperty('recorded_at_epoch')
    expect(injectedPrompts.has(SESSION)).toBe(false)
  })

  it('never vetoes a non-agent (human/cookie) caller, even with a mark present', async () => {
    // The human path has no agentId, so no session resolves and no veto can apply.
    injectedPrompts.set(SESSION, Date.now())
    mockAuthenticateFromRequest.mockReturnValue({ agentId: undefined })
    const res = await postUserInput(makeRequest())
    expect(await res.json()).toHaveProperty('recorded_at_epoch')
  })
})
