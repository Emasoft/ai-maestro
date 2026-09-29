/**
 * recordClaudeSessionId (issue #155) — the write half of the claude-session join.
 *
 * The ingest route resolves WHICH agent a statusline payload belongs to (by
 * agentName, else by workingDirectory match); this registry function records
 * the Claude Code session id onto that agent's session record so agentlens
 * usage records (sessionId + workspace, no agent id) can be joined per agent.
 *
 * What is under test is the write semantics, against the REAL module over a
 * fixture registry file: session 0 gets the id; an unknown agent is a false,
 * not a throw; a second call overwrites (last-seen wins); and lastActive does
 * NOT move — this is an observation, not activity.
 *
 * 0-IMPACT: `os.homedir()` is mocked BEFORE the import (agent-registry computes
 * REGISTRY_FILE from getStateDir() at module load), so every read/write below
 * lands in a temp fake HOME, never the developer's ~/.aimaestro.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Created in vi.hoisted (like agent-teardown.test.ts): the mock factory below runs at module
// LOAD — agent-registry computes REGISTRY_FILE from getStateDir() → homedir() during its import
// chain — so the fake home must exist before any import runs, not in beforeEach.
const HOME_ = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  return mkdtempSync(j(root, 'aim-join-'))
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const homedir = () => HOME_
  return { ...actual, homedir, default: { ...actual, homedir } }
})

// Import AFTER the os mock is registered (vi.mock is hoisted; the static import
// below evaluates with homedir() already redirected).
import { recordClaudeSessionId, loadAgents } from '@/lib/agent-registry'
import type { Agent } from '@/types/agent'

function fixtureAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'join-test-agent',
    hostId: 'local',
    program: 'Claude Code',
    taskDescription: 'fixture',
    deployment: { type: 'local', local: { hostname: 'fixture-host', platform: 'darwin' } },
    tools: {},
    status: 'offline',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastActive: '2026-09-01T00:00:00.000Z',
    sessions: [
      { index: 0, status: 'offline', workingDirectory: '/tmp/join-test-workdir', lastActive: '2026-09-01T00:00:00.000Z' },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  mkdirSync(join(HOME_, '.aimaestro', 'agents'), { recursive: true })
  writeFileSync(
    join(HOME_, '.aimaestro', 'agents', 'registry.json'),
    JSON.stringify([fixtureAgent()]),
  )
})

afterEach(() => {
  // Reset the fixture state (including any ledger the save path wrote) for the next test.
  rmSync(join(HOME_, '.aimaestro'), { recursive: true, force: true })
})

/** Read the persisted registry straight from disk — the module cache would hide a no-op write. */
function persisted(): Agent[] {
  return JSON.parse(readFileSync(join(HOME_, '.aimaestro', 'agents', 'registry.json'), 'utf-8'))
}

describe('recordClaudeSessionId', () => {
  it('sets claudeSessionId on session 0 and persists it', async () => {
    const ok = await recordClaudeSessionId('11111111-1111-4111-8111-111111111111', 'sess-abc123')
    expect(ok).toBe(true)
    const onDisk = persisted()
    expect(onDisk[0].sessions?.[0].claudeSessionId).toBe('sess-abc123')
  })

  it('resolves by NAME as well as id', async () => {
    const ok = await recordClaudeSessionId('join-test-agent', 'sess-by-name')
    expect(ok).toBe(true)
    expect(persisted()[0].sessions?.[0].claudeSessionId).toBe('sess-by-name')
  })

  it('returns false for an unknown agent — no throw, no write', async () => {
    const ok = await recordClaudeSessionId('no-such-agent', 'sess-x')
    expect(ok).toBe(false)
    expect(persisted()[0].sessions?.[0].claudeSessionId).toBeUndefined()
  })

  it('second call overwrites — last-seen wins', async () => {
    await recordClaudeSessionId('join-test-agent', 'sess-first')
    await recordClaudeSessionId('join-test-agent', 'sess-second')
    expect(persisted()[0].sessions?.[0].claudeSessionId).toBe('sess-second')
  })

  it('does NOT bump lastActive — an observation is not activity', async () => {
    const before = loadAgents()[0].sessions?.[0].lastActive
    await recordClaudeSessionId('join-test-agent', 'sess-quiet')
    const after = persisted()[0].sessions?.[0].lastActive
    expect(after).toBe(before)
    expect(after).toBe('2026-09-01T00:00:00.000Z')
  })
})
