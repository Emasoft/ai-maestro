/**
 * M2 (security audit R26-R40) — messages-service.sendMessage must NOT hard-code
 * skipGraphCheck:true, so the production POST /api/messages path enforces the
 * R38.2 normal-user routing restriction exactly like the AMP /v1/route path.
 *
 * Before the fix, services/messages-service.ts sendMessage passed
 * `skipGraphCheck: true` unconditionally. That made SendMessage's G06 short-
 * circuit BEFORE the R38.2 user-sender branch, so any "user"-origin POST bypassed
 * all routing — while AMP (which never skips) enforced it. The asymmetry is the
 * authz bypass. The fix skips ONLY for the system owner / active MAESTRO (R6.6 —
 * exempt) and for non-user (agent/system) senders; a normal user (model ON,
 * isSystemOwner=false, from==='user') is now routed through the graph.
 *
 * These tests drive the REAL messages-service.sendMessage AND the REAL
 * SendMessage pipeline + comm-graph (only the registries + store are mocked), so
 * they prove the full integration — the call-site decision AND the downstream
 * enforcement together.
 *
 * Zero-regression invariant: with the user-authority model OFF (default), G06's
 * user-sender branch is itself a no-op, so even when the check is no longer
 * skipped the send still succeeds — byte-identical to the legacy behavior. The
 * FLAG-OFF tests below pin that.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AuthContext } from '@/lib/agent-auth'

// ── Mocks: registries + store. The comm-graph is REAL (logic under test). ─────
type AgentRow = { id: string; name: string; governanceTitle?: string }
type TeamRow = { id: string; chiefOfStaffId?: string; agentIds?: string[] }
type UserRow = { id: string; title: string; assistantAgentId: string | null }

const { mockUserRegistry, mockGovernance, mockTeamRegistry, mockAgentRegistry, mockMessageFilter, mockMessageSend, mockMessageQueue } = vi.hoisted(() => ({
  mockUserRegistry: {
    getUser: vi.fn<(id: string) => UserRow | null>(),
    getUserByName: vi.fn<(name: string) => UserRow | null>(() => null),
    getActiveMaestroUserId: vi.fn<() => string | null>(() => null),
  },
  mockGovernance: {
    isManager: vi.fn<(id: string) => boolean>(() => false),
    isUserAuthorityModelEnabled: vi.fn<() => boolean>(() => false),
  },
  mockTeamRegistry: {
    loadTeams: vi.fn<() => TeamRow[]>(() => []),
  },
  mockAgentRegistry: {
    getAgent: vi.fn<(id: string) => AgentRow | null>(() => null),
    loadAgents: vi.fn<() => AgentRow[]>(() => []),
    // messages-service imports searchAgents at module load (directory discovery).
    searchAgents: vi.fn(() => []),
  },
  mockMessageFilter: {
    checkMessageAllowed: vi.fn<() => { allowed: boolean; reason?: string }>(() => ({ allowed: true })),
  },
  mockMessageSend: {
    sendFromUI: vi.fn(async () => ({ message: { id: 'msg-1' }, notified: false })),
    forwardFromUI: vi.fn(),
  },
  mockMessageQueue: {
    // messages-service imports these at module load; sendMessage itself does not
    // call them (it delegates to SendMessage), but the import must resolve.
    listInboxMessages: vi.fn(async () => []),
    listSentMessages: vi.fn(async () => []),
    getSentCount: vi.fn(async () => 0),
    getMessage: vi.fn(async () => null),
    markMessageAsRead: vi.fn(async () => true),
    archiveMessage: vi.fn(async () => true),
    deleteMessage: vi.fn(async () => true),
    getUnreadCount: vi.fn(async () => 0),
    getMessageStats: vi.fn(async () => ({})),
    listAgentsWithMessages: vi.fn(async () => []),
    resolveAgentIdentifier: vi.fn((id: string) => (id ? { agentId: id, alias: id } : null)),
  },
}))

vi.mock('@/lib/user-registry', () => mockUserRegistry)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/message-filter', () => mockMessageFilter)
vi.mock('@/lib/message-send', () => mockMessageSend)
vi.mock('@/lib/messageQueue', () => mockMessageQueue)
vi.mock('@/lib/hosts-config', () => ({
  getSelfHostId: vi.fn(() => 'local'),
  getSelfHost: vi.fn(() => ({ id: 'local', name: 'local', url: 'http://localhost:23000' })),
  getHosts: vi.fn(() => []),
  isSelf: vi.fn(() => true),
}))
vi.mock('@/lib/meeting-registry', () => ({
  loadMeetings: vi.fn(() => []),
  createMeeting: vi.fn(),
  getMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  deleteMeeting: vi.fn(),
}))

import { sendMessage } from '@/services/messages-service'

// Recipients the `to` identifier can resolve to.
const ARCH_AGENT = { id: 'arch-1', name: 'an-architect', governanceTitle: 'architect' }
const ASSISTANT_AGENT = { id: 'assistant-1', name: 'my-assistant', governanceTitle: 'assistant' }
const MANAGER_AGENT = { id: 'manager-1', name: 'the-manager', governanceTitle: 'manager' }

const NORMAL_USER = { id: 'user-1', title: 'user', assistantAgentId: 'assistant-1' }
const MAESTRO_USER = { id: 'maestro-1', title: 'maestro', assistantAgentId: null }

/** A user session: no agentId. isSystemOwner = active-maestro under the model. */
function userCtx(userId: string, userTitle: AuthContext['userTitle']): AuthContext {
  return {
    isSystemOwner: userTitle === 'maestro' || userTitle === 'maestro-delegate',
    agentId: undefined,
    userId,
    userTitle,
  }
}

/** An authenticated agent caller (Next.js route overrides body.from to its id). */
function agentCtx(agentId: string): AuthContext {
  return { isSystemOwner: false, agentId }
}

const sendParams = (from: string, to: string, ctx: AuthContext) => ({
  from,
  to,
  subject: 'hi',
  content: { type: 'notification' as const, message: 'hello' },
  authContext: ctx,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(false)
  mockGovernance.isManager.mockReturnValue(false)
  mockUserRegistry.getUserByName.mockReturnValue(null)
  mockUserRegistry.getActiveMaestroUserId.mockReturnValue(null)
  mockTeamRegistry.loadTeams.mockReturnValue([])
  mockMessageFilter.checkMessageAllowed.mockReturnValue({ allowed: true })
  mockMessageSend.sendFromUI.mockResolvedValue({ message: { id: 'msg-1' }, notified: false })
  mockAgentRegistry.loadAgents.mockReturnValue([])
  mockAgentRegistry.getAgent.mockReturnValue(null)
})

describe('messages-service.sendMessage — R38.2 enforcement (model ON)', () => {
  beforeEach(() => {
    mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(true)
    mockUserRegistry.getUser.mockImplementation((id: string) => (id === 'user-1' ? NORMAL_USER : null))
    // user-1 is NOT the active maestro → it is a normal user.
    mockUserRegistry.getActiveMaestroUserId.mockReturnValue('maestro-1')
  })

  it('normal user → a forbidden recipient (ARCHITECT) is BLOCKED via this path', async () => {
    // The crux of M2: pre-fix this path passed skipGraphCheck:true and the send
    // would SUCCEED (the graph was never consulted). After the fix the R38.2
    // user-sender branch fires and blocks it with a 400.
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT])
    const res = await sendMessage(sendParams('user', 'an-architect', userCtx('user-1', 'user')))
    expect(res.status).toBe(400)
    expect(res.error).toMatch(/R38\.2/)
    expect(mockMessageSend.sendFromUI).not.toHaveBeenCalled()
  })

  it('normal user → own ASSISTANT succeeds (R38.2 allows)', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([ASSISTANT_AGENT])
    const res = await sendMessage(sendParams('user', 'my-assistant', userCtx('user-1', 'user')))
    expect(res.status).toBe(201)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })

  it('normal user → MANAGER succeeds (R38.2 allows)', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([MANAGER_AGENT])
    mockGovernance.isManager.mockImplementation((id: string) => id === 'manager-1')
    const res = await sendMessage(sendParams('user', 'the-manager', userCtx('user-1', 'user')))
    expect(res.status).toBe(201)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })

  it('active MAESTRO → an ARCHITECT (forbidden for a normal user) succeeds — owner exempt', async () => {
    // isSystemOwner=true ⇒ skipGraphCheck stays true (R6.6 owner exempt); even if
    // it did run, the graph full-allows the active maestro.
    mockUserRegistry.getUser.mockImplementation((id: string) => (id === 'maestro-1' ? MAESTRO_USER : null))
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT])
    const res = await sendMessage(sendParams('user', 'an-architect', userCtx('maestro-1', 'maestro')))
    expect(res.status).toBe(201)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })

  it('agent sender (from=agentId) → an ARCHITECT is NOT blocked by this path — agent behavior unchanged', async () => {
    // On the Next.js route an authenticated agent has body.from overridden to its
    // agentId, so from !== 'user' ⇒ skipGraphCheck stays true (the prior agent
    // behavior — agents route through AMP for R6-governed messaging). This pins
    // that the fix did NOT add a new restriction to the agent path.
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT, { id: 'sender-agent', name: 'sender-agent', governanceTitle: 'member' }])
    const res = await sendMessage(sendParams('sender-agent', 'an-architect', agentCtx('sender-agent')))
    expect(res.status).toBe(201)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })
})

describe('messages-service.sendMessage — FLAG OFF (zero regression)', () => {
  beforeEach(() => {
    mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(false)
  })

  it('flag-off web session → ANY recipient (even ARCHITECT) succeeds — legacy skip preserved', async () => {
    // Flag-off web session is isSystemOwner=true (buildAuthContext: !agentId).
    // skipGraphCheck stays true; identical to today.
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT])
    const res = await sendMessage(sendParams('user', 'an-architect', { isSystemOwner: true, agentId: undefined }))
    expect(res.status).toBe(201)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })

  it('flag-off user-origin with a resolved userId still skips the graph (model-off no-op)', async () => {
    // Even if the check is no longer skipped at the call site, G06's user branch
    // requires the model ON — model OFF it skips, so the send succeeds. This pins
    // that not-skipping is harmless when the flag is off.
    mockUserRegistry.getUser.mockImplementation((id: string) => (id === 'user-1' ? NORMAL_USER : null))
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT])
    const res = await sendMessage(sendParams('user', 'an-architect', userCtx('user-1', 'user')))
    expect(res.status).toBe(201)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })
})
