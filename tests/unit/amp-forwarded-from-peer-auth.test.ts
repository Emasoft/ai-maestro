/**
 * TRDD-3VFT513C — `X-Forwarded-From` no longer authenticates a mesh peer on
 * registry lookup alone; authentication requires a VERIFIED Ed25519 role
 * attestation against the forwarding host's own `publicKeyHex`.
 *
 * THE BUG (pre-fix, `services/amp-service.ts::routeMessage`): once
 * `getHostById(forwardedFrom)` resolved, `auth.authenticated` was set `true`
 * unconditionally — the attestation check only ran AFTERWARDS and only to
 * upgrade which ROLE the (already-authenticated) caller was credited with. A
 * caller that merely knew a valid host id (host ids are distributed by
 * `register-peer`/`exchange-peers` and are identifiers, not secrets) was
 * treated as a fully authenticated mesh peer with no cryptographic proof.
 *
 * THE FIX: authentication is now GATED on a verified attestation. Missing or
 * invalid attestation leaves `auth` unauthenticated and the existing 401 at
 * `routeMessage`'s authentication block fires — no new status code, no new
 * error shape, no fallback path.
 *
 * Both the Next.js route (`app/api/v1/route/route.ts`) and the headless
 * router (`services/headless-router.ts`, `POST /^\/api\/v1\/route$/`) forward
 * identical arguments into the SAME `routeMessage` — reading both call sites
 * confirms this. So there is exactly one place to fix, and this file proves
 * the refusal on BOTH entry points: directly against `routeMessage` (the
 * Next.js route's exact call shape), and end-to-end through the real
 * `createHeadlessRouter().handle()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

const { deliver, queueMessage, AGENTS } = vi.hoisted(() => ({
  deliver: vi.fn(async () => ({ delivered: true, notified: true })),
  queueMessage: vi.fn(),
  AGENTS: {} as Record<string, { id: string; name: string; alias: string; governanceTitle: string }>,
}))

vi.mock('@/lib/message-delivery', () => ({ deliver }))
vi.mock('@/lib/amp-websocket', () => ({ deliverViaWebSocket: vi.fn(async () => false) }))
vi.mock('@/lib/message-filter', () => ({ checkMessageAllowed: () => ({ allowed: true }) }))
vi.mock('@/lib/governance', () => ({ isManager: () => false, isChiefOfStaffAnywhere: () => false }))
vi.mock('@/lib/host-keys', () => ({ getHostPublicKeyHex: () => 'HOSTPK' }))
vi.mock('@/lib/messageQueue', () => ({
  resolveAgentIdentifier: () => null,
  // Pulled in transitively via lib/message-send.ts -> services/agents-messaging-service.ts,
  // which the headless router imports at module load. The r6 unit test does not import the
  // headless router, so it never needed these; this file drives the router directly.
  getSelfHostName: () => 'this-host',
  getMessage: vi.fn(),
}))

vi.mock('@/lib/amp-relay', () => ({
  queueMessage,
  getPendingMessages: vi.fn(() => []),
  acknowledgeMessage: vi.fn(),
  acknowledgeMessages: vi.fn(),
  cleanupAllExpiredMessages: vi.fn(),
}))

vi.mock('@/lib/amp-auth', () => ({
  // Unauthenticated by the ordinary bearer path: the mesh-forwarded branch is
  // the ONLY thing that can grant auth here, and it is the branch under test.
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

// A registered host with a public key on file — a real peer, per the registry.
// Registry membership (this resolving) is exactly the thing that is NO LONGER
// sufficient for authentication; the attestation must ALSO verify.
vi.mock('@/lib/hosts-config-server.mjs', () => ({
  getSelfHostId: () => 'this-host',
  getSelfHost: () => ({ id: 'this-host' }),
  getHostById: (id: string) => (id === 'peer-host' ? { id: 'peer-host', publicKeyHex: 'PEERPK' } : undefined),
  isSelf: (h: string) => h === 'this-host',
  getOrganization: () => 'default',
}))

vi.mock('@/lib/role-attestation', () => ({
  createRoleAttestation: vi.fn(),
  serializeAttestation: vi.fn(),
  deserializeAttestation: (raw: string) => JSON.parse(raw),
  verifyRoleAttestation: (att: { signature?: string }, hostPk: string) =>
    hostPk === 'PEERPK' && att.signature === 'GOOD',
}))

import { routeMessage } from '@/services/amp-service'
import { createHeadlessRouter } from '@/services/headless-router'

const validBody = {
  from: 'alice@peer.aimaestro.local',
  to: 'bob@default.aimaestro.local',
  subject: 'hi',
  payload: { type: 'notification', message: 'body' },
  // A mesh-forwarded sender's own signature is never verified (no key on this
  // host to check it against — TRDD-3VFT513C's card, fact 3); an unsigned
  // mesh message is rejected on a SEPARATE, pre-existing check (MF-01) that
  // this file must not trip while proving the auth fix, so every body that is
  // meant to reach past authentication carries one.
  signature: 'SIG',
} as never

/** A mesh forward carrying a signed claim that the sender holds `role`. */
const attested = (role: string, signature = 'GOOD') => ({
  senderRoleAttestation: JSON.stringify({ role, agentId: 'id-alice', signature }),
}) as never

beforeEach(() => {
  deliver.mockClear()
  queueMessage.mockClear()
})

describe('routeMessage — X-Forwarded-From requires a verified attestation to authenticate (TRDD-3VFT513C)', () => {
  it('a request authenticating solely via X-Forwarded-From + a known host id is refused (no attestation header at all)', async () => {
    const res = await routeMessage({ to: 'bob@default.aimaestro.local' } as never, null, 'peer-host', null, null, null, undefined)

    expect(res.status).toBe(401)
    expect((res.data as { error?: string }).error).toBe('unauthorized')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('a request with an attestation this host cannot verify (forged signature) is refused', async () => {
    const res = await routeMessage({ to: 'bob@default.aimaestro.local' } as never, null, 'peer-host', null, null, null, attested('member', 'FORGED'))

    expect(res.status).toBe(401)
    expect((res.data as { error?: string }).error).toBe('unauthorized')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('a request from a host with NO public key on file is refused even with an attestation header present', async () => {
    // 'unknown-host' does not resolve via getHostById at all, so this exercises
    // the `forwardingHost` branch of the guard, not just the publicKeyHex half.
    const res = await routeMessage({ to: 'bob@default.aimaestro.local' } as never, null, 'unknown-host', null, null, null, attested('manager'))

    expect(res.status).toBe(401)
    expect((res.data as { error?: string }).error).toBe('unauthorized')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('positive control: a correctly-attested mesh peer still authenticates and routes end-to-end', async () => {
    AGENTS['id-bob'] = { id: 'id-bob', name: 'bob', alias: 'bob', governanceTitle: 'member' }
    try {
      const res = await routeMessage(validBody, null, 'peer-host', null, null, null, attested('chief-of-staff'))

      expect(res.status).toBe(200)
      expect(deliver).toHaveBeenCalledTimes(1)
    } finally {
      delete AGENTS['id-bob']
    }
  })
})

// ---------------------------------------------------------------------------
// Same fix, driven through the OTHER entry point: the headless router's own
// route table calls the identical `routeMessage` (verified by reading
// services/headless-router.ts's `POST /^\/api\/v1\/route$/` handler), so this
// proves the refusal is not bypassable by whichever server mode dispatches
// the request.
// ---------------------------------------------------------------------------

function makeReq(method: string, url: string, headers: Record<string, string> = {}, body = '') {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const req = Readable.from(body ? [Buffer.from(body)] : []) as never as {
    method: string; url: string; headers: Record<string, string>
  }
  req.method = method
  req.url = url
  req.headers = lower
  return req as never
}

function makeRes() {
  const res: any = new EventEmitter()
  res.headersSent = false
  res.statusCode = 0
  res._chunks = []
  res.setHeader = () => {}
  res.writeHead = (status: number) => { res.statusCode = status; res.headersSent = true; return res }
  res.write = (c: any) => { res._chunks.push(Buffer.from(c)); return true }
  res.end = (c?: any) => { if (c) res._chunks.push(Buffer.from(c)); res.finished = true }
  res.bodyText = () => Buffer.concat(res._chunks).toString('utf-8')
  res.bodyJson = () => { try { return JSON.parse(res.bodyText()) } catch { return null } }
  return res
}

const router = createHeadlessRouter()

async function call(method: string, url: string, headers: Record<string, string> = {}, body = '') {
  const res = makeRes()
  await router.handle(makeReq(method, url, headers, body), res)
  return res
}

describe('headless-router POST /api/v1/route — the same refusal holds (TRDD-3VFT513C)', () => {
  it('a mesh-forwarded request with no attestation is refused with 401 unauthorized, not routed', async () => {
    const res = await call('POST', '/api/v1/route', { 'x-forwarded-from': 'peer-host' })

    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('unauthorized')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('a mesh-forwarded request with a forged attestation is refused with 401 unauthorized, not routed', async () => {
    const res = await call('POST', '/api/v1/route', {
      'x-forwarded-from': 'peer-host',
      'x-amp-sender-role-attestation': JSON.stringify({ role: 'manager', agentId: 'id-alice', signature: 'FORGED' }),
    })

    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('unauthorized')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('positive control: a correctly-attested mesh peer routes end-to-end through the headless router too', async () => {
    AGENTS['id-bob'] = { id: 'id-bob', name: 'bob', alias: 'bob', governanceTitle: 'member' }
    try {
      const res = await call(
        'POST',
        '/api/v1/route',
        {
          'x-forwarded-from': 'peer-host',
          'x-amp-sender-role-attestation': JSON.stringify({ role: 'chief-of-staff', agentId: 'id-alice', signature: 'GOOD' }),
        },
        JSON.stringify(validBody),
      )

      expect(res.statusCode).toBe(200)
      expect(deliver).toHaveBeenCalledTimes(1)
    } finally {
      delete AGENTS['id-bob']
    }
  })
})
