import { describe, it, expect } from 'vitest'
import { resolveAgentStatus } from '@/lib/agent-status'

// TRDD-TBGGUA2V P3 — richer agent state. resolveAgentStatus gained two
// API-class states (rate_limited, api_error) fed by the hook's StopFailure
// classifier through the notificationType channel. These tests pin the
// presentation (color/label/pulse) AND the priority ordering, and guard the
// pre-existing 5 states against regression.

describe('resolveAgentStatus — API-class states (P3)', () => {
  it('maps rate_limited to a distinct throttled indicator (purple, pulsing)', () => {
    const s = resolveAgentStatus(true, false, undefined, 'rate_limited', true)
    expect(s.label).toBe('Rate limited')
    expect(s.color).toBe('bg-purple-500')
    expect(s.pulse).toBe(true)
  })

  it('maps api_error to a distinct error indicator (red, pulsing)', () => {
    const s = resolveAgentStatus(true, false, undefined, 'api_error', true)
    expect(s.label).toBe('API error')
    expect(s.color).toBe('bg-red-600')
    expect(s.pulse).toBe(true)
  })

  it('API-class states win over a stale permission/idle activity signal', () => {
    // The hook rewrites state per event, so a rate_limited/api_error
    // notificationType is the most recent signal and must dominate.
    expect(resolveAgentStatus(true, false, 'active', 'rate_limited', true).label).toBe('Rate limited')
    expect(resolveAgentStatus(true, false, 'waiting', 'api_error', true).label).toBe('API error')
  })

  it('Exited (programRunning === false) still wins over everything', () => {
    expect(resolveAgentStatus(true, false, 'active', 'rate_limited', false).label).toBe('Exited')
  })
})

describe('resolveAgentStatus — pre-existing states (regression)', () => {
  it('still resolves the original 5 online/offline states', () => {
    expect(resolveAgentStatus(true, false, undefined, 'permission_prompt', true).label).toBe('Permission')
    expect(resolveAgentStatus(true, false, undefined, 'idle_prompt', true).label).toBe('Waiting')
    expect(resolveAgentStatus(true, false, 'waiting', undefined, true).label).toBe('Waiting')
    expect(resolveAgentStatus(true, false, 'active', undefined, true).label).toBe('Active')
    expect(resolveAgentStatus(true, false, undefined, undefined, true).label).toBe('Idle')
    expect(resolveAgentStatus(false, true, undefined, undefined, undefined).label).toBe('Hibernated')
    expect(resolveAgentStatus(false, false, undefined, undefined, undefined).label).toBe('Offline')
  })
})
