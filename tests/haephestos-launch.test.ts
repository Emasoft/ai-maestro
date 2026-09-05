/**
 * Haephestos launch-args guardrail (TRDD-E5AAE555).
 *
 * The user directive is explicit: "The client must be called without the
 * --continue option, so it is always fresh." `buildHaephestosLaunchArgs()`
 * in services/creation-helper-service.ts is the ONE place the launch argv is
 * assembled (extracted from createCreationHelper() so it can be asserted
 * without spawning tmux or a real Claude Code process). This test pins the
 * two invariants a future edit could silently break:
 *   - `--continue` must NEVER appear (ephemeral, no cross-session memory)
 *   - `--agent haephestos-creation-helper` must ALWAYS appear (loads the
 *     ephemeral persona, not a generic Claude session)
 */

import { describe, test, expect } from 'vitest'
import { buildHaephestosLaunchArgs } from '@/services/creation-helper-service'

describe('Haephestos launch args — TRDD-E5AAE555', () => {
  test('never includes --continue', () => {
    const args = buildHaephestosLaunchArgs()
    expect(args.some((a) => a.includes('--continue'))).toBe(false)
  })

  test('always includes --agent haephestos-creation-helper', () => {
    const args = buildHaephestosLaunchArgs()
    expect(args).toContain('--agent haephestos-creation-helper')
  })

  test('sets a sane model', () => {
    const args = buildHaephestosLaunchArgs()
    const modelArg = args.find((a) => a.startsWith('--model '))
    expect(modelArg).toBeDefined()
    expect(modelArg).toMatch(/--model \S+/)
  })

  test('argv is built fresh each call (no mutable shared state leaking across launches)', () => {
    // Positive control: prove the two calls are independent arrays, not the
    // same reference — a shared/mutated array is exactly the kind of bug
    // that could let a caller accidentally inject --continue once and have
    // it stick for every subsequent launch.
    const a = buildHaephestosLaunchArgs()
    const b = buildHaephestosLaunchArgs()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})
