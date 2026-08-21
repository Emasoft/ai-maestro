// TRDD-903B7A20: deliverFederated must enforce the title communication graph
// on local delivery, exactly like the local/mesh path in routeMessage. An
// external AMP federation sender carries no governance-title attestation, so
// it must be treated as an unattested (null-role) sender and fail closed.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/agent-registry', () => ({
  loadAgents: vi.fn(() => []),
  createAgent: vi.fn(),
  getAgent: vi.fn(),
  getAgentByName: vi.fn(),
  getAgentByNameAnyHost: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  markAgentAsAMPRegistered: vi.fn(),
  checkMeshAgentExists: vi.fn(),
  getAMPRegisteredAgents: vi.fn(() => []),
}))
vi.mock('@/lib/amp-auth', () => ({
  authenticateRequest: vi.fn(),
  createApiKey: vi.fn(),
  hashApiKey: vi.fn(),
  extractApiKeyFromHeader: vi.fn(),
  revokeApiKey: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeAllKeysForAgent: vi.fn(),
}))
vi.mock('@/lib/agent-auth', () => ({ authenticateAgent: vi.fn() }))
vi.mock('@/lib/amp-keys', () => ({
  saveKeyPair: vi.fn(),
  loadKeyPair: vi.fn(),
  calculateFingerprint: vi.fn(),
  verifySignature: vi.fn(() => true),
  generateKeyPair: vi.fn(),
}))
vi.mock('@/lib/amp-relay', () => ({
  queueMessage: vi.fn(),
  getPendingMessages: vi.fn(),
  acknowledgeMessage: vi.fn(),
  acknowledgeMessages: vi.fn(),
  cleanupAllExpiredMessages: vi.fn(),
}))
const mockDeliver = vi.fn(async (_opts: unknown) => {})
vi.mock('@/lib/message-delivery', () => ({ deliver: (a: unknown) => mockDeliver(a) }))
vi.mock('@/lib/message-filter', () => ({ checkMessageAllowed: vi.fn(() => ({ allowed: true })) }))
vi.mock('@/lib/governance', () => ({ isManager: vi.fn(() => false), isChiefOfStaffAnywhere: vi.fn(() => false) }))
vi.mock('@/lib/role-attestation', () => ({
  createRoleAttestation: vi.fn(),
  serializeAttestation: vi.fn(),
  deserializeAttestation: vi.fn(),
  verifyRoleAttestation: vi.fn(),
}))
vi.mock('@/lib/host-keys', () => ({ getHostPublicKeyHex: vi.fn() }))
vi.mock('@/lib/amp-websocket', () => ({ deliverViaWebSocket: vi.fn() }))
vi.mock('@/lib/messageQueue', () => ({ resolveAgentIdentifier: vi.fn() }))
vi.mock('@/lib/hosts-config-server.mjs', () => ({
  getSelfHostId: vi.fn(() => 'self'),
  getSelfHost: vi.fn(),
  getHostById: vi.fn(),
  isSelf: vi.fn(() => true),
  getOrganization: vi.fn(() => 'default'),
}))
vi.mock('@/lib/ecosystem-constants', () => ({ statePath: (p: string) => p }))

import { getAgent } from '@/lib/agent-registry'
import { resolveAgentIdentifier } from '@/lib/messageQueue'
import { deliverFederated } from '@/services/amp-service'

const envelope = () => ({
  version: '1.0',
  id: `msg-${Math.random()}`,
  from: 'external-agent@other-host',
  to: 'local-member@self',
  subject: 'hello',
  priority: 'normal' as const,
  timestamp: new Date().toISOString(),
  thread_id: `thread-${Math.random()}`,
  signature: 'fake-sig',
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(getAgent as ReturnType<typeof vi.fn>).mockReturnValue({
    id: 'local-member-id',
    name: 'local-member',
    governanceTitle: 'member', // only manager/cos/orchestrator may reach member
  })
  ;(resolveAgentIdentifier as ReturnType<typeof vi.fn>).mockReturnValue({ agentId: 'local-member-id' })
})

describe('deliverFederated — comm-graph enforcement (TRDD-903B7A20)', () => {
  it('rejects a federated message to a MEMBER (untitled/unattested external sender denied)', async () => {
    const result = await deliverFederated('other-provider.example.com', {
      envelope: envelope(),
      payload: { type: 'text', body: { text: 'hi' } } as any,
      sender_public_key: 'fake-pub-key',
    })
    expect(result.status).toBe(403)
    expect((result.data as any).error).toBe('title_communication_forbidden')
    expect(mockDeliver).not.toHaveBeenCalled()
  })
})
