/**
 * TRDD-WNZ72SFO — the subconscious badge can say something other than "Running".
 *
 * That sounds like a joke and it is the whole point. The badge branched on two
 * fields the service hardcoded: `initialized: true` (until TRDD-YEE33F3A) and
 * `isWarmingUp: false` (until now). Nothing ever asserted that the badge COULD
 * take another value, so for as long as those constants stood, the component was
 * a function of nothing and no one noticed.
 *
 * So these tests are not about colours. They pin the two properties that the
 * tautologies violated:
 *   1. every state is REACHABLE — no branch is dead;
 *   2. every state is EXCLUSIVE — `isRunning: false` can never read "Running".
 *
 * There is no `warming` state to test, deliberately: the window it would name is
 * sub-millisecond against a 30s poll, so no user could observe it. A state that
 * cannot be seen is not a state.
 */

import { describe, it, expect } from 'vitest'
import {
  subconsciousBadgeState,
  SUBCONSCIOUS_BADGE_TITLE,
  SUBCONSCIOUS_BADGE_LABEL,
  SUBCONSCIOUS_BADGE_ICON_CLASS,
  SUBCONSCIOUS_BADGE_LABEL_CLASS,
  type SubconsciousBadgeState,
} from '@/lib/subconscious-badge'

const ALL_STATES: SubconsciousBadgeState[] = ['loading', 'error', 'running', 'inactive']

describe('every badge state is reachable', () => {
  it('a fetch in flight is loading, whatever else is true', () => {
    expect(subconsciousBadgeState({ loading: true, hasError: true, isRunning: true })).toBe('loading')
    expect(subconsciousBadgeState({ loading: true, hasError: false, isRunning: false })).toBe('loading')
  })

  it('an error outranks a running subconscious', () => {
    // A stale `isRunning: true` next to a failed check must not read as healthy.
    expect(subconsciousBadgeState({ loading: false, hasError: true, isRunning: true })).toBe('error')
  })

  it('running requires no error and no in-flight fetch', () => {
    expect(subconsciousBadgeState({ loading: false, hasError: false, isRunning: true })).toBe('running')
  })

  it('inactive is the residue, and it is reachable', () => {
    expect(subconsciousBadgeState({ loading: false, hasError: false, isRunning: false })).toBe('inactive')
  })

  it('all four states are produced by some input — no dead branch', () => {
    const produced = new Set<SubconsciousBadgeState>()
    for (const loading of [true, false]) {
      for (const hasError of [true, false]) {
        for (const isRunning of [true, false]) {
          produced.add(subconsciousBadgeState({ loading, hasError, isRunning }))
        }
      }
    }
    expect([...produced].sort()).toEqual([...ALL_STATES].sort())
  })
})

describe('the badge cannot lie about a stopped subconscious', () => {
  it('never reports Running when isRunning is false', () => {
    for (const loading of [true, false]) {
      for (const hasError of [true, false]) {
        const state = subconsciousBadgeState({ loading, hasError, isRunning: false })
        expect(state).not.toBe('running')
        expect(SUBCONSCIOUS_BADGE_LABEL[state]).not.toBe('Running')
        expect(SUBCONSCIOUS_BADGE_TITLE[state]).not.toBe('Subconscious Active')
      }
    }
  })

  it('never reports Inactive when the subconscious is running and healthy', () => {
    const state = subconsciousBadgeState({ loading: false, hasError: false, isRunning: true })
    expect(SUBCONSCIOUS_BADGE_LABEL[state]).toBe('Running')
    expect(SUBCONSCIOUS_BADGE_TITLE[state]).toBe('Subconscious Active')
  })
})

describe('the presentation maps are total', () => {
  // A partial map would render `undefined` — the failure mode a `Record` type
  // catches at compile time and a future refactor to a plain object would not.
  it.each(ALL_STATES)('%s has a title, a label, and both class names', (state) => {
    expect(SUBCONSCIOUS_BADGE_TITLE[state]).toBeTruthy()
    expect(SUBCONSCIOUS_BADGE_LABEL[state]).toBeTruthy()
    expect(SUBCONSCIOUS_BADGE_ICON_CLASS[state]).toBeTruthy()
    expect(SUBCONSCIOUS_BADGE_LABEL_CLASS[state]).toBeTruthy()
  })

  it('distinct states are distinctly labelled', () => {
    const labels = ALL_STATES.map(s => SUBCONSCIOUS_BADGE_LABEL[s])
    expect(new Set(labels).size).toBe(ALL_STATES.length)
  })

  it('no state is named "Warming Up" — the state was deleted, not renamed', () => {
    const strings = [
      ...Object.values(SUBCONSCIOUS_BADGE_LABEL),
      ...Object.values(SUBCONSCIOUS_BADGE_TITLE),
    ]
    expect(strings.some(s => /warming/i.test(s))).toBe(false)
  })
})
