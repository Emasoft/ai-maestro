import { describe, it, expect } from 'vitest'
import { computeNextAction } from '@/lib/continuity-status'
import type { AgentlensStatusMetadata } from '@/lib/agentlens-status'

function meta(over: Partial<AgentlensStatusMetadata>): AgentlensStatusMetadata {
  return {
    accountHealthy: true,
    window5hPct: 10,
    window7dPct: 10,
    cacheTtlMinutes: 60,
    windowSource: 'cc-rate-limits',
    available: true,
    ...over,
  }
}

describe('computeNextAction', () => {
  it('unknown when observability is unavailable', () => {
    expect(computeNextAction(meta({ available: false }))).toBe('unknown')
  })

  it('ok when healthy and low pressure', () => {
    expect(computeNextAction(meta({}))).toBe('ok')
  })

  it('switch-recommended when the account is rate-limited (not reauth)', () => {
    // A windowed account still has a valid token — switching, not reauth, is the remedy.
    expect(computeNextAction(meta({ accountHealthy: false }))).toBe('switch-recommended')
  })

  it('monitor when pressure is high but not exhausted', () => {
    expect(computeNextAction(meta({ window5hPct: 95, window7dPct: 20 }))).toBe('monitor')
    expect(computeNextAction(meta({ window5hPct: 20, window7dPct: 90 }))).toBe('monitor')
  })

  it('uses the max of the two windows for pressure', () => {
    expect(computeNextAction(meta({ window5hPct: 89.9, window7dPct: 89.9 }))).toBe('ok')
    expect(computeNextAction(meta({ window5hPct: 89.9, window7dPct: 90 }))).toBe('monitor')
  })

  it('treats null windows as zero pressure (unknown is not pressure)', () => {
    expect(computeNextAction(meta({ window5hPct: null, window7dPct: null }))).toBe('ok')
  })

  it('a calibrated overage never escalates past monitor (lower-bound estimate)', () => {
    // accountHealthy stays true on a calibrated overage (agentlens-status rule); pressure high
    // → monitor, never switch-recommended.
    expect(
      computeNextAction(meta({ accountHealthy: true, windowSource: 'calibrated', window5hPct: 150, window7dPct: 166 })),
    ).toBe('monitor')
  })
})
