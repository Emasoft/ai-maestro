/**
 * TRDD-BZW1QAZ5 (W2) — the authorization action of sendAgentSessionCommand is never the caller's choice.
 *
 * The headless PATCH /api/agents/:id/session handler passes the raw JSON body as params, so a body
 * carrying `authAction: 'view-agent'` used to reach authorize() as an action MANAGER / own-team COS
 * are granted, skipping R42 (send-command) and the unblock-prompt precondition. The REAL authorize()
 * is used here (never mocked); only the registry / runtime / session layers are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgent } from '../test-utils/fixtures'

const { mockRuntime, mockAgentRegistry, mockSessionsService } = vi.hoisted(() => ({
  mockRuntime: {
    listSessions: vi.fn().mockResolvedValue([]),
    sessionExists: vi.fn().mockResolvedValue(true),
    sendKeys: vi.fn().mockResolvedValue(undefined),
    cancelCopyMode: vi.fn().mockResolvedValue(undefined),
    capturePane: vi.fn().mockResolvedValue(['✻ Worked for 5m 35s', '❯ ', '  🤖 Opus 5 · 📁 my-agent'].join('\n')),
  },
  mockAgentRegistry: {
    loadAgents: vi.fn().mockReturnValue([]),
    saveAgents: vi.fn(),
    getAgent: vi.fn(),
    getAgentByName: vi.fn(),
    getAgentBySession: vi.fn(),
    registryLedger: { append: vi.fn().mockResolvedValue(undefined) },
  },
  mockSessionsService: { readPendingPrompt: vi.fn().mockReturnValue(null) },
}))

vi.mock('@/lib/agent-runtime', () => ({ getRuntime: vi.fn().mockReturnValue(mockRuntime) }))
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/hosts-config', () => ({
  getHosts: vi.fn().mockReturnValue([]),
  getSelfHost: vi.fn().mockReturnValue({ id: 'h', name: 'h', url: 'http://localhost:23000' }),
  getSelfHostId: vi.fn().mockReturnValue('h'),
  isSelf: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/session-persistence', () => ({ persistSession: vi.fn(), unpersistSession: vi.fn() }))
vi.mock('@/lib/amp-inbox-writer', () => ({
  initAgentAMPHome: vi.fn().mockResolvedValue(undefined),
  getAgentAMPDir: vi.fn().mockReturnValue('/tmp/amp/test'),
}))
vi.mock('@/services/shared-state', () => ({
  sessionActivity: new Map<string, number>(),
  injectedPrompts: new Map<string, number>(),
  broadcastAgentUpdate: vi.fn(),
}))
vi.mock('@/lib/agent-startup', () => ({
  initializeAllAgents: vi.fn().mockResolvedValue({ initialized: [], failed: [] }),
  getStartupStatus: vi.fn().mockReturnValue({ discoveredAgents: 0, activeAgents: 0, agents: [] }),
}))
vi.mock('@/lib/messageQueue', () => ({ resolveAgentIdentifier: vi.fn() }))
vi.mock('@/lib/governance', () => ({
  getManagerId: vi.fn().mockReturnValue('the-manager'),
  isManager: vi.fn().mockReturnValue(false),
  isChiefOfStaffAnywhere: vi.fn().mockReturnValue(false),
}))
vi.mock('@/lib/team-registry', () => ({
  isAgentInAnyTeam: vi.fn().mockReturnValue(false),
  loadTeams: vi.fn().mockReturnValue([]),
}))
vi.mock('@/lib/user-scope-plugin-whitelist', () => ({
  enforceUserScopePluginWhitelist: vi.fn(async () => ({ ok: true, disabled: [], alreadyDisabled: [], wrote: false })),
}))
vi.mock('@/services/sessions-service', () => mockSessionsService)
vi.mock('@/services/element-management-service', () => ({}))

import { sendAgentSessionCommand } from '@/services/agents-core-service'
import type { AuthContext } from '@/lib/agent-auth'

const MANAGER = { isSystemOwner: false, agentId: 'the-manager', governanceTitle: 'manager' } as AuthContext
const MEMBER_SELF = { isSystemOwner: false, agentId: 'agent-1', governanceTitle: 'member' } as AuthContext

beforeEach(() => {
  vi.clearAllMocks()
  mockRuntime.sessionExists.mockResolvedValue(true)
  mockRuntime.sendKeys.mockResolvedValue(undefined)
  mockSessionsService.readPendingPrompt.mockReturnValue(null)
  mockAgentRegistry.getAgent.mockReturnValue(
    makeAgent({ id: 'agent-1', name: 'my-agent', workingDirectory: '/tmp/agent-1' }),
  )
})

describe('sendAgentSessionCommand — authAction is validated, never caller-chosen', () => {
  for (const weaker of ['view-agent', 'wake-agent', 'modify-agent', 'manage-skills']) {
    it(`REFUSES a MANAGER on another agent passing authAction '${weaker}' and types nothing`, async () => {
      const result = await sendAgentSessionCommand(
        'agent-1',
        { command: 'x', authAction: weaker } as never,
        MANAGER,
      )
      expect(result.status).toBe(400)
      expect(result.error).toBe(`Invalid authAction "${weaker}" — must be 'send-command' or 'unblock-prompt'`)
      expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
    })
  }

  it('REFUSES a garbage-string authAction and types nothing', async () => {
    const result = await sendAgentSessionCommand('agent-1', { command: 'x', authAction: 'zzz' } as never, MANAGER)
    expect(result.status).toBe(400)
    expect(result.error).toBe(`Invalid authAction "zzz" — must be 'send-command' or 'unblock-prompt'`)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('REFUSES a non-string authAction and types nothing', async () => {
    const result = await sendAgentSessionCommand('agent-1', { command: 'x', authAction: 42 } as never, MANAGER)
    expect(result.status).toBe(400)
    expect(result.error).toBe(`Invalid authAction 42 — must be 'send-command' or 'unblock-prompt'`)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('REFUSES a null authAction (null is not "absent") and types nothing', async () => {
    const result = await sendAgentSessionCommand('agent-1', { command: 'x', authAction: null } as never, MANAGER)
    expect(result.status).toBe(400)
    expect(result.error).toBe(`Invalid authAction null — must be 'send-command' or 'unblock-prompt'`)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('PIN (behaviour unchanged): MANAGER on another agent with the default action is refused by R42', async () => {
    const result = await sendAgentSessionCommand('agent-1', { command: 'x' }, MANAGER)
    expect(result.status).toBe(403)
    expect(result.error).toMatch(/^R42: no agent may send-command on another agent/)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL: an agent sending a command to ITSELF is allowed and typed', async () => {
    const result = await sendAgentSessionCommand('agent-1', { command: 'x', requireIdle: false }, MEMBER_SELF)
    expect(result.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledTimes(1)
  })

  it("POSITIVE CONTROL: 'unblock-prompt' by a MANAGER with a pending prompt is allowed and typed", async () => {
    mockSessionsService.readPendingPrompt.mockReturnValue({ question: 'proceed?' })
    const result = await sendAgentSessionCommand(
      'agent-1',
      { command: '1', requireIdle: false, authAction: 'unblock-prompt' },
      MANAGER,
    )
    expect(result.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledTimes(1)
  })

  it("PIN: 'unblock-prompt' by a MANAGER with no pending prompt is refused (409) and types nothing", async () => {
    const result = await sendAgentSessionCommand(
      'agent-1',
      { command: '1', requireIdle: false, authAction: 'unblock-prompt' },
      MANAGER,
    )
    expect(result.status).toBe(409)
    expect(result.error).toMatch(/^R42\.8: no prompt is pending for this agent/)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })
})
