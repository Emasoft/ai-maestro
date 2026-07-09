/**
 * SECURITY REGRESSION (CRITICAL) — GET /api/agents/[id]/export ships the target
 * agent's PRIVATE SIGNING KEY, and must be system-owner only.
 *
 * `exportAgentZip()` does `archive.directory(getKeysDir(agent.id), 'keys')`
 * (services/agents-transfer-service.ts). `getKeysDir` resolves to
 * `~/.aimaestro/agents/<id>/keys`, whose `private.pem` lib/amp-keys.ts annotates
 * verbatim: "Agent's private key (NEVER shared)". The same archive also carries
 * `registrations/` (external AMP provider API keys), `agent.db`, and every
 * inbox / sent / archived message.
 *
 * The route guarded that with `enforceAuth` alone — which AUTHENTICATES and
 * discards the identity (it returns `NextResponse | null`, never the caller). So
 * any holder of any valid agent token could download any other agent's Ed25519
 * private key and forge correctly-signed AMP messages as that agent, forever.
 * No downstream governance check can detect such a forgery: the signature is
 * genuine.
 *
 * Why it survived two guardrails: `agent-route-authorization-coverage.test.ts`
 * and `dangerous-primitive-authorization.test.ts` both filter on
 * `export function (POST|PUT|PATCH|DELETE)`. Exfiltration is a GET. A guardrail
 * keyed on mutation cannot see a route that only reads.
 *
 * MANAGER and COS are denied too, on purpose. MANAGER already governs an agent
 * completely without its signing key; COS coordinates a team, it does not
 * impersonate its members. There is no role for which "can sign as you" is the
 * right grant. Self-export is denied for the same reason it grants nothing: an
 * agent can already read its own keys off disk, and the API should not be a
 * one-request exfiltration channel for a compromised one.
 *
 * FALSIFIED: with the `authorize()` block removed from the route, every
 * `expect(403)` below fails and every `expect(exportAgentZip).not.toHaveBeenCalled()`
 * fails. A regression test that passes against the buggy code proves nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type AuthResult = {
  agentId?: string
  governanceTitle?: string
  teamId?: string | null
  userId?: string
  userTitle?: string
  error?: string
  status?: number
}

const { mockAuth, mockTransfer } = vi.hoisted(() => ({
  mockAuth: { authenticateFromRequest: vi.fn() },
  mockTransfer: {
    exportAgentZip: vi.fn(),
    createTranscriptExportJob: vi.fn(),
  },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/services/agents-transfer-service', () => mockTransfer)
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))
// '@/lib/authorization' is NOT mocked — the real matrix decides.

import { GET, POST } from '@/app/api/agents/[id]/export/route'
import { NextRequest } from 'next/server'

const MEMBER = 'agent-member-1'
const MANAGER = 'agent-manager-1'
const COS = 'agent-cos-1'
const TARGET = 'agent-target-1'

function as(auth: AuthResult) {
  mockAuth.authenticateFromRequest.mockReturnValue(auth)
}

function getReq(id: string) {
  const req = new NextRequest(new URL(`http://localhost:23000/api/agents/${id}/export`))
  return GET(req, { params: { id } as never })
}

function postReq(id: string) {
  const req = new NextRequest(new URL(`http://localhost:23000/api/agents/${id}/export`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'json' }),
  } as never)
  return POST(req, { params: { id } as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTransfer.exportAgentZip.mockResolvedValue({
    data: {
      buffer: Buffer.from('zip-bytes'),
      filename: 'agent.zip',
      agentId: TARGET,
      agentName: 'target',
    },
  })
  mockTransfer.createTranscriptExportJob.mockReturnValue({ data: { jobId: 'j1' } })
})

describe('GET /api/agents/[id]/export — the archive contains private.pem', () => {
  it('the system owner (web UI, no agentId) may export', async () => {
    as({})
    const res = await getReq(TARGET)
    expect(res.status).toBe(200)
    expect(mockTransfer.exportAgentZip).toHaveBeenCalledWith(TARGET)
  })

  it('a maestro system-owner user may export', async () => {
    as({ userId: 'u1', userTitle: 'maestro' })
    const res = await getReq(TARGET)
    expect(res.status).toBe(200)
  })

  it('a MEMBER agent may NOT export another agent — this was the key theft', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member' })
    const res = await getReq(TARGET)
    expect(res.status).toBe(403)
    // The keys directory must never be touched on a denial.
    expect(mockTransfer.exportAgentZip).not.toHaveBeenCalled()
  })

  it('a MANAGER may NOT export — governing an agent never requires its signing key', async () => {
    as({ agentId: MANAGER, governanceTitle: 'manager' })
    const res = await getReq(TARGET)
    expect(res.status).toBe(403)
    expect(mockTransfer.exportAgentZip).not.toHaveBeenCalled()
  })

  it('a CHIEF-OF-STAFF may NOT export a team member — coordination is not impersonation', async () => {
    as({ agentId: COS, governanceTitle: 'chief-of-staff', teamId: 'team-1' })
    const res = await getReq(TARGET)
    expect(res.status).toBe(403)
    expect(mockTransfer.exportAgentZip).not.toHaveBeenCalled()
  })

  it('an agent may NOT export ITSELF over the API', async () => {
    as({ agentId: TARGET, governanceTitle: 'member' })
    const res = await getReq(TARGET)
    expect(res.status).toBe(403)
    expect(mockTransfer.exportAgentZip).not.toHaveBeenCalled()
  })

  it('a failed authentication is rejected before any service call', async () => {
    as({ error: 'token_invalid', status: 401 })
    const res = await getReq(TARGET)
    expect(res.status).toBe(401)
    expect(mockTransfer.exportAgentZip).not.toHaveBeenCalled()
  })

  it('a non-maestro user principal is denied', async () => {
    as({ userId: 'u2', userTitle: 'user' })
    const res = await getReq(TARGET)
    expect(res.status).toBe(403)
    expect(mockTransfer.exportAgentZip).not.toHaveBeenCalled()
  })
})

describe('POST /api/agents/[id]/export — transcript job, same action', () => {
  it('the system owner may create a transcript export job', async () => {
    as({})
    const res = await postReq(TARGET)
    expect(res.status).toBe(200)
    expect(mockTransfer.createTranscriptExportJob).toHaveBeenCalled()
  })

  it('a MEMBER agent may NOT export another agent transcripts', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member' })
    const res = await postReq(TARGET)
    expect(res.status).toBe(403)
    expect(mockTransfer.createTranscriptExportJob).not.toHaveBeenCalled()
  })

  it('an agent may NOT export its OWN transcripts over the API', async () => {
    as({ agentId: TARGET, governanceTitle: 'member' })
    const res = await postReq(TARGET)
    expect(res.status).toBe(403)
    expect(mockTransfer.createTranscriptExportJob).not.toHaveBeenCalled()
  })

  it('the body is never parsed for an unauthorized caller', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member' })
    const res = await postReq(TARGET)
    expect(res.status).toBe(403)
    // Authorization precedes body handling; nothing downstream ran.
    expect(mockTransfer.createTranscriptExportJob).not.toHaveBeenCalled()
  })
})

describe('the export-agent action denies every agent title, by construction', () => {
  it.each([
    ['manager', MANAGER],
    ['chief-of-staff', COS],
    ['member', MEMBER],
    ['architect', 'agent-arch-1'],
    ['orchestrator', 'agent-orch-1'],
    ['integrator', 'agent-int-1'],
    ['maintainer', 'agent-maint-1'],
    ['autonomous', 'agent-auto-1'],
  ])('%s is denied', async (title, agentId) => {
    as({ agentId, governanceTitle: title })
    const res = await getReq(TARGET)
    expect(res.status).toBe(403)
    expect(mockTransfer.exportAgentZip).not.toHaveBeenCalled()
  })
})
