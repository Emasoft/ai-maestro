/**
 * deleteSession authorization (TRDD-TCDIVXPS) — the service decides, so both server modes get it.
 * Real `authorize`; only runtime / registry / persistence / team data are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

import fs from 'fs'
import os from 'os'
import path from 'path'

// The real getAgentBySession (indexed-name tests) reads ~/.aimaestro/agents/registry.json,
// resolved from os.homedir() when lib/agent-registry loads — so HOME must be redirected
// BEFORE that module loads. The developer's real registry is never touched.
const { fakeHome } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-session-authz-'))
  process.env.HOME = fakeHome
  return { fakeHome }
})

const { mockRuntime, mockAgentRegistry, mockSessionPersistence, mockTeams } = vi.hoisted(() => ({
  mockRuntime: {
    sessionExists: vi.fn(),
    killSession: vi.fn(),
  },
  mockAgentRegistry: {
    getAgentBySession: vi.fn(),
    getAgentByName: vi.fn(),
    createAgent: vi.fn(),
    deleteAgentBySession: vi.fn(),
    renameAgentSession: vi.fn(),
    loadAgents: vi.fn().mockReturnValue([]),
    linkSession: vi.fn(),
    unlinkSession: vi.fn(),
    getAgent: vi.fn(),
  },
  mockSessionPersistence: {
    persistSession: vi.fn(),
    loadPersistedSessions: vi.fn().mockReturnValue([]),
    unpersistSession: vi.fn(),
  },
  mockTeams: { loadTeams: vi.fn() },
}))

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: vi.fn().mockReturnValue(mockRuntime),
  prepareShellForLaunch: vi.fn(),
  preflightPaneKeychain: vi.fn(),
  SHELL_READY_TIMEOUT_MS: 15000,
}))
// Real module underneath, the listed mocks on top: tests that need the REAL getAgentBySession
// point the mock at it (realGetAgentBySession below); every other test stays fully mocked.
vi.mock('@/lib/agent-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent-registry')>()),
  ...mockAgentRegistry,
}))
vi.mock('@/lib/session-persistence', () => mockSessionPersistence)
vi.mock('@/lib/team-registry', () => mockTeams)
vi.mock('@/lib/governance', () => ({
  isManager: vi.fn().mockReturnValue(false),
  isChiefOfStaffAnywhere: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/agent-keychain-probe', () => ({
  ensureKeychainProbeInstalled: vi.fn(),
  KEYCHAIN_PROBE_INSTALL_PATH: '/tmp/keychain-probe-test.sh',
}))
vi.mock('@/services/shared-state', () => ({
  sessionActivity: new Map(),
  injectedPrompts: new Map(),
  broadcastStatusUpdate: vi.fn(),
}))
vi.mock('@/services/agent-launch-args', () => ({ resolveLaunchArgs: vi.fn() }))

import { deleteSession } from '@/services/sessions-service'
import type { AuthContext } from '@/lib/agent-auth'

const VICTIM = { id: 'victim-id', name: 'victim', deployment: { type: 'local' } }
const member: AuthContext = { agentId: 'member-id', isSystemOwner: false, governanceTitle: 'member', teamId: 'team-a' }
const manager: AuthContext = { agentId: 'manager-id', isSystemOwner: false, governanceTitle: 'manager' }
const cos = (teamId: string): AuthContext => ({ agentId: 'cos-id', isSystemOwner: false, governanceTitle: 'chief-of-staff', teamId })
const owner: AuthContext = { isSystemOwner: true }

afterAll(() => fs.rmSync(fakeHome, { recursive: true, force: true })) // the redirected HOME is this file's own tmp dir

function expectNoSideEffects() {
  expect(mockRuntime.killSession).not.toHaveBeenCalled()
  expect(mockSessionPersistence.unpersistSession).not.toHaveBeenCalled()
  expect(mockAgentRegistry.deleteAgentBySession).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRuntime.sessionExists.mockResolvedValue(true)
  mockRuntime.killSession.mockResolvedValue(undefined)
  mockAgentRegistry.getAgentBySession.mockReturnValue(VICTIM)
  mockAgentRegistry.getAgent.mockReturnValue(VICTIM)
  mockTeams.loadTeams.mockReturnValue([
    { id: 'team-a', agentIds: ['member-id', 'cos-id'], chiefOfStaffId: 'cos-id' },
    { id: 'team-b', agentIds: ['victim-id'], chiefOfStaffId: 'other-cos' },
  ])
})

describe('deleteSession authorization', () => {
  it('refuses a MEMBER naming another agent\'s session with 403 and no side effects', async () => {
    const r = await deleteSession('victim', member)
    expect(r.status).toBe(403)
    expect(r.error).toMatch(/delete-session/)
    expectNoSideEffects()
  })

  it('refuses a CHIEF-OF-STAFF naming an agent of another team with 403 and no side effects', async () => {
    const r = await deleteSession('victim', cos('team-a'))
    expect(r.status).toBe(403)
    expect(r.error).toMatch(/delete-session/)
    expectNoSideEffects()
  })

  it('refuses a missing authContext with 401 and no side effects', async () => {
    const r = await deleteSession('victim', undefined)
    expect(r.status).toBe(401)
    expect(r.error).toBe('Auth context required for deleteSession')
    expectNoSideEffects()
  })

  it('refuses a non-owner naming a session that resolves to no agent with 403 and no side effects', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(null)
    const r = await deleteSession('ghost', manager)
    expect(r.status).toBe(403)
    expect(r.error).toBe('Not authorized to delete a session that does not resolve to an agent')
    expectNoSideEffects()
  })

  it('lets the MANAGER kill the session (positive control)', async () => {
    const r = await deleteSession('victim', manager)
    expect(r.status).toBe(200)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('victim')
    expect(mockSessionPersistence.unpersistSession).toHaveBeenCalledWith('victim')
    expect(mockAgentRegistry.deleteAgentBySession).not.toHaveBeenCalled()
  })

  it('lets the system owner kill the session (positive control)', async () => {
    const r = await deleteSession('victim', owner)
    expect(r.status).toBe(200)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('victim')
    expect(mockAgentRegistry.deleteAgentBySession).not.toHaveBeenCalled()
  })

  it('lets a CHIEF-OF-STAFF kill a session of an agent in its own team (positive control)', async () => {
    mockTeams.loadTeams.mockReturnValue([
      { id: 'team-a', agentIds: ['victim-id', 'cos-id'], chiefOfStaffId: 'cos-id' },
    ])
    const r = await deleteSession('victim', cos('team-a'))
    expect(r.status).toBe(200)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('victim')
    expect(mockAgentRegistry.deleteAgentBySession).not.toHaveBeenCalled()
  })
})

describe('deleteSession authorization — cloud agents', () => {
  const CLOUD = { id: 'cloud-1', name: 'cloud-agent', deployment: { type: 'cloud' } }

  it('refuses a non-owner MEMBER naming a cloud agent\'s session with 403 and never calls deleteAgentBySession', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(CLOUD)
    mockAgentRegistry.getAgent.mockReturnValue(CLOUD)
    const r = await deleteSession('cloud-agent', member)
    expect(r.status).toBe(403)
    expect(r.error).toMatch(/delete-session/)
    expect(mockAgentRegistry.deleteAgentBySession).not.toHaveBeenCalled()
    expect(mockRuntime.killSession).not.toHaveBeenCalled()
  })

  it('a cloud agent has no session: the MANAGER gets 409 pointing at DeleteAgent, nothing is removed', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(CLOUD)
    mockAgentRegistry.getAgent.mockReturnValue(CLOUD)
    const r = await deleteSession('cloud-agent', manager)
    expect(r.status).toBe(409)
    expectNoSideEffects()
  })
})

describe('deleteSession authorization — indexed multi-session names (REAL getAgentBySession)', () => {
  // Naming (types/agent.ts): index 0 -> "alpha", index 1 -> "alpha_1", index 2 -> "alpha_2".
  // parseSessionName strips a trailing _<digits>, so "alpha_1" resolves to agent "alpha".
  const selfHostId = os.hostname().toLowerCase().replace(/\.local$/, '')

  beforeEach(async () => {
    const dir = path.join(fakeHome, '.aimaestro', 'agents')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify([
      { id: 'alpha-id', name: 'alpha', hostId: selfHostId, deployment: { type: 'local' }, sessions: [{ index: 0 }, { index: 1 }] },
      { id: 'beta-id', name: 'beta', hostId: selfHostId, deployment: { type: 'local' }, sessions: [{ index: 0 }] },
    ]))
    const actual = await vi.importActual<typeof import('@/lib/agent-registry')>('@/lib/agent-registry')
    mockAgentRegistry.getAgentBySession.mockImplementation(actual.getAgentBySession)
    mockAgentRegistry.getAgent.mockImplementation(actual.getAgent)
    mockTeams.loadTeams.mockReturnValue([
      { id: 'team-a', agentIds: ['alpha-id', 'cos-a'], chiefOfStaffId: 'cos-a' },
      { id: 'team-b', agentIds: ['beta-id', 'cos-b'], chiefOfStaffId: 'cos-b' },
    ])
  })

  it('the real lookup resolves the second session "alpha_1" to agent alpha (not beta, not none)', () => {
    const real = mockAgentRegistry.getAgentBySession('alpha_1')
    expect(real?.id).toBe('alpha-id')
  })

  it('refuses an unauthorized MEMBER naming the indexed session "alpha_1" with 403 and no side effects', async () => {
    const r = await deleteSession('alpha_1', member)
    expect(r.status).toBe(403)
    expectNoSideEffects()
  })

  it('lets the CHIEF-OF-STAFF of alpha\'s own team (team-a) kill "alpha_1" (positive control)', async () => {
    const r = await deleteSession('alpha_1', { agentId: 'cos-a', isSystemOwner: false, governanceTitle: 'chief-of-staff', teamId: 'team-a' })
    expect(r.status).toBe(200)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('alpha_1')
  })

  it('refuses the CHIEF-OF-STAFF of another team (team-b) naming "alpha_1" with 403 and no side effects', async () => {
    const r = await deleteSession('alpha_1', { agentId: 'cos-b', isSystemOwner: false, governanceTitle: 'chief-of-staff', teamId: 'team-b' })
    expect(r.status).toBe(403)
    expectNoSideEffects()
  })
})

describe('deleteSession authorization — behaviour change for unresolvable sessions', () => {
  // BEHAVIOUR CHANGE (TRDD-TCDIVXPS): before this fix, a session that resolved to NO registry agent
  // (an orphan tmux session, a typo) could be killed by any caller of the endpoint. Now only the
  // system owner can remove it: authorization needs an agent to decide against, and an
  // unidentifiable target must never read as "fine".
  it('a session that resolves to NO registry agent can now be removed ONLY by the system owner', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(null)
    for (const ctx of [member, manager, cos('team-a')]) {
      const refused = await deleteSession('orphan', ctx)
      expect(refused.status).toBe(403)
    }
    expectNoSideEffects()

    const ok = await deleteSession('orphan', owner)
    expect(ok.status).toBe(200)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('orphan')
  })
})
