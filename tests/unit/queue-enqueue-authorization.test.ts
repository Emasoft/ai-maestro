/**
 * SECURITY REGRESSION — enqueuing a command for ANOTHER agent is an
 * AUTHORIZED act, never a bare-authentication one.
 *
 * TRDD-8RVDY7ND. Before this suite, `POST /api/agents/[id]/queue` called
 * `requireSudoToken` (proves the caller holds a fresh sudo token / a valid
 * AID+title pair) and `authenticateFromRequest` (proves WHO the caller is)
 * and NOTHING ELSE — no `authorize()` call, no cross-agent check at all. Its
 * own sibling, `DELETE /api/agents/[id]/queue/[entryId]`, already carries a
 * doc comment claiming "Enqueue is gated (MANAGER anywhere, COS in-team, an
 * agent on itself)" — a false claim about code that did not exist. So ANY
 * authenticated agent, of ANY title, could enqueue an ARBITRARY command onto
 * ANY other agent's terminal, unconditionally — not even gated to the target
 * being blocked, which is a strictly worse hole than the one this card names.
 *
 * Every `expect(403)` below returned 201 against the old handler.
 *
 * The fix reuses the SAME `send-command` matrix every sibling drive route
 * already uses (PATCH .../session, POST .../chat, DELETE .../[entryId]):
 * R42 (lib/authorization.ts DRIVE_ACTIONS) refuses `send-command` for any
 * cross-agent target unconditionally, for every title including MANAGER and
 * CHIEF-OF-STAFF; SELF_DRIVE_ACTIONS exempts an agent enqueuing for itself;
 * the system owner (no agentId) is granted outright.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

type AuthResult = {
  agentId?: string
  governanceTitle?: string
  teamId?: string | null
  userId?: string
  userTitle?: string
  error?: string
  status?: number
}

const { mockAuth, mockSudo, mockCore, mockCommandQueue } = vi.hoisted(() => ({
  mockAuth: { authenticateFromRequest: vi.fn(), buildAuthContext: vi.fn(() => ({})) },
  mockSudo: { requireSudoToken: vi.fn(() => null) },
  mockCore: {
    getAgentById: vi.fn(() => ({ data: { agent: { id: 'x' } } })),
    onQueueEnqueued: vi.fn(async () => undefined),
  },
  mockCommandQueue: {
    enqueueCommand: vi.fn(() => ({ ok: true, entry: { id: 'entry-1' } })),
    listQueue: vi.fn(() => []),
  },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/sudo-guard', () => mockSudo)
vi.mock('@/services/agents-core-service', () => mockCore)
vi.mock('@/lib/command-queue', () => mockCommandQueue)
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))
// NOTE: '@/lib/authorization' is deliberately NOT mocked — the real matrix runs.

import { POST } from '@/app/api/agents/[id]/queue/route'
import { NextRequest } from 'next/server'

const MEMBER = 'agent-member-1'
const MANAGER = 'agent-manager-1'
const COS = 'agent-cos-1'
const TARGET = 'agent-target-1'

function as(auth: AuthResult) {
  mockAuth.authenticateFromRequest.mockReturnValue(auth)
}

async function enqueue(targetAgentId: string, body: Record<string, unknown> = { commandKey: 'compact' }) {
  const req = new NextRequest(
    new URL(`http://localhost:23000/api/agents/${targetAgentId}/queue`),
    { method: 'POST', body: JSON.stringify(body) } as never,
  )
  return POST(req, { params: Promise.resolve({ id: targetAgentId }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSudo.requireSudoToken.mockReturnValue(null)
  mockCore.getAgentById.mockReturnValue({ data: { agent: { id: TARGET } } })
  mockCommandQueue.enqueueCommand.mockReturnValue({ ok: true, entry: { id: 'entry-1' } })
})

describe('an agent may not enqueue commands on OTHER agents', () => {
  it('a MEMBER enqueuing onto a peer is refused (was 201)', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    const res = await enqueue(TARGET)
    expect(res.status).toBe(403)
    expect(mockCommandQueue.enqueueCommand).not.toHaveBeenCalled()
  })

  it('a MANAGER enqueuing onto ANOTHER agent is refused (R42 — was 201)', async () => {
    as({ agentId: MANAGER, governanceTitle: 'manager', teamId: null })
    const res = await enqueue(TARGET)
    expect(res.status).toBe(403)
    expect(mockCommandQueue.enqueueCommand).not.toHaveBeenCalled()
  })

  it('a CHIEF-OF-STAFF enqueuing onto ANOTHER agent (even its own team) is refused (R42 — was 201)', async () => {
    as({ agentId: COS, governanceTitle: 'chief-of-staff', teamId: 'team-a' })
    const res = await enqueue(TARGET)
    expect(res.status).toBe(403)
    expect(mockCommandQueue.enqueueCommand).not.toHaveBeenCalled()
  })
})

describe('an agent may enqueue on itself; the system owner is unaffected', () => {
  it('an agent enqueuing on ITSELF succeeds', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    mockCore.getAgentById.mockReturnValue({ data: { agent: { id: MEMBER } } })
    const res = await enqueue(MEMBER)
    expect(res.status).toBe(201)
    expect(mockCommandQueue.enqueueCommand).toHaveBeenCalled()
  })

  it('the system owner (web UI, no agentId) may enqueue on any agent', async () => {
    as({})
    const res = await enqueue(TARGET)
    expect(res.status).toBe(201)
    expect(mockCommandQueue.enqueueCommand).toHaveBeenCalled()
  })
})

describe('preconditions', () => {
  it('an errored auth result is refused before authorize() runs', async () => {
    as({ error: 'token_invalid', status: 401 })
    const res = await enqueue(TARGET)
    expect(res.status).toBe(401)
    expect(mockCommandQueue.enqueueCommand).not.toHaveBeenCalled()
  })

  it('a fresh sudo-guard refusal is returned before authorize() runs', async () => {
    const { NextResponse } = await import('next/server')
    mockSudo.requireSudoToken.mockReturnValue(
      NextResponse.json({ error: 'sudo_required' }, { status: 403 }) as never,
    )
    as({ agentId: MANAGER, governanceTitle: 'manager', teamId: null })
    const res = await enqueue(TARGET)
    expect(res.status).toBe(403)
    expect(mockCommandQueue.enqueueCommand).not.toHaveBeenCalled()
  })
})

describe('static invariants', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'app', 'api', 'agents', '[id]', 'queue', 'route.ts'),
    'utf-8',
  )
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the POST handler authorizes, and does not lean on sudo/auth alone', () => {
    // Only the POST export needs the send-command gate — carve out the GET
    // handler (read-only, deliberately un-gated per its own doc comment) so
    // this assertion cannot be satisfied by a match anywhere in the file.
    const postBody = code.slice(code.indexOf('export async function POST'))
    expect(postBody).toMatch(/authorize\s*\(\s*auth\s*,\s*'send-command'/)
  })
})
