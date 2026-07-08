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

describe('resolveAgentStatus — icon hint (P6 surfacing)', () => {
  // The icon hint is what makes the new states VISIBLE (a glyph beside the dot,
  // like Permission's lock). Pin the semantic mapping so a UI consumer can render
  // it without re-deriving which states deserve a glyph.
  it('attaches a semantic icon to the three actionable states', () => {
    expect(resolveAgentStatus(true, false, undefined, 'rate_limited', true).icon).toBe('clock')
    expect(resolveAgentStatus(true, false, undefined, 'api_error', true).icon).toBe('alert')
    expect(resolveAgentStatus(true, false, undefined, 'permission_prompt', true).icon).toBe('lock')
  })

  it('leaves plain-dot states without an icon', () => {
    expect(resolveAgentStatus(true, false, 'active', undefined, true).icon).toBeUndefined()
    expect(resolveAgentStatus(true, false, undefined, 'idle_prompt', true).icon).toBeUndefined()
    expect(resolveAgentStatus(true, false, undefined, undefined, true).icon).toBeUndefined()
    expect(resolveAgentStatus(true, false, undefined, undefined, false).icon).toBeUndefined()
    expect(resolveAgentStatus(false, true, undefined, undefined, undefined).icon).toBeUndefined()
  })
})

describe('resolveAgentStatus — waiting with background subagents (TRDD-O8NCNRWO)', () => {
  // CC ≥2.1.198 runs subagents in the background by default, so an idle prompt
  // with a provably-positive counter is NOT the safe state. The flavor must be
  // visually distinct (darker amber + clock) so Stop/Restart affordances and
  // the human don't mistake it for "nothing running".
  it('shows the subagents-running waiting flavor on a positive counter', () => {
    const s = resolveAgentStatus(true, false, undefined, 'idle_prompt', true, 2)
    expect(s.label).toBe('Waiting (2 subagents)')
    expect(s.color).toBe('bg-amber-600')
    expect(s.pulse).toBe(true)
    expect(s.icon).toBe('clock')
  })

  it('singularizes the label for one subagent', () => {
    expect(resolveAgentStatus(true, false, undefined, 'idle_prompt', true, 1).label).toBe('Waiting (1 subagent)')
  })

  it('keeps plain Waiting on zero/undefined counters (stale-low tolerance, plugin#17)', () => {
    expect(resolveAgentStatus(true, false, undefined, 'idle_prompt', true, 0).label).toBe('Waiting')
    expect(resolveAgentStatus(true, false, undefined, 'idle_prompt', true, undefined).label).toBe('Waiting')
  })

  it('higher-priority states still win over the subagent flavor', () => {
    expect(resolveAgentStatus(true, false, undefined, 'permission_prompt', true, 3).label).toBe('Permission')
    expect(resolveAgentStatus(true, false, undefined, 'rate_limited', true, 3).label).toBe('Rate limited')
    expect(resolveAgentStatus(true, false, 'active', undefined, false, 3).label).toBe('Exited')
  })
})
