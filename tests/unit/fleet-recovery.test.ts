import { describe, it, expect } from 'vitest'
import {
  RECOVERY_LADDER,
  HARD_RUNGS,
  isHardRung,
  recoveryRungFor,
} from '@/lib/fleet-recovery'

describe('recovery ladder shape', () => {
  it('is the janitor-parity 7-rung ladder, gentlest first', () => {
    expect(RECOVERY_LADDER).toEqual([
      'esc_nudge',
      'rearm',
      'reload',
      'update',
      'relaunch',
      'force_restart',
      'resurrect',
    ])
  })

  it('the last three rungs are HARD', () => {
    expect([...HARD_RUNGS].sort()).toEqual(['force_restart', 'relaunch', 'resurrect'])
    expect(isHardRung('esc_nudge')).toBe(false)
    expect(isHardRung('relaunch')).toBe(true)
  })
})

describe('recoveryRungFor', () => {
  it('frozen escalates from the top, one rung per attempt', () => {
    expect(recoveryRungFor('frozen', 0, true)).toBe('esc_nudge')
    expect(recoveryRungFor('frozen', 1, true)).toBe('rearm')
    expect(recoveryRungFor('frozen', 2, true)).toBe('reload')
    expect(recoveryRungFor('frozen', 3, true)).toBe('update')
  })

  it('diagnosis picks the entry rung', () => {
    expect(recoveryRungFor('cron_dead', 0, true)).toBe('rearm')
    expect(recoveryRungFor('version_mismatch', 0, true)).toBe('reload')
    expect(recoveryRungFor('dead', 0, true)).toBe('relaunch') // a hard rung
  })

  it('clamps to the last rung on repeated attempts', () => {
    expect(recoveryRungFor('frozen', 99, true)).toBe('resurrect')
    expect(recoveryRungFor('dead', 99, true)).toBe('resurrect')
  })

  it('HARD rungs are gated: null when hardEnabled is false', () => {
    // frozen reaches relaunch (a hard rung) at attempt 4
    expect(recoveryRungFor('frozen', 4, false)).toBeNull()
    expect(recoveryRungFor('frozen', 4, true)).toBe('relaunch')
    // dead ENTERS at a hard rung — gated off ⇒ null immediately (never kill without opt-in)
    expect(recoveryRungFor('dead', 0, false)).toBeNull()
  })

  it('gentle rungs are never gated', () => {
    for (const a of [0, 1, 2, 3]) expect(recoveryRungFor('frozen', a, false)).not.toBeNull()
  })

  it('a negative or non-finite attempt is treated as 0', () => {
    expect(recoveryRungFor('frozen', -5, true)).toBe('esc_nudge')
    expect(recoveryRungFor('frozen', NaN, true)).toBe('esc_nudge')
  })
})
