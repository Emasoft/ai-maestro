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

  it('marks context-wiping commands destructive', () => {
    expect(getAgentCommand('clear')?.destructive).toBe(true)
    // a routine command is not destructive
    expect(getAgentCommand('reload-plugins')?.destructive).toBeFalsy()
  })
})
