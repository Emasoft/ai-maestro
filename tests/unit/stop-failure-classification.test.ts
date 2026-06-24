import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// TRDD-TBGGUA2V P3 — the hook (scripts/ai-maestro-hook.cjs) classifies a
// Claude Code StopFailure event into a notificationType ('rate_limited' |
// 'api_error') that flows end-to-end to resolveAgentStatus. The hook is a CJS
// module guarded by `require.main === module`, so requiring it here is
// side-effect-free (no stdin read, no fetch) and exposes the pure classifier.
const requireCjs = createRequire(import.meta.url)
const { classifyStopFailure } = requireCjs('../../scripts/ai-maestro-hook.cjs') as {
  classifyStopFailure: (input: unknown) => 'rate_limited' | 'api_error'
}

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
