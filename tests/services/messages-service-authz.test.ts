/**
 * Message-route object-level authz tests (TRDD-2ee0c2d8 follow-up).
 *
 * Exercises the service-layer ownership guard (defence-in-depth) added to
 * messages-service (getMessages / updateMessage / removeMessage) and
 * agents-messaging-service (listMessages). The guard mirrors SendMessage's
 * G04.AUTH reject: an authenticated agent may only touch its OWN mailbox; the
 * system owner is exempt; a call without an authContext is not enforced (the
 * route guard is authoritative for those internal/headless callers).
 *
 * The store layer is mocked so these tests isolate the authz decision — they
 * call the REAL service functions (no mocking of code under test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock the message stores (so the guard is the only logic under test) ---
const { mockMessageQueue, mockAgentMessaging, mockAgentRegistry } = vi.hoisted(() => ({
  mockMessageQueue: {
    resolveAgentIdentifier: vi.fn(),
    getMessage: vi.fn(async () => ({ id: 'm1' })),
    markMessageAsRead: vi.fn(async () => true),
    archiveMessage: vi.fn(async () => true),
    deleteMessage: vi.fn(async () => true),
    getUnreadCount: vi.fn(async () => 0),
    getSentCount: vi.fn(async () => 0),
    getMessageStats: vi.fn(async () => ({})),
    listInboxMessages: vi.fn(async () => []),
    listSentMessages: vi.fn(async () => []),
    listAgentsWithMessages: vi.fn(async () => []),
  },
  mockAgentMessaging: {
    listAgentInboxMessages: vi.fn(async () => []),
    listAgentSentMessages: vi.fn(async () => []),
    getAgentMessageStats: vi.fn(async () => ({})),
  },
  mockAgentRegistry: {
    getAgent: vi.fn(() => ({ id: 'self', name: 'self-agent' })),
    searchAgents: vi.fn(() => []),
  },
}))

vi.mock('@/lib/messageQueue', () => mockMessageQueue)
vi.mock('@/lib/agent-messaging', () => mockAgentMessaging)
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/hosts-config', () => ({
  getSelfHostId: vi.fn(() => 'local'),
  getSelfHost: vi.fn(() => ({ id: 'local', name: 'local', url: 'http://localhost:23000' })),
  getHosts: vi.fn(() => []),
  isSelf: vi.fn(() => true),
}))
vi.mock('@/lib/message-send', () => ({ sendFromUI: vi.fn(), forwardFromUI: vi.fn() }))

import { getMessages, updateMessage, removeMessage } from '@/services/messages-service'
import { listMessages } from '@/services/agents-messaging-service'
import type { AuthContext } from '@/lib/agent-auth'

const SELF = 'self-uuid'
const OTHER = 'other-uuid'

const ownerCtx: AuthContext = { isSystemOwner: true, agentId: undefined }
const agentCtx = (agentId: string): AuthContext => ({ isSystemOwner: false, agentId })

beforeEach(() => {
  vi.clearAllMocks()
  // By default the supplied identifier resolves to the SELF agent's UUID.
  mockMessageQueue.resolveAgentIdentifier.mockImplementation((id: string) =>
    id ? { agentId: id, alias: id } : null,
  )
})

describe('messages-service object-level authz (getMessages / updateMessage / removeMessage)', () => {
  it('getMessages: an authenticated agent reading its OWN mailbox is allowed', async () => {
    /** self-OK: identifier resolves to caller agentId → store is queried. */
    const res = await getMessages({ agent: SELF, id: 'm1', box: 'inbox' }, agentCtx(SELF))
    expect(res.status).toBe(200)
    expect(mockMessageQueue.getMessage).toHaveBeenCalledWith(SELF, 'm1', 'inbox')
  })

  it('getMessages: an authenticated agent reading ANOTHER mailbox is 403 (no store read)', async () => {
    /** cross-agent-403: the IDOR — caller agentId != resolved owner → denied, store never touched. */
    const res = await getMessages({ agent: OTHER, id: 'm1', box: 'inbox' }, agentCtx(SELF))
    expect(res.status).toBe(403)
    expect(res.error).toMatch(/your own mailbox/i)
    expect(mockMessageQueue.getMessage).not.toHaveBeenCalled()
  })

  it('getMessages: the system owner may read ANY mailbox', async () => {
    /** system-owner-OK: isSystemOwner bypasses the ownership compare. */
    const res = await getMessages({ agent: OTHER, id: 'm1', box: 'inbox' }, ownerCtx)
    expect(res.status).toBe(200)
    expect(mockMessageQueue.getMessage).toHaveBeenCalledWith(OTHER, 'm1', 'inbox')
  })

  it('getMessages: no authContext is not enforced (route guard authoritative)', async () => {
    /** internal/headless callers carry no authContext → guard is a no-op. */
    const res = await getMessages({ agent: OTHER, id: 'm1', box: 'inbox' })
    expect(res.status).toBe(200)
    expect(mockMessageQueue.getMessage).toHaveBeenCalledWith(OTHER, 'm1', 'inbox')
  })

  it('getMessages: directory-discovery (action=search) is exempt — an agent may look up others', async () => {
    /** search/resolve/agents are agent-discovery, not mailbox reads → never blocked. */
    const res = await getMessages({ agent: OTHER, action: 'search' }, agentCtx(SELF))
    expect(res.status).toBe(200)
    expect(mockAgentRegistry.searchAgents).toHaveBeenCalledWith(OTHER)
  })

  it('updateMessage: an authenticated agent mark-read on ANOTHER mailbox is 403 (no mutation)', async () => {
    const res = await updateMessage(OTHER, 'm1', 'read', agentCtx(SELF))
    expect(res.status).toBe(403)
    expect(mockMessageQueue.markMessageAsRead).not.toHaveBeenCalled()
  })

  it('updateMessage: an authenticated agent mark-read on its OWN mailbox is allowed', async () => {
    const res = await updateMessage(SELF, 'm1', 'read', agentCtx(SELF))
    expect(res.status).toBe(200)
    expect(mockMessageQueue.markMessageAsRead).toHaveBeenCalledWith(SELF, 'm1')
  })

  it('updateMessage: the system owner may mark-read ANY mailbox', async () => {
    const res = await updateMessage(OTHER, 'm1', 'read', ownerCtx)
    expect(res.status).toBe(200)
    expect(mockMessageQueue.markMessageAsRead).toHaveBeenCalledWith(OTHER, 'm1')
  })

  it('removeMessage: an authenticated agent deleting from ANOTHER mailbox is 403 (no delete)', async () => {
    const res = await removeMessage(OTHER, 'm1', agentCtx(SELF))
    expect(res.status).toBe(403)
    expect(mockMessageQueue.deleteMessage).not.toHaveBeenCalled()
  })

  it('removeMessage: an authenticated agent deleting from its OWN mailbox is allowed', async () => {
    const res = await removeMessage(SELF, 'm1', agentCtx(SELF))
    expect(res.status).toBe(200)
    expect(mockMessageQueue.deleteMessage).toHaveBeenCalledWith(SELF, 'm1')
  })

  it('removeMessage: no authContext is not enforced (route guard authoritative)', async () => {
    const res = await removeMessage(OTHER, 'm1')
    expect(res.status).toBe(200)
    expect(mockMessageQueue.deleteMessage).toHaveBeenCalledWith(OTHER, 'm1')
  })

  it('removeMessage: an agent whose identity cannot be resolved is 403', async () => {
    /** A verified agent whose supplied identifier resolves to nothing owns no mailbox → deny. */
    mockMessageQueue.resolveAgentIdentifier.mockReturnValue(null)
    const res = await removeMessage(OTHER, 'm1', agentCtx(SELF))
    expect(res.status).toBe(403)
    expect(mockMessageQueue.deleteMessage).not.toHaveBeenCalled()
  })
})

describe('agents-messaging-service object-level authz (listMessages)', () => {
  it('listMessages: an authenticated agent reading its OWN mailbox is allowed', async () => {
    /** path agentId == caller agentId → store queried. */
    const res = await listMessages(SELF, { box: 'inbox' }, agentCtx(SELF))
    expect(res.status).toBe(200)
    expect(mockAgentMessaging.listAgentInboxMessages).toHaveBeenCalled()
  })

  it('listMessages: an authenticated agent reading ANOTHER mailbox is 403 (no store read)', async () => {
    /** the unauthenticated-IDOR closure: path agentId != caller → 403 before getAgent. */
    const res = await listMessages(OTHER, { box: 'inbox' }, agentCtx(SELF))
    expect(res.status).toBe(403)
    expect(res.error).toMatch(/your own mailbox/i)
    expect(mockAgentRegistry.getAgent).not.toHaveBeenCalled()
    expect(mockAgentMessaging.listAgentInboxMessages).not.toHaveBeenCalled()
  })

  it('listMessages: the system owner may read ANY mailbox', async () => {
    const res = await listMessages(OTHER, { box: 'inbox' }, ownerCtx)
    expect(res.status).toBe(200)
    expect(mockAgentMessaging.listAgentInboxMessages).toHaveBeenCalled()
  })

  it('listMessages: no authContext is not enforced (route guard authoritative)', async () => {
    const res = await listMessages(OTHER, { box: 'inbox' })
    expect(res.status).toBe(200)
    expect(mockAgentMessaging.listAgentInboxMessages).toHaveBeenCalled()
  })
})
