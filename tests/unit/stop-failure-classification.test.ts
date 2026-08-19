import { describe, it, expect } from 'vitest'
import { classifyStopFailure } from '@/lib/agent-block-state'
import { hookStateFromChatState } from '@/services/sessions-service'

// TRDD-TBGGUA2V P3, relocated 2026-08-20: classifyStopFailure was born in the plugin hook and
// this file used to `require` the repo's STALE MIRROR of it (scripts/ai-maestro-hook.cjs,
// deleted). The LIVE hook (ai-maestro-plugin v3.1.x) no longer classifies at all — it writes
// status:'error' + errorType/message — so the classifier now lives SERVER-SIDE
// (lib/agent-block-state, sharing RED_STATE_PATTERN with the pane scan: one definition, no
// drift guard needed) and is applied on READ by sessions-service::hookStateFromChatState.
// The classification cases below transfer verbatim from the original file.

describe('classifyStopFailure — StopFailure → notificationType (P3)', () => {
  it('classifies rate-limit / overload / quota signatures as rate_limited', () => {
    expect(classifyStopFailure({ error: 'Server is temporarily limiting requests' })).toBe('rate_limited')
    expect(classifyStopFailure({ message: 'rate limit exceeded' })).toBe('rate_limited')
    expect(classifyStopFailure({ error_type: 'overloaded_error' })).toBe('rate_limited')
    expect(classifyStopFailure({ stop_reason: 'HTTP 429 Too Many Requests' })).toBe('rate_limited')
    expect(classifyStopFailure({ error: 'API Error 529: overloaded' })).toBe('rate_limited')
    expect(classifyStopFailure({ message: 'weekly quota reached' })).toBe('rate_limited')
  })

  it('classifies other API-class failures as api_error', () => {
    expect(classifyStopFailure({ error: 'authentication failed' })).toBe('api_error')
    expect(classifyStopFailure({ message: 'billing issue: payment required' })).toBe('api_error')
    expect(classifyStopFailure({ error_type: 'internal_server_error' })).toBe('api_error')
    expect(classifyStopFailure({ stop_reason: 'HTTP 500' })).toBe('api_error')
  })

  it('defaults to api_error and never throws on empty / missing input', () => {
    expect(classifyStopFailure({})).toBe('api_error')
    expect(classifyStopFailure(null)).toBe('api_error')
    expect(classifyStopFailure(undefined)).toBe('api_error')
  })

  it('is case-insensitive', () => {
    expect(classifyStopFailure({ error: 'RATE LIMIT' })).toBe('rate_limited')
    expect(classifyStopFailure({ error: 'Overloaded' })).toBe('rate_limited')
  })
})

/*
 * NEUTER RUNS (2026-08-20 — OBSERVED via scripts/dev/neuter, restores blob-hash-verified):
 *   error-branch derivation → undefined          → 1 red/8 green (the derivation test)
 *   'error' re-joins the aging states            → 2 red/7 green (persistence + derivation,
 *     the second because a day-old error state then returns null before deriving)
 */
describe('hookStateFromChatState — the server-side read that revives the dead badges', () => {
  const NOW = Date.parse('2026-08-20T01:00:00.000Z')

  it("status 'error' derives notificationType from the hook's errorType/message fields", () => {
    // Exactly what the live hook's StopFailure branch writes (v3.1.28 scripts hook,
    // case 'StopFailure'): status error, message = distilled errorMessage, errorType.
    const throttled = hookStateFromChatState(
      { status: 'error', message: 'API Error: 429 rate limit exceeded', errorType: 'rate_limit_error', updatedAt: '2026-08-19T00:00:00.000Z' },
      NOW,
    )
    expect(throttled).toEqual({ status: 'error', notificationType: 'rate_limited', subagentCount: undefined })
    const auth = hookStateFromChatState(
      { status: 'error', message: 'authentication failed', errorType: 'auth_error', updatedAt: '2026-08-19T00:00:00.000Z' },
      NOW,
    )
    expect(auth?.notificationType).toBe('api_error')
  })

  it("an 'error' state does NOT age out — a throttled agent sits far longer than 60s", () => {
    // The pre-2026-08-20 behavior aged 'error' out with the transient states, so the
    // rate-limited badge expired before anyone saw it. updatedAt above is a DAY old.
    const r = hookStateFromChatState(
      { status: 'error', message: 'quota', errorType: 'x', updatedAt: '2026-08-19T00:00:00.000Z' },
      NOW,
    )
    expect(r).not.toBeNull()
  })

  it('a transient state older than 60s is stale (null); a fresh one passes through untouched', () => {
    expect(
      hookStateFromChatState({ status: 'active', notificationType: 'idle_prompt', updatedAt: new Date(NOW - 120_000).toISOString() }, NOW),
    ).toBeNull()
    expect(
      hookStateFromChatState(
        { status: 'active', notificationType: 'idle_prompt', subagentCount: 2, updatedAt: new Date(NOW - 5_000).toISOString() },
        NOW,
      ),
    ).toEqual({ status: 'active', notificationType: 'idle_prompt', subagentCount: 2 })
  })

  it('waiting states never age out (pre-existing contract, kept)', () => {
    for (const status of ['waiting_for_input', 'permission_request']) {
      const r = hookStateFromChatState({ status, updatedAt: '2026-08-01T00:00:00.000Z' }, NOW)
      expect(r?.status).toBe(status)
    }
  })

  it('a garbage updatedAt on a transient state fails closed to stale', () => {
    expect(hookStateFromChatState({ status: 'active', updatedAt: 'not a date' }, NOW)).toBeNull()
    expect(hookStateFromChatState({ status: 'active' }, NOW)).toBeNull()
  })
})
