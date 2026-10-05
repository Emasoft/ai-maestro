/**
 * deleteSession target resolution (TRDD-TCDIVXPS box 7, TRDD-DEL16Q96 box 4) — the service and the
 * REAL getAgentBySession must agree on which agent a session name denotes: an agent literally named
 * "alpha_1" is not mistaken for agent "alpha" (index 1), while "alpha_1" with no such agent still
 * reaches "alpha". The target is observed through authorization (a chief-of-staff is allowed only for
 * the team of the agent that really resolved) and, for cloud agents, through the id handed to
 * deleteAgentBySession. Only runtime / persistence / team data and the registry's WRITER are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// The registry path is fixed at module load from os.homedir(): redirect HOME before it loads.
const { fakeHome } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-session-target-'))
  process.env.HOME = fakeHome
  return { fakeHome }
})

const { mockRuntime, mockDeleteAgentBySession, mockSessionPersistence, mockTeams } = vi.hoisted(() => ({
  mockRuntime: { sessionExists: vi.fn(), killSession: vi.fn() },
  mockDeleteAgentBySession: vi.fn(),
  mockSessionPersistence: { persistSession: vi.fn(), loadPersistedSessions: vi.fn().mockReturnValue([]), unpersistSession: vi.fn() },
  mockTeams: { loadTeams: vi.fn() },
}))

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: vi.fn().mockReturnValue(mockRuntime),
  prepareShellForLaunch: vi.fn(),
  preflightPaneKeychain: vi.fn(),
  SHELL_READY_TIMEOUT_MS: 15000,
}))
// Real registry (real getAgentBySession / getAgent); only the destructive writer is replaced.
vi.mock('@/lib/agent-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent-registry')>()),
  deleteAgentBySession: (...a: unknown[]) => mockDeleteAgentBySession(...a),
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

const registryFile = path.join(fakeHome, '.aimaestro', 'agents', 'registry.json')
const owner: AuthContext = { isSystemOwner: true }
const member: AuthContext = { agentId: 'member-id', isSystemOwner: false, governanceTitle: 'member', teamId: 'team-a' }
const cosOf = (teamId: string): AuthContext => ({ agentId: `cos-${teamId}`, isSystemOwner: false, governanceTitle: 'chief-of-staff', teamId })

let selfHost: string
let registryBytes: string

function seed(type: 'local' | 'cloud', withAlpha1: boolean) {
  const dep = { type }
  const rows: unknown[] = [
    { id: 'id-alpha', name: 'alpha', hostId: selfHost, deployment: dep, sessions: [{ index: 0 }, { index: 1 }] },
  ]
  if (withAlpha1) rows.push({ id: 'id-alpha1', name: 'alpha_1', hostId: selfHost, deployment: dep, sessions: [{ index: 0 }] })
  fs.mkdirSync(path.dirname(registryFile), { recursive: true })
  registryBytes = JSON.stringify(rows)
  fs.writeFileSync(registryFile, registryBytes)
  mockTeams.loadTeams.mockReturnValue([
    { id: 'team-a', agentIds: ['id-alpha', 'cos-team-a'], chiefOfStaffId: 'cos-team-a' },
    { id: 'team-b', agentIds: withAlpha1 ? ['id-alpha1', 'cos-team-b'] : ['cos-team-b'], chiefOfStaffId: 'cos-team-b' },
  ])
}

function expectNoSideEffects() {
  expect(mockRuntime.killSession).not.toHaveBeenCalled()
  expect(mockSessionPersistence.unpersistSession).not.toHaveBeenCalled()
  expect(mockDeleteAgentBySession).not.toHaveBeenCalled()
  expect(fs.readFileSync(registryFile, 'utf8')).toBe(registryBytes) // no registry write
}

afterAll(() => fs.rmSync(fakeHome, { recursive: true, force: true }))

beforeEach(async () => {
  vi.clearAllMocks()
  selfHost = (await import('@/lib/hosts-config')).getSelfHostId()
  mockRuntime.sessionExists.mockResolvedValue(true)
  mockRuntime.killSession.mockResolvedValue(undefined)
})

describe('deleteSession target resolution — local agents', () => {
  it('both "alpha" and "alpha_1" exist: "alpha_1" is alpha_1 (its own team may act, alpha\'s may not)', async () => {
    /** The exact-name agent wins over the parsed base name: authorization is decided against alpha_1 */
    seed('local', true)
    const wrongTeam = await deleteSession('alpha_1', cosOf('team-a'))
    expect(wrongTeam.status).toBe(403)
    expectNoSideEffects()

    const ownTeam = await deleteSession('alpha_1', cosOf('team-b'))
    expect(ownTeam.status).toBe(200)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('alpha_1')
    expect(mockDeleteAgentBySession).toHaveBeenCalledWith('alpha_1', false)
  })

  it('both exist: the base session "alpha" still resolves to alpha', async () => {
    /** Control: the exact-name preference does not capture the base agent's own session */
    seed('local', true)
    expect((await deleteSession('alpha', cosOf('team-b'))).status).toBe(403)
    expect((await deleteSession('alpha', cosOf('team-a'))).status).toBe(200)
  })

  it('only "alpha" exists with an indexed second session: "alpha_1" resolves to alpha', async () => {
    /** Parsed-name fallback: alpha's own team may kill alpha_1, another team may not */
    seed('local', false)
    expect((await deleteSession('alpha_1', cosOf('team-b'))).status).toBe(403)
    expectNoSideEffects()
    const ok = await deleteSession('alpha_1', cosOf('team-a'))
    expect(ok.status).toBe(200)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('alpha_1')
  })
})

describe('deleteSession target resolution — cloud agents', () => {
  it('both exist: "alpha_1" takes the cloud path for agent alpha_1 (id-alpha1), never id-alpha', async () => {
    /** deleteAgentBySession receives the resolved AGENT id on the cloud branch: directly observable */
    seed('cloud', true)
    const r = await deleteSession('alpha_1', owner)
    expect(r.status).toBe(200)
    expect(r.data?.type).toBe('cloud')
    expect(mockDeleteAgentBySession).toHaveBeenCalledTimes(1)
    expect(mockDeleteAgentBySession).toHaveBeenCalledWith('id-alpha1', false)
    expect(mockRuntime.killSession).not.toHaveBeenCalled()
  })

  it('only "alpha" exists: "alpha_1" takes the cloud path for agent alpha (id-alpha)', async () => {
    /** Parsed-name fallback on the cloud branch */
    seed('cloud', false)
    const r = await deleteSession('alpha_1', owner)
    expect(r.status).toBe(200)
    expect(r.data?.type).toBe('cloud')
    expect(mockDeleteAgentBySession).toHaveBeenCalledWith('id-alpha', false)
  })

  it('both exist: a chief-of-staff of alpha\'s team is refused on the cloud agent alpha_1', async () => {
    /** Authorization on the cloud branch is also decided against alpha_1, not alpha */
    seed('cloud', true)
    const r = await deleteSession('alpha_1', cosOf('team-a'))
    expect(r.status).toBe(403)
    expectNoSideEffects()
  })
})

describe('deleteSession target resolution — unauthorized caller on the indexed name', () => {
  it.each([['local' as const], ['cloud' as const]])('a MEMBER naming "alpha_1" (%s, both exist) is refused: no kill, no unpersist, no registry write', async (type) => {
    /** Refusal happens before every side effect, including the registry file */
    seed(type, true)
    const r = await deleteSession('alpha_1', member)
    expect(r.status).toBe(403)
    expectNoSideEffects()
  })
})
