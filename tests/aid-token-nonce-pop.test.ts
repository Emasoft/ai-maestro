/**
 * Route-level tests for the NONCE-bound AID proof-of-possession
 * (TRDD-15ff13ae) at POST /api/v1/auth/token.
 *
 * These use REAL Ed25519 crypto and the REAL nonce store (lib/aid-nonce.ts) —
 * only the surrounding I/O (rate-limit, key/agent/team lookup, ledger,
 * token persistence) is mocked, so the actual anti-replay path is exercised
 * end-to-end:
 *   - a fresh nonce-bound proof mints a token (happy path);
 *   - the SAME captured proof replayed is rejected (the core fix — the nonce
 *     was consumed on first use);
 *   - a proof over a nonce that was never issued is rejected;
 *   - a proof signed with the WRONG key is rejected and does NOT burn the
 *     nonce (cross-agent regression + authenticate-before-consume).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sign as edSign } from 'node:crypto'

// Real Ed25519 keypairs generated once, before the mocks — the "registered"
// key (agent-1) and an attacker key that is NOT registered.
const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('node:crypto') as typeof import('node:crypto')
  const registered = crypto.generateKeyPairSync('ed25519')
  const attacker = crypto.generateKeyPairSync('ed25519')
  // publicHex = the raw 32-byte Ed25519 key (SPKI DER is 12-byte header + 32).
  const publicHex = Buffer.from(
    registered.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  ).subarray(12).toString('hex')
  return { registered, attacker, publicHex }
})

vi.mock('@/lib/rate-limit', () => ({
  checkAndRecordAttempt: () => ({ allowed: true }),
  resetRateLimit: () => {},
}))

// Keep the REAL verifyNonceProof* (crypto) — only stub token persistence so the
// test does no disk I/O.
vi.mock('@/lib/aid-token', async () => {
  const actual = await vi.importActual<typeof import('@/lib/aid-token')>('@/lib/aid-token')
  return {
    ...actual,
    issueGovernanceToken: async (
      agentId: string, name: string, title: string, teamId: string | null, scope: string
    ) => ({
      access_token: 'aim_tk_test', token_type: 'bearer', expires_in: 3600,
      agent_id: agentId, governance_title: title, team_id: teamId, scope,
    }),
  }
})

vi.mock('@/lib/amp-keys', () => ({
  loadKeyPair: () => ({ publicHex: h.publicHex, privatePem: '', publicPem: '', fingerprint: 'SHA256:fp-1' }),
}))

vi.mock('@/lib/team-registry', () => ({ loadTeams: () => [] }))

vi.mock('@/lib/agent-registry', () => {
  const agent = {
    id: 'agent-1',
    name: 'alpha',
    governanceTitle: 'autonomous',
    metadata: { amp: { fingerprint: 'SHA256:fp-1' } },
  }
  return { loadAgents: () => [agent], getAgentByName: () => agent }
})

vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ ledger: { enforceAidAssociation: false } }),
}))

vi.mock('@/lib/aid-ledger-authority', () => ({
  isAidAssociated: () => ({ ok: false }),
  reconstructAgentAuthState: () => null,
}))

import { POST } from '@/app/api/v1/auth/token/route'
import { issueNonce, __resetNonceStoreForTests } from '@/lib/aid-nonce'

const FP = 'SHA256:fp-1'
const SERVER_URL = `http://localhost:${process.env.PORT || 23000}`

/** Build a base64url proof = [Ed25519 sig(64)][nonce string], signed over the nonce. */
function buildProof(nonce: string, privateKey = h.registered.privateKey): string {
  const signingInput = `aid-token-exchange\n${nonce}\n${SERVER_URL}`
  const sig = edSign(null, Buffer.from(signingInput), privateKey) // 64 bytes
  return Buffer.concat([sig, Buffer.from(nonce, 'utf-8')]).toString('base64url')
}

function makeRequest(proof: string, fingerprint = FP): Request {
  const identity = Buffer.from(JSON.stringify({ fingerprint, alias: 'alpha' })).toString('base64url')
  return new Request(`${SERVER_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'urn:aid:agent-identity', agent_identity: identity, proof }),
  })
}

beforeEach(() => {
  __resetNonceStoreForTests()
})

describe('AID token PoP — nonce-bound (TRDD-15ff13ae)', () => {
  it('happy path: a fresh nonce-bound proof mints a token', async () => {
    const { nonce } = issueNonce(FP)!
    const res = await POST(makeRequest(buildProof(nonce)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBe('aim_tk_test')
  })

  it('CORE FIX: the SAME captured proof replayed is rejected (single-use nonce)', async () => {
    const { nonce } = issueNonce(FP)!
    const proof = buildProof(nonce)

    const first = await POST(makeRequest(proof))
    expect(first.status).toBe(200)

    // Replay the identical request — the nonce is already consumed.
    const replay = await POST(makeRequest(proof))
    expect(replay.status).toBe(401)
    const body = await replay.json()
    expect(body.error).toBe('invalid_nonce')
  })

  it('rejects a proof over a nonce that was never issued', async () => {
    const bogusNonce = 'a'.repeat(64) // valid-looking hex, but never issued
    const res = await POST(makeRequest(buildProof(bogusNonce)))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('invalid_nonce')
  })

  it('regression: a proof signed with the WRONG key is rejected and does NOT burn the nonce', async () => {
    const { nonce } = issueNonce(FP)!

    // Attacker signs with an unregistered key → signature fails against the
    // registered public key. Verified BEFORE consume, so the nonce survives.
    const badRes = await POST(makeRequest(buildProof(nonce, h.attacker.privateKey)))
    expect(badRes.status).toBe(401)
    expect((await badRes.json()).error).toBe('invalid_proof')

    // The legitimate agent can still use the same nonce — it was not consumed.
    const goodRes = await POST(makeRequest(buildProof(nonce)))
    expect(goodRes.status).toBe(200)
  })

  it('rejects when the presented fingerprint does not match the nonce binding', async () => {
    // Nonce bound to fp-1, but the agent-registry mock resolves the same agent
    // regardless of alias; here we force a nonce bound to a DIFFERENT
    // fingerprint than the identity presents.
    const { nonce } = issueNonce('SHA256:someone-else')!
    const res = await POST(makeRequest(buildProof(nonce), FP))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('invalid_nonce')
  })
})
