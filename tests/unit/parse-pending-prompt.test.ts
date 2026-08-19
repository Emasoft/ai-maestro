import { describe, it, expect } from 'vitest'
import { parsePendingPromptState } from '@/services/sessions-service'

// A realistic permission_request chat-state object as the plugin's hook
// (ai-maestro-plugin scripts/ai-maestro-hook.cjs, PermissionRequest branch) writes it.
const permissionState = {
  status: 'permission_request',
  toolName: 'Bash',
  toolInput: { command: 'rm -rf build' },
  description: 'Run: rm -rf build',
  options: [
    { key: '1', label: 'Yes', action: 'allow_once' },
    { key: '2', label: 'Yes, allow Bash from this location during this session', action: 'allow_session', rule: 'Bash(rm:*)' },
    { key: '3', label: 'Type here to tell Claude what to do differently', action: 'custom' },
  ],
  message: 'Claude wants to bash',
  updatedAt: '2026-07-09T10:00:00.000Z',
}

describe('parsePendingPromptState', () => {
  it('surfaces every rich field of a permission_request prompt', () => {
    const p = parsePendingPromptState(permissionState)
    expect(p).not.toBeNull()
    expect(p!.status).toBe('permission_request')
    expect(p!.toolName).toBe('Bash')
    expect(p!.description).toBe('Run: rm -rf build')
    expect(p!.toolInput).toEqual({ command: 'rm -rf build' })
    expect(p!.options).toHaveLength(3)
    expect(p!.options[1]).toEqual({
      key: '2',
      label: 'Yes, allow Bash from this location during this session',
      action: 'allow_session',
      rule: 'Bash(rm:*)',
    })
  })

  it('returns null for a plain idle_prompt (waiting_for_input, no options)', () => {
    const p = parsePendingPromptState({
      status: 'waiting_for_input',
      message: 'Waiting for your input...',
      notificationType: 'idle_prompt',
      updatedAt: '2026-07-09T10:00:00.000Z',
    })
    expect(p).toBeNull()
  })

  it('treats a captured options[] as pending even when status is not permission_request', () => {
    // Forward-compat: once the D7 hook capture lands, an AskUserQuestion writes
    // options[] (and a question) under a non-permission status — still pending.
    const p = parsePendingPromptState({
      status: 'waiting_for_input',
      question: 'Which database?',
      options: [
        { key: '1', label: 'Postgres' },
        { key: '2', label: 'SQLite' },
      ],
    })
    expect(p).not.toBeNull()
    expect(p!.question).toBe('Which database?')
    expect(p!.options.map((o) => o.label)).toEqual(['Postgres', 'SQLite'])
  })

  it('coerces non-string option keys/labels and drops malformed option entries', () => {
    const p = parsePendingPromptState({
      status: 'permission_request',
      options: [
        { key: 1, label: 'Yes' }, // numeric key → coerced to '1'
        { label: 'no key' }, // no key → dropped
        null, // junk → dropped
        { key: '2' }, // missing label → '' label kept
      ],
    })
    expect(p).not.toBeNull()
    expect(p!.options).toEqual([
      { key: '1', label: 'Yes', action: undefined, rule: undefined },
      { key: '2', label: '', action: undefined, rule: undefined },
    ])
  })

  it('returns null for null / non-object / empty input', () => {
    expect(parsePendingPromptState(null)).toBeNull()
    expect(parsePendingPromptState(undefined)).toBeNull()
    expect(parsePendingPromptState('not an object')).toBeNull()
    expect(parsePendingPromptState({})).toBeNull()
  })
})
