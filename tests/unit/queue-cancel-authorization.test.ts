/**
 * SECURITY REGRESSION — cancelling a queued command is an AUTHORIZED act.
 *
 * Before this suite, `DELETE /api/agents/[id]/queue/[entryId]` called
 * `requireAuth` and nothing else. `requireAuth` proves WHO the caller is; it
 * never proves what they may do. Enqueue is gated (MANAGER anywhere, COS in
 * team, an agent on itself) while cancel was gated by nothing, and the sibling
 * GET hands any authenticated caller the entry ids. One valid agent token could
 * therefore delete every command the MANAGER had queued across the whole fleet,
 * silently, with no 403 and no audit. The POST gate protected nothing: you could
 * not inject, but you could nullify.
 *
 * Every `expect(403)` below returned 200 against the old handler. That is the
 * point — a regression test that passes on the buggy code proves nothing.
 *
 * Two attacks, two checks (see the route's doc comment):
 *   1. CROSS-AGENT  → the `send-command` matrix.
 *   2. SELF-TARGET  → `send-command` ALONE is not enough, because self-drive is
 *      exempt (TRDD-D3RP7KQZ). Driving your own terminal is allowed; refusing an
 *      order queued for you is not. Ownership (`enqueuedBy`) decides.
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

const { mockAuth, mockQueue } = vi.hoisted(() => ({
  mockAuth: { authenticateFromRequest: vi.fn(), buildAuthContext: vi.fn(() => ({})) },
  mockQueue: { getEntry: vi.fn(), cancelEntry: vi.fn(() => true) },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/command-queue', () => mockQueue)
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))
// NOTE: '@/lib/authorization' is deliberately NOT mocked — the real matrix runs.

import { DELETE } from '@/app/api/agents/[id]/queue/[entryId]/route'
import { NextRequest } from 'next/server'

const MEMBER = 'agent-member-1'
const MANAGER = 'agent-manager-1'
const OTHER = 'agent-other-1'
const ENTRY = 'entry-abc'

function as(auth: AuthResult) {
  mockAuth.authenticateFromRequest.mockReturnValue(auth)
}

/** The queued entry that lives on `agentId`, queued by `enqueuedBy`. */
function entryQueuedBy(enqueuedBy: string | undefined, agentId: string) {
  mockQueue.getEntry.mockReturnValue({
    id: ENTRY,
    agentId,
    commandKey: 'janitor-arm',
    when: 'idle',
    enqueuedBy,
    createdAt: '2026-07-09T00:00:00.000Z',
  })
}

async function cancel(targetAgentId: string) {
  const req = new NextRequest(
    new URL(`http://localhost:23000/api/agents/${targetAgentId}/queue/${ENTRY}`),
    { method: 'DELETE' } as never,
  )
  return DELETE(req, { params: Promise.resolve({ id: targetAgentId, entryId: ENTRY }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockQueue.cancelEntry.mockReturnValue(true)
})

describe('an agent may not cancel commands queued on OTHER agents', () => {
  it('a MEMBER cancelling a MANAGER-queued command on a peer is refused (was 200)', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    entryQueuedBy(MANAGER, OTHER)
    const res = await cancel(OTHER)
    expect(res.status).toBe(403)
    expect(mockQueue.cancelEntry).not.toHaveBeenCalled()
  })

  it('a MEMBER cannot cancel even a command it queued itself onto a peer', async () => {
    // It could never have queued this in the first place — but the guard must not
    // depend on that, or a stale/forged `enqueuedBy` becomes an authorization bypass.
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    entryQueuedBy(MEMBER, OTHER)
    const res = await cancel(OTHER)
    expect(res.status).toBe(403)
    expect(mockQueue.cancelEntry).not.toHaveBeenCalled()
  })

  it('a MANAGER may cancel on any agent', async () => {
    as({ agentId: MANAGER, governanceTitle: 'manager', teamId: null })
    entryQueuedBy(MANAGER, MEMBER)
    const res = await cancel(MEMBER)
    expect(res.status).toBe(200)
    expect(mockQueue.cancelEntry).toHaveBeenCalledWith(MEMBER, ENTRY)
  })

  it('the system owner (web UI, no agentId) may cancel', async () => {
    as({})
    entryQueuedBy(MANAGER, MEMBER)
    const res = await cancel(MEMBER)
    expect(res.status).toBe(200)
  })

  it('a non-owner USER principal is refused', async () => {
    as({ userId: 'u-1', userTitle: 'user' })
    entryQueuedBy(MANAGER, MEMBER)
    const res = await cancel(MEMBER)
    expect(res.status).toBe(403)
  })
})

describe('an agent may retract its OWN command, never veto an order', () => {
  it('a MEMBER cancelling a MANAGER-queued command ON ITSELF is refused (was 200)', async () => {
    // The governance-evasion case. `send-command` alone would ALLOW this, because
    // self-target is a self-drive exemption. Ownership is what refuses it.
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    entryQueuedBy(MANAGER, MEMBER)
    const res = await cancel(MEMBER)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('queued for it by another principal'),
    })
    expect(mockQueue.cancelEntry).not.toHaveBeenCalled()
  })

  it('a MEMBER cancelling a command IT queued on itself succeeds', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    entryQueuedBy(MEMBER, MEMBER)
    const res = await cancel(MEMBER)
    expect(res.status).toBe(200)
    expect(mockQueue.cancelEntry).toHaveBeenCalledWith(MEMBER, ENTRY)
  })

  it('even a MANAGER may not cancel a USER-queued command on itself', async () => {
    // Self-target is decided by ownership for EVERY title. A MANAGER refusing the
    // human owner's order would be the same evasion wearing a better hat.
    as({ agentId: MANAGER, governanceTitle: 'manager', teamId: null })
    entryQueuedBy('user', MANAGER)
    const res = await cancel(MANAGER)
    expect(res.status).toBe(403)
  })

  it('an entry with NO enqueuedBy is not cancellable by the agent (fail closed)', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    entryQueuedBy(undefined, MEMBER)
    const res = await cancel(MEMBER)
    expect(res.status).toBe(403)
  })
})

describe('preconditions', () => {
  it('an errored auth result is refused before anything is read', async () => {
    as({ error: 'token_invalid', status: 401 })
    const res = await cancel(MEMBER)
    expect(res.status).toBe(401)
    expect(mockQueue.getEntry).not.toHaveBeenCalled()
  })

  it('a missing entry is 404 and never reaches cancelEntry', async () => {
    as({ agentId: MANAGER, governanceTitle: 'manager', teamId: null })
    mockQueue.getEntry.mockReturnValue(null)
    const res = await cancel(MEMBER)
    expect(res.status).toBe(404)
    expect(mockQueue.cancelEntry).not.toHaveBeenCalled()
  })
})

describe('static invariants', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'app', 'api', 'agents', '[id]', 'queue', '[entryId]', 'route.ts'),
    'utf-8',
  )
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the route authorizes, and does not lean on requireAuth alone', () => {
    expect(code).toMatch(/authorize\s*\(/)
    expect(code).not.toMatch(/requireAuth\s*\(/)
  })

  it('the route reads the entry before deciding — ownership needs the entry', () => {
    expect(code).toMatch(/getEntry\s*\(/)
    expect(code.indexOf('getEntry(')).toBeLessThan(code.indexOf('cancelEntry('))
  })

  it('provenance is never taken from the request body', () => {
    const enqueueSrc = fs.readFileSync(
      path.join(process.cwd(), 'app', 'api', 'agents', '[id]', 'queue', 'route.ts'),
      'utf-8',
    )
    expect(enqueueSrc).toMatch(/enqueuedBy:\s*auth\.agentId\s*\?\?\s*'user'/)
    expect(enqueueSrc).not.toMatch(/enqueuedBy:\s*body\./)
  })
})
