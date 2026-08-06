import { describe, it, expect } from 'vitest'
import { AGENT_COMMANDS, getAgentCommand, agentCommandKeys } from '@/lib/agent-commands'

describe('agent-commands allowlist (TRDD-TBGGUA2V P2)', () => {
  it('resolves a known key to its fixed command', () => {
    const c = getAgentCommand('reload-plugins')
    expect(c).toBeDefined()
    expect(c?.command).toBe('/reload-plugins')
    expect(c?.requiresIdle).toBe(true)
  })

  it('returns undefined for an unknown / unsafe key (the allowlist is the boundary)', () => {
    expect(getAgentCommand('rm -rf /')).toBeUndefined()
    expect(getAgentCommand('')).toBeUndefined()
    expect(getAgentCommand('eval')).toBeUndefined()
    expect(getAgentCommand('/reload-plugins')).toBeUndefined() // must use the KEY, not the raw command
  })

  it('has unique keys', () => {
    const keys = agentCommandKeys()
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every command is a literal slash-command with NO shell metacharacters (injection-proof)', () => {
    // The send path is no-shell (tmux send-keys -l), but defense-in-depth: the
    // allowlisted strings themselves must never carry shell/REPL-escape chars.
    for (const c of AGENT_COMMANDS) {
      expect(c.command.startsWith('/'), `${c.key}: command must start with /`).toBe(true)
      expect(/[;&|`$(){}<>\\"'\n\r]/.test(c.command), `${c.key}: command has unsafe chars`).toBe(false)
      expect(typeof c.requiresIdle).toBe('boolean')
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
    }
  })

  // ── Model fallback (USER, 2026-08-06) ─────────────────────────────────────────
  //
  // WHY THIS IS A CAPABILITY AND NOT A CONVENIENCE. A model-scoped weekly window can be
  // exhausted while the ACCOUNT still has most of its 5h/7d left. Measured that day: the
  // live account was at 5h 42% / 7d 60% with Fable at ~98%, and the rotator's response was
  // to evict the entire fleet onto accounts at 99% (5h) and 87% (7d) — because
  // `isSafeAlternate` disqualifies an account maxed on ANY window, including one that binds
  // a single model. The owner had to fix it by hand, and the fix was one keystroke:
  // "fable window limit is not a true limit.. the solution is simply to fallback to Opus 5".
  //
  // Without an allowlist entry there is no path to that at all — the fleet can compact and
  // clear its context but cannot change which model answers.

  it('offers a model fallback, because a model-scoped limit must not cost the account', () => {
    const opus = getAgentCommand('model-opus')
    expect(opus).toBeDefined()
    expect(opus?.command).toBe('/model opus')
    // Idle-gated: a model switch mid-turn lands in whatever the agent is typing.
    expect(opus?.requiresIdle).toBe(true)
    // NOT destructive — it changes which model answers next; it wipes no context. Marking it
    // destructive would put a confirmation in front of the one action that relieves pressure.
    expect(opus?.destructive).toBeFalsy()
  })

  it('the model target is a FIXED string per key — never interpolated from a caller', () => {
    // A single `model` key taking an argument would put caller-controlled text into a pane
    // write. One curated key per target model cannot be steered, which is what the allowlist
    // is for. Assert the shape rather than just the presence.
    const models = AGENT_COMMANDS.filter((c) => c.key.startsWith('model-'))
    expect(models.length).toBeGreaterThanOrEqual(2)
    for (const m of models) {
      expect(m.command).toMatch(/^\/model [a-z0-9-]+$/)
      expect(m.command).not.toMatch(/\$\{|\$[A-Za-z_]/) // no interpolation of any kind
    }
  })

  it('marks context-wiping commands destructive', () => {
    expect(getAgentCommand('clear')?.destructive).toBe(true)
    // a routine command is not destructive
    expect(getAgentCommand('reload-plugins')?.destructive).toBeFalsy()
  })
})
