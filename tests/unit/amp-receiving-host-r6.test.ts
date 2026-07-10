/**
 * The RECEIVING host enforces R6 on a mesh-forwarded message (TRDD-XV4ANN4P).
 *
 * Since `lib/message-route-gate.ts` was wired in (b4003e4f), a message addressed
 * to `bob@otherhost` leaves the sending host on a deliberately WEAK check — does
 * this sender title reach anybody at all — because a recipient's governance title
 * lives on the recipient's host and a sender-side copy is a stale mirror. The FULL
 * graph check therefore happens here, in `routeMessage`'s local-delivery branch
 * (`services/amp-service.ts:1286`), which is what a peer's `/api/v1/route` re-enters.
 *
 * That check is now the ONLY graph check on the cross-host path, and nothing
 * exercised it. These tests do.
 *
 * A DENIAL IS "NOTHING WAS DELIVERED", NOT "A 403 CAME BACK". The graph runs at
 * :1286, the team filter at :1305, `deliverLocally` (and so `deliver`) at :1320 —
 * so a refusal must leave `deliver` untouched. Asserting the status alone would
 * pass even if the message had already landed in the recipient's inbox.
 *
 * The communication graph is REAL. Mocking it would test the mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { deliver, queueMessage, AGENTS } = vi.hoisted(() => ({
  deliver: vi.fn(async () => ({ delivered: true, notified: true })),
  queueMessage: vi.fn(),
  AGENTS: {
    'id-bob': { id: 'id-bob', name: 'bob', alias: 'bob', governanceTitle: 'member' },
  } as Record<string, { id: string; name: string; alias: string; governanceTitle: string }>,
}))

vi.mock('@/lib/message-delivery', () => ({ deliver }))
vi.mock('@/lib/amp-websocket', () => ({ deliverViaWebSocket: vi.fn(async () => false) }))
vi.mock('@/lib/message-filter', () => ({ checkMessageAllowed: () => ({ allowed: true }) }))
vi.mock('@/lib/governance', () => ({ isManager: () => false, isChiefOfStaffAnywhere: () => false }))
vi.mock('@/lib/host-keys', () => ({ getHostPublicKeyHex: () => 'HOSTPK' }))
vi.mock('@/lib/messageQueue', () => ({ resolveAgentIdentifier: () => null }))

vi.mock('@/lib/amp-relay', () => ({
  queueMessage,
  getPendingMessages: vi.fn(() => []),
  acknowledgeMessage: vi.fn(),
  acknowledgeMessages: vi.fn(),
  cleanupAllExpiredMessages: vi.fn(),
}))

vi.mock('@/lib/amp-auth', () => ({
  // Unauthenticated: the mesh-forwarded branch is what grants auth, and it is the
  // branch under test.
  authenticateRequest: () => ({ authenticated: false }),
  createApiKey: vi.fn(),
  hashApiKey: vi.fn(),
  extractApiKeyFromHeader: vi.fn(),
  revokeApiKey: vi.fn(),
  rotateApiKey: vi.fn(),
  revokeAllKeysForAgent: vi.fn(),
}))

vi.mock('@/lib/amp-keys', () => ({
  saveKeyPair: vi.fn(),
  loadKeyPair: vi.fn(() => null),
  calculateFingerprint: vi.fn(() => 'fp'),
  verifySignature: vi.fn(() => true),
  generateKeyPair: vi.fn(),
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string) => AGENTS[id],
  getAgentByName: (name: string) => Object.values(AGENTS).find(a => a.name === name),
  getAgentByNameAnyHost: vi.fn(),
  loadAgents: () => Object.values(AGENTS),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  markAgentAsAMPRegistered: vi.fn(),
  checkMeshAgentExists: vi.fn(async () => ({ exists: false })),
  getAMPRegisteredAgents: vi.fn(() => []),
}))

vi.mock('@/lib/hosts-config-server.mjs', () => ({
  getSelfHostId: () => 'this-host',
  getSelfHost: () => ({ id: 'this-host' }),
  getHostById: (id: string) => (id === 'peer-host' ? { id: 'peer-host', publicKeyHex: 'PEERPK' } : undefined),
  isSelf: (h: string) => h === 'this-host',
  getOrganization: () => 'default',
}))

// The attestation is the ONLY way this host learns a remote sender's title. A
// forged or absent one must not become a title (see the third test).
vi.mock('@/lib/role-attestation', () => ({
  createRoleAttestation: vi.fn(),
  serializeAttestation: vi.fn(),
  deserializeAttestation: (raw: string) => JSON.parse(raw),
  verifyRoleAttestation: (att: { signature?: string }, hostPk: string) =>
    hostPk === 'PEERPK' && att.signature === 'GOOD',
}))

import { routeMessage } from '@/services/amp-service'

const body = {
  from: 'alice@peer.aimaestro.local',
  to: 'bob@default.aimaestro.local',
  subject: 'hi',
  payload: { type: 'notification', message: 'body' },
  // Mandatory: an UNSIGNED mesh-forwarded message is rejected at :1008, long
  // before the graph. Without this the tests would all "pass" on that refusal and
  // prove nothing about R6. (For a mesh sender the signature is then discarded —
  // `senderKeyPair` is null by construction at :937, so this host has no key to
  // verify it with. Mesh trust rests on the HOST's role attestation, not on the
  // agent's signature. That is why the attestation cases below are the ones that
  // matter.)
  signature: 'SIG',
} as never

/** A mesh forward carrying a signed claim that the sender holds `role`. */
const attested = (role: string, signature = 'GOOD') => ({
  senderRoleAttestation: JSON.stringify({ role, agentId: 'id-alice', signature }),
}) as never

const route = (attestation?: unknown) =>
  routeMessage(body, null, 'peer-host', null, null, null, attestation as never)

/**
 * `routeMessage` has seven other 403 exits BEFORE the graph (signature, tenant,
 * sender-address checks). Asserting the status alone would let a test pass on the
 * wrong refusal and claim the graph works when it never ran. So every denial
 * assertion names the graph's own error code.
 */
const refusedByTheGraph = (res: { status?: number; data?: unknown }) => {
  expect(res.status).toBe(403)
  expect((res.data as { error?: string }).error).toBe('title_communication_forbidden')
}

beforeEach(() => {
  deliver.mockClear()
  queueMessage.mockClear()
})

describe('amp-service.routeMessage — the receiving host is the real R6 gate', () => {
  it('MEMBER → MEMBER across the mesh is REFUSED, and nothing is delivered', async () => {
    // The sending host let this leave on the weak check (a MEMBER reaches SOMEBODY).
    // Only this host knows bob is a MEMBER, and member→member is not an edge.
    const res = await route(attested('member'))

    refusedByTheGraph(res)
    expect(deliver).not.toHaveBeenCalled()
    expect(queueMessage).not.toHaveBeenCalled()
  })

  it('CHIEF-OF-STAFF → MEMBER across the mesh is allowed, and IS delivered', async () => {
    // The mirror image: a gate that refuses everything is not a gate.
    const res = await route(attested('chief-of-staff'))

    expect(res.status).toBe(200)
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('a mesh forward with NO attestation has no sender title, so it is refused', async () => {
    // `senderTitle = verifiedSenderRole || null` and the graph fails closed on a
    // null sender. Without this, an unattested peer would inherit whatever the
    // graph does with `undefined` — the same truthy/falsy trap that let the
    // sender-side `'unknown'` sentinel skip a safe default.
    const res = await route(undefined)

    refusedByTheGraph(res)
    expect(deliver).not.toHaveBeenCalled()
  })

  it('an attestation this host cannot verify grants no title, and is refused', async () => {
    // A forged signature must not be worth more than no signature at all.
    const res = await route(attested('chief-of-staff', 'FORGED'))

    refusedByTheGraph(res)
    expect(deliver).not.toHaveBeenCalled()
  })
})
