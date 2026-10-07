import { describe, it, expect } from 'vitest'
import { psChildCommands, isClientCommand } from '@/lib/agent-runtime'

const PS = `    1     0 /sbin/launchd
13892     1 -zsh
72728 13892 /Users/x/.local/share/claude/versions/2.1.285
72750 13892 /usr/bin/caffeinate
72900 72728 /bin/bash
72901 13892 /Users/x/My Tools/watcher
`

describe('psChildCommands (TJRFVZRC child detection)', () => {
  it('lists direct children of the pane shell as basenames, spaces kept', () => {
    expect(psChildCommands(PS, 13892)).toEqual(['2.1.285', 'caffeinate', 'watcher'])
  })
  it('does not count grandchildren', () => {
    expect(psChildCommands(PS, 72728)).toEqual(['bash'])
  })
  it('does not match a pid that is only a prefix of another', () => {
    expect(psChildCommands('  5 1389 foo\n', 138)).toEqual([])
  })
  it('tolerates empty output', () => {
    expect(psChildCommands('', 1)).toEqual([])
  })
})

describe('isClientCommand', () => {
  it('accepts the binary, a version-named client and node; rejects background jobs', () => {
    expect(isClientCommand('claude', 'claude')).toBe(true)
    expect(isClientCommand('2.1.285', 'claude')).toBe(true)
    expect(isClientCommand('node', 'codex')).toBe(true)
    expect(isClientCommand('node', 'claude')).toBe(false)
    expect(isClientCommand('3.12', 'codex')).toBe(false)
    expect(isClientCommand('3.12', '')).toBe(false)
    expect(isClientCommand('caffeinate', 'claude')).toBe(false)
    expect(isClientCommand('-zsh', 'claude')).toBe(false)
  })
})
