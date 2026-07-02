/**
 * Unit tests for `lib/program-args.ts`. Locks down the contract for
 * Gate 16b in `ChangeTitle` — a regression here would re-open the
 * 2026-05-06 bug where MANAGER plugin was installed but `--agent` still
 * pointed at a stale main-agent.
 */

import { describe, it, expect } from 'vitest'
import { setClaudeAgentFlag, mainAgentNameForPlugin } from '@/lib/program-args'

describe('mainAgentNameForPlugin', () => {
  it('appends the canonical -main-agent suffix', () => {
    expect(mainAgentNameForPlugin('ai-maestro-assistant-manager-agent'))
      .toBe('ai-maestro-assistant-manager-agent-main-agent')
    expect(mainAgentNameForPlugin('backend-infrastructure-engineer'))
      .toBe('backend-infrastructure-engineer-main-agent')
  })
})

describe('setClaudeAgentFlag — replace', () => {
  it('replaces an existing --agent <name> with the new main-agent', () => {
    const before = '--agent backend-infrastructure-engineer-main-agent --name jack-bot'
    const after = setClaudeAgentFlag(before, 'ai-maestro-assistant-manager-agent-main-agent')
    expect(after).toBe('--agent ai-maestro-assistant-manager-agent-main-agent --name jack-bot')
  })

  it('preserves all unrelated flags (--name, --dangerously-skip-permissions, --continue)', () => {
    const before = '--agent foo-main-agent --name bot --dangerously-skip-permissions --continue'
    const after = setClaudeAgentFlag(before, 'bar-main-agent')
    expect(after).toBe('--agent bar-main-agent --name bot --dangerously-skip-permissions --continue')
  })

  it('handles --agent at the start of the string', () => {
    const after = setClaudeAgentFlag('--agent old', 'new-main-agent')
    expect(after).toBe('--agent new-main-agent')
  })

  it('handles --agent in the middle when other flags precede it', () => {
    const before = '--name jack-bot --agent foo-main-agent --dangerously-skip-permissions'
    const after = setClaudeAgentFlag(before, 'bar-main-agent')
    expect(after).toBe('--name jack-bot --agent bar-main-agent --dangerously-skip-permissions')
  })

  it('is idempotent — calling with same target twice yields the same string', () => {
    const before = '--agent foo-main-agent --name jack-bot'
    const once = setClaudeAgentFlag(before, 'new-main-agent')
    const twice = setClaudeAgentFlag(once, 'new-main-agent')
    expect(twice).toBe(once)
  })
})

describe('setClaudeAgentFlag — insert', () => {
  it('prepends --agent <name> when no flag exists and other args are present', () => {
    const after = setClaudeAgentFlag('--name jack-bot --dangerously-skip-permissions', 'new-main-agent')
    expect(after).toBe('--agent new-main-agent --name jack-bot --dangerously-skip-permissions')
  })

  it('returns just --agent <name> when programArgs is empty', () => {
    expect(setClaudeAgentFlag('', 'new-main-agent')).toBe('--agent new-main-agent')
  })

  it('handles undefined-ish input gracefully', () => {
    // The helper coerces falsy input via `(programArgs || '').trim()`.
    expect(setClaudeAgentFlag('   ', 'foo-main-agent')).toBe('--agent foo-main-agent')
  })
})

describe('setClaudeAgentFlag — strip', () => {
  it('strips the --agent <name> token-pair when mainAgent is null', () => {
    const before = '--agent foo-main-agent --name jack-bot --dangerously-skip-permissions'
    const after = setClaudeAgentFlag(before, null)
    expect(after).toBe('--name jack-bot --dangerously-skip-permissions')
  })

  it('returns empty string when stripping the only flag', () => {
    expect(setClaudeAgentFlag('--agent foo-main-agent', null)).toBe('')
  })

  it('collapses extra whitespace produced by stripping a middle flag', () => {
    const before = '--name jack-bot --agent foo-main-agent --dangerously-skip-permissions'
    const after = setClaudeAgentFlag(before, null)
    expect(after).toBe('--name jack-bot --dangerously-skip-permissions')
  })
})
