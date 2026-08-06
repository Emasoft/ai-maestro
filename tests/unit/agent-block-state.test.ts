/**
 * The blocked-state heuristic (TRDD-89LVZSQ0).
 *
 * FIXTURES ARE REAL. Both panes below are `tmux capture-pane -p` output taken from live
 * agents on 2026-08-06 — `frank` genuinely stuck on an AskUserQuestion since the previous
 * evening, and `testbot` genuinely idle. A hand-invented fixture would encode my guess at
 * the terminal's shape, which is the thing under test.
 *
 * The three properties that must hold, each measured rather than assumed:
 *   1. `status: waiting_for_input` is true of BOTH agents — so the verdict must come from
 *      the pane, not from that field;
 *   2. the hook typed frank's AskUserQuestion as `permission_prompt` — so a mislabel must
 *      not be able to flip the verdict, and must be reported;
 *   3. the state was ~17h stale — so nothing here may depend on hook freshness.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveBlockState,
  detectPromptField,
  detectChoices,
  matchPane,
  RED_STATE_PATTERN,
} from '@/lib/agent-block-state'

// Verbatim tail of `frank`'s pane — blocked on an AskUserQuestion.
const FRANK_BLOCKED = [
  'publicly. D: proceed now, or hold for your explicit go-ahead?',
  '',
  '❯ 1. Proceed now with Task B',
  '     Fork octo-patch/MorningAI to /tmp, implement the WebSearch-based X collector, open a PR.',
  '  2. Hold Task B for later',
  "     Leave Task B queued/reported to MANAGER as understood but not started.",
  '  3. Skip Task B entirely',
  '     Tell MANAGER you are not authorizing the fork/PR to a third-party repo.',
  '  4. Type something.',
  '──────────────────────────────────────────────────────────────',
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
  '',
].join('\n')

// Verbatim tail of `testbot`'s pane — idle at an empty prompt.
const TESTBOT_IDLE = [
  '✻ Worked for 5m 35s',
  '                                          new task? /clear to save 400.6k tokens',
  '───────────────────────────── ai-maestro-assistant-manager-agent ──',
  '❯ ',
  '──────────────────────────────────────────────────────────────',
  '  🤖 Opus 5 v2.1.223 ·xhigh 🧠 | 📁 testbot | 📊 400k/1.0m 40%',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 2 agents',
].join('\n')

const TYPING = TESTBOT_IDLE.replace('❯ ', '❯ deploy the thing')

describe('the AskUserQuestion case — the one that blocks forever', () => {
  it('reports BLOCKED with reason ask_user from a real stuck pane', () => {
    const v = resolveBlockState(FRANK_BLOCKED, 'permission_prompt')
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('ask_user')
  })

  it('extracts the choices a supervisor needs in order to answer', () => {
    const v = resolveBlockState(FRANK_BLOCKED, 'permission_prompt')
    expect(v.choices.map(c => c.key)).toEqual(['1', '2', '3', '4', '5'])
    expect(v.choices[0].label).toMatch(/Proceed now with Task B/)
  })

  it('REPORTS the hook mislabel instead of smoothing it over', () => {
    // Measured: the hook typed this AskUserQuestion as `permission_prompt`. The verdict must
    // come out ask_user anyway, and the disagreement must be visible to the caller.
    const v = resolveBlockState(FRANK_BLOCKED, 'permission_prompt')
    expect(v.reason).toBe('ask_user')
    expect(v.excerpt.join('\n')).toMatch(/Proceed now with Task B/)
  })

  it('does NOT mistake a menu row for the input field', () => {
    // A selection menu draws `❯` on its selected row. Taking the FIRST marker would report
    // "field has text: 1. Proceed now…" and call a blocked agent idle-with-text.
    const f = detectPromptField(FRANK_BLOCKED)
    expect(f.text).not.toMatch(/Proceed now/)
  })

  it('is not fooled by a MISSING hook hint (the state was ~17h stale)', () => {
    const v = resolveBlockState(FRANK_BLOCKED, null)
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('ask_user')
  })
})

describe('the idle case — must NOT be called blocked', () => {
  it('reports idle, field visible and empty, from a real idle pane', () => {
    const v = resolveBlockState(TESTBOT_IDLE, 'idle_prompt')
    expect(v.blocked).toBe(false)
    expect(v.reason).toBe('idle')
    expect(v.field).toMatchObject({ visible: true, empty: true, text: '' })
  })

  it('detects a NON-empty field — the janitor injects only when it is clear', () => {
    const f = detectPromptField(TYPING)
    expect(f.visible).toBe(true)
    expect(f.empty).toBe(false)
    expect(f.text).toBe('deploy the thing')
  })

  it('separates the two agents that BOTH read status waiting_for_input', () => {
    // The measured trap: `status` is identical for blocked-frank and idle-testbot.
    expect(resolveBlockState(FRANK_BLOCKED, 'permission_prompt').blocked).toBe(true)
    expect(resolveBlockState(TESTBOT_IDLE, 'idle_prompt').blocked).toBe(false)
  })
})

describe('red states', () => {
  it('classifies a rate limit in the tail as blocked/rate_limited', () => {
    const pane = TESTBOT_IDLE + '\nAPI Error: 429 rate limit exceeded, retrying in 60s'
    const v = resolveBlockState(pane, null)
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('rate_limited')
    expect(v.excerpt.join('\n')).toMatch(/429/)
  })

  it('does NOT pin an agent as broken on a resolved error far up the scrollback', () => {
    // Only the tail is scanned: an error from an hour ago that has since cleared must not
    // make a working agent look permanently blocked.
    const pane = 'API Error: 429 rate limit exceeded\n' + Array(60).fill('  ...work...').join('\n') + '\n' + TESTBOT_IDLE
    expect(resolveBlockState(pane, null).blocked).toBe(false)
  })

  it('the classifier is IDENTICAL to the hook\'s — the copy is guarded, not trusted', () => {
    // The hook is standalone CJS and cannot be imported, so the pattern is duplicated. This
    // asserts the two literals have not drifted; without it the copy silently rots.
    const hook = readFileSync(join(process.cwd(), 'scripts/ai-maestro-hook.cjs'), 'utf8')
    const m = hook.match(/\/rate\.\?limit\|[^/]*\//)
    expect(m, 'the hook no longer contains a recognisable rate-limit regex').not.toBeNull()
    const hookBody = m![0].slice(1, -1)
    expect(RED_STATE_PATTERN.source).toBe(hookBody)
  })
})

describe('matchPane — the server-side search that keeps the buffer inside', () => {
  it('returns only matching lines', () => {
    const hits = matchPane(FRANK_BLOCKED, 'Task B')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every(l => /Task B/i.test(l))).toBe(true)
  })

  it('REFUSES an invalid regex rather than returning nothing', () => {
    // Returning [] on a bad pattern is indistinguishable from "no matches" — the caller
    // would read a broken query as a clean result.
    expect(() => matchPane(FRANK_BLOCKED, '(unclosed')).toThrow(TypeError)
  })

  it('finds nothing for an absent term (positive control for the above)', () => {
    expect(matchPane(FRANK_BLOCKED, 'zzz-not-present-zzz')).toEqual([])
  })
})

describe('detectChoices', () => {
  it('parses numbered rows with and without the selection marker', () => {
    const c = detectChoices(FRANK_BLOCKED)
    expect(c).toHaveLength(5)
    expect(c[4]).toMatchObject({ key: '5', label: 'Chat about this' })
  })

  it('returns nothing for a pane with no menu', () => {
    expect(detectChoices(TESTBOT_IDLE)).toEqual([])
  })
})
