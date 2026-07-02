/**
 * R38.2 — SendMessage user-sender authorization (the security-hole closure).
 *
 * Before the user-authority model, services/send-message-service.ts G06 SKIPPED
 * the comm-graph entirely for `senderTitle === 'user'`, so any "user" message
 * bypassed all routing. This test exercises the REAL SendMessage pipeline (only
 * the registries + store are mocked; the comm-graph runs for real) and proves:
 *
 *   - FLAG ON: a normal user → a forbidden recipient is BLOCKED (R38.2), and a
 *     normal user → own ASSISTANT / own-team COS / MANAGER succeeds; an active
 *     MAESTRO reaches anything.
 *   - FLAG OFF: the legacy skip is preserved — a user-origin message is not
 *     gated by the graph (byte-identical to pre-model), so sends succeed.
 *
 * The store layer (sendFromUI) is mocked so a green path returns success without
 * touching disk; the comm-graph (the logic under test) is NOT mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AuthContext } from '@/lib/agent-auth'

// ── Mocks: registries + store. The comm-graph is REAL (logic under test). ─────
type AgentRow = { id: string; name: string; governanceTitle?: string }
type TeamRow = { id: string; chiefOfStaffId?: string; agentIds?: string[] }
type UserRow = { id: string; title: string; assistantAgentId: string | null }

const { mockUserRegistry, mockGovernance, mockTeamRegistry, mockAgentRegistry, mockMessageFilter, mockMessageSend } = vi.hoisted(() => ({
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
  },
  mockMessageFilter: {
    checkMessageAllowed: vi.fn<() => { allowed: boolean; reason?: string }>(() => ({ allowed: true })),
  },
  mockMessageSend: {
    sendFromUI: vi.fn(async () => ({ message: { id: 'msg-1' }, notified: false })),
  },
}))

vi.mock('@/lib/user-registry', () => mockUserRegistry)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/message-filter', () => mockMessageFilter)
vi.mock('@/lib/message-send', () => mockMessageSend)

import { SendMessage } from '@/services/send-message-service'

// Agents the recipient identifier can resolve to.
const ASSISTANT_AGENT = { id: 'assistant-1', name: 'my-assistant', governanceTitle: 'assistant' }
const MANAGER_AGENT = { id: 'manager-1', name: 'the-manager', governanceTitle: 'manager' }
const COS_AGENT = { id: 'cos-1', name: 'team-cos', governanceTitle: 'chief-of-staff' }
const ARCH_AGENT = { id: 'arch-1', name: 'an-architect', governanceTitle: 'architect' }

const NORMAL_USER = { id: 'user-1', title: 'user', assistantAgentId: 'assistant-1' }
const MAESTRO_USER = { id: 'maestro-1', title: 'maestro', assistantAgentId: null }

function userCtx(userId: string, userTitle: AuthContext['userTitle']): AuthContext {
  // A user session: no agentId. isSystemOwner reflects active-maestro under the
  // model; for these service tests the graph decision is driven by userSender,
  // so isSystemOwner only matters for the G04.AUTH skip (user origin skips it).
  return { isSystemOwner: userTitle === 'maestro' || userTitle === 'maestro-delegate', agentId: undefined, userId, userTitle }
}

const baseInput = (toName: string) => ({
  from: 'user' as const,
  to: toName,
  subject: 'hi',
  content: { type: 'text', message: 'hello' },
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
  // Default: no agents resolve.
  mockAgentRegistry.loadAgents.mockReturnValue([])
  mockAgentRegistry.getAgent.mockReturnValue(null)
})

describe('FLAG ON — normal user (R38.2 enforcement)', () => {
  beforeEach(() => {
    mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(true)
    mockUserRegistry.getUser.mockImplementation((id: string) => (id === 'user-1' ? NORMAL_USER : null))
    mockUserRegistry.getActiveMaestroUserId.mockReturnValue('maestro-1') // user-1 is NOT the active maestro
  })

  it('normal user → a forbidden recipient (ARCHITECT) is BLOCKED', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT])
    const res = await SendMessage({ ...baseInput('an-architect'), authContext: userCtx('user-1', 'user') })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/R38\.2/)
    expect(mockMessageSend.sendFromUI).not.toHaveBeenCalled()
  })

  it('normal user → own ASSISTANT succeeds', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([ASSISTANT_AGENT])
    const res = await SendMessage({ ...baseInput('my-assistant'), authContext: userCtx('user-1', 'user') })
    expect(res.success).toBe(true)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })

  it('normal user → MANAGER succeeds', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([MANAGER_AGENT])
    mockGovernance.isManager.mockImplementation((id: string) => id === 'manager-1')
    const res = await SendMessage({ ...baseInput('the-manager'), authContext: userCtx('user-1', 'user') })
    expect(res.success).toBe(true)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })

  it('normal user → own-team COS succeeds', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([COS_AGENT])
    // The user follows the team (its ASSISTANT is a member) and COS-1 is its COS.
    mockTeamRegistry.loadTeams.mockReturnValue([
      { id: 't1', chiefOfStaffId: 'cos-1', agentIds: ['assistant-1'] },
    ])
    const res = await SendMessage({ ...baseInput('team-cos'), authContext: userCtx('user-1', 'user') })
    expect(res.success).toBe(true)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })

  it('normal user → a COS of a team they do NOT follow is BLOCKED', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([COS_AGENT])
    mockTeamRegistry.loadTeams.mockReturnValue([
      { id: 't9', chiefOfStaffId: 'cos-1', agentIds: ['some-other-agent'] },
    ])
    const res = await SendMessage({ ...baseInput('team-cos'), authContext: userCtx('user-1', 'user') })
    expect(res.success).toBe(false)
    expect(mockMessageSend.sendFromUI).not.toHaveBeenCalled()
  })
})

describe('FLAG ON — active MAESTRO (admin)', () => {
  beforeEach(() => {
    mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(true)
    mockUserRegistry.getUser.mockImplementation((id: string) => (id === 'maestro-1' ? MAESTRO_USER : null))
    mockUserRegistry.getActiveMaestroUserId.mockReturnValue('maestro-1')
  })

  it('MAESTRO → an ARCHITECT (forbidden for a normal user) succeeds', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT])
    const res = await SendMessage({ ...baseInput('an-architect'), authContext: userCtx('maestro-1', 'maestro') })
    expect(res.success).toBe(true)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })
})

describe('FLAG OFF — legacy user skip preserved (zero regression)', () => {
  beforeEach(() => {
    mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(false)
  })

  it('a user-origin message to ANY recipient is NOT gated by the graph (legacy)', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT])
    // Even an ARCHITECT recipient — which R38.2 would forbid for a normal user —
    // is allowed under the legacy skip when the model is off.
    const res = await SendMessage({
      ...baseInput('an-architect'),
      authContext: { isSystemOwner: true, agentId: undefined }, // no userId → flag-off web session
    })
    expect(res.success).toBe(true)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })

  it('a user-origin message with a resolved userId but model OFF still skips the graph', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([ARCH_AGENT])
    const res = await SendMessage({
      ...baseInput('an-architect'),
      authContext: userCtx('user-1', 'user'), // userId present but flag off
    })
    expect(res.success).toBe(true)
    expect(mockMessageSend.sendFromUI).toHaveBeenCalledTimes(1)
  })
})
