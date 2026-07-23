/**
 * TRDD-6AMXSG3S — a restart must resume the agent's conversation, not cold-start it.
 *
 * The defect these tests lock out was observed live in SCEN-031: a Rule-4 fix
 * restarted the MANAGER, it came back on a blank session with no memory of its
 * mandate, and the whole fleet went idle. Restarts are fired automatically after
 * every element change, so the same cold start silently discards in-flight work
 * on any plugin install.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'
import { buildRelaunchCommand } from '@/lib/session-restart'
import { conversationSlug, hasPriorConversation } from '@/lib/claude-conversation'

describe('buildRelaunchCommand — conversation continuity (TRDD-6AMXSG3S)', () => {
  it('appends --continue when asked', () => {
    const cmd = buildRelaunchCommand('claude', '--agent foo-main-agent', 'Alice', {
      continueConversation: true,
    })
    expect(cmd).toBe('claude --agent foo-main-agent --name "Alice" --continue')
  })

  it('omits --continue by default, so existing callers are unchanged', () => {
    const cmd = buildRelaunchCommand('claude', '--agent foo-main-agent', 'Alice')
    expect(cmd).toBe('claude --agent foo-main-agent --name "Alice"')
    expect(cmd).not.toContain('--continue')
  })

  it('does not duplicate an existing --continue', () => {
    const cmd = buildRelaunchCommand('claude', '--agent foo --continue', 'Alice', {
      continueConversation: true,
    })
    expect(cmd.match(/--continue/g)).toHaveLength(1)
  })

  it('does not add --continue when the short -c form is already present', () => {
    const cmd = buildRelaunchCommand('claude', '--agent foo -c', 'Alice', {
      continueConversation: true,
    })
    expect(cmd).not.toContain('--continue')
  })

  it('is not fooled by -c appearing inside another token', () => {
    // `--agent my-c-agent` contains "-c" but carries no continue flag.
    const cmd = buildRelaunchCommand('claude', '--agent my-c-agent', 'Alice', {
      continueConversation: true,
    })
    expect(cmd).toContain('--continue')
  })

  it('inserts --continue BEFORE a ` -- ` raw-prompt divider, never into the prompt', () => {
    const cmd = buildRelaunchCommand('claude', '--agent foo -- do the thing', 'Alice', {
      continueConversation: true,
    })
    // Everything after ` -- ` is prompt text; a flag placed there is swallowed.
    const [flags, prompt] = cmd.split(' -- ')
    expect(flags).toContain('--continue')
    expect(prompt).toBe('do the thing')
  })

  it('still injects --name before the divider (behaviour preserved)', () => {
    const cmd = buildRelaunchCommand('claude', '--agent foo -- do the thing', 'Alice')
    const [flags, prompt] = cmd.split(' -- ')
    expect(flags).toContain('--name "Alice"')
    expect(prompt).toBe('do the thing')
  })
})

describe('hasPriorConversation (TRDD-6AMXSG3S)', () => {
  let tmpHome: string
  const workdir = '/Users/someone/agents/testbot'

  beforeEach(async () => {
    tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'aim-conv-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpHome, { recursive: true, force: true })
  })

  it('derives the slug by replacing every slash with a dash', () => {
    expect(conversationSlug(workdir)).toBe('-Users-someone-agents-testbot')
  })

  it('normalises a path so equivalent spellings share one slug', () => {
    expect(conversationSlug('/Users/someone//agents/testbot')).toBe(conversationSlug(workdir))
  })

  it('is false when no project directory exists', async () => {
    expect(await hasPriorConversation(workdir, tmpHome)).toBe(false)
  })

  it('is false for an existing but empty project directory', async () => {
    await fsp.mkdir(path.join(tmpHome, '.claude', 'projects', conversationSlug(workdir)), {
      recursive: true,
    })
    expect(await hasPriorConversation(workdir, tmpHome)).toBe(false)
  })

  it('is false when the directory holds no .jsonl transcript', async () => {
    const dir = path.join(tmpHome, '.claude', 'projects', conversationSlug(workdir))
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'notes.md'), 'x')
    expect(await hasPriorConversation(workdir, tmpHome)).toBe(false)
  })

  it('is true once a .jsonl transcript exists', async () => {
    const dir = path.join(tmpHome, '.claude', 'projects', conversationSlug(workdir))
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'abc-123.jsonl'), '{}')
    expect(await hasPriorConversation(workdir, tmpHome)).toBe(true)
  })
})
