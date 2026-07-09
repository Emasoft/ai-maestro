/**
 * SECURITY REGRESSION — mutating an agent's email address book is authorized.
 *
 * `PATCH`/`DELETE /api/agents/[id]/email/addresses/[address]` carried
 * `enforceAuth` alone, which authenticates and DISCARDS the identity. Any agent
 * could rewrite or delete any other agent's addresses.
 *
 * This was an oversight, not a policy gap: its three siblings —
 * `email/addresses` POST, `amp/addresses` POST, and `amp/addresses/[address]`
 * PATCH+DELETE — all already authorize with `modify-agent`. This route was the
 * odd one out. Matching them introduces no new semantics.
 *
 * `modify-agent` is NOT a self-drive action, so an agent may not rewrite its own
 * address book either — which is exactly how the three siblings already behave.
 * Every `expect(403)` below returned 200 against the old handler.
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

const { mockAuth, mockSvc } = vi.hoisted(() => ({
  mockAuth: { authenticateFromRequest: vi.fn() },
  mockSvc: {
    getEmailAddressDetail: vi.fn(() => Promise.resolve({ data: {} })),
    updateEmailAddressOnAgent: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    removeEmailAddressFromAgent: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/services/agents-messaging-service', () => mockSvc)
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))
// '@/lib/authorization' is NOT mocked — the real matrix decides.

import { PATCH, DELETE } from '@/app/api/agents/[id]/email/addresses/[address]/route'
import { NextRequest } from 'next/server'

const MEMBER = 'agent-member-1'
const MANAGER = 'agent-manager-1'
const TARGET = 'agent-target-1'
const ADDR = 'bot@team.local'

function as(auth: AuthResult) {
  mockAuth.authenticateFromRequest.mockReturnValue(auth)
}

function req(target: string, method: string) {
  return new NextRequest(
    new URL(`http://localhost:23000/api/agents/${target}/email/addresses/${ADDR}`),
    { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ primary: true }) } as never,
  )
}

const params = (target: string) => ({ params: { id: target, address: ADDR } as never })

beforeEach(() => vi.clearAllMocks())

describe('PATCH — rewriting an address book', () => {
  it('a MEMBER rewriting a peer\'s address is refused (was 200)', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    const res = await PATCH(req(TARGET, 'PATCH'), params(TARGET))
    expect(res.status).toBe(403)
    expect(mockSvc.updateEmailAddressOnAgent).not.toHaveBeenCalled()
  })

  it('an agent may not rewrite its OWN address book — modify-agent is not self-drive', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    const res = await PATCH(req(MEMBER, 'PATCH'), params(MEMBER))
    expect(res.status).toBe(403)
  })

  it('a MANAGER may', async () => {
    as({ agentId: MANAGER, governanceTitle: 'manager', teamId: null })
    const res = await PATCH(req(TARGET, 'PATCH'), params(TARGET))
    expect(res.status).toBe(200)
    expect(mockSvc.updateEmailAddressOnAgent).toHaveBeenCalled()
  })

  it('the system owner (dashboard) is unaffected', async () => {
    as({})
    const res = await PATCH(req(TARGET, 'PATCH'), params(TARGET))
    expect(res.status).toBe(200)
  })
})

describe('DELETE — removing an address', () => {
  it('a MEMBER deleting a peer\'s address is refused (was 200)', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    const res = await DELETE(req(TARGET, 'DELETE'), params(TARGET))
    expect(res.status).toBe(403)
    expect(mockSvc.removeEmailAddressFromAgent).not.toHaveBeenCalled()
  })

  it('a MANAGER may', async () => {
    as({ agentId: MANAGER, governanceTitle: 'manager', teamId: null })
    const res = await DELETE(req(TARGET, 'DELETE'), params(TARGET))
    expect(res.status).toBe(200)
  })

  it('an errored auth result is refused before the service is touched', async () => {
    as({ error: 'token_invalid', status: 401 })
    const res = await DELETE(req(TARGET, 'DELETE'), params(TARGET))
    expect(res.status).toBe(401)
    expect(mockSvc.removeEmailAddressFromAgent).not.toHaveBeenCalled()
  })
})

describe('static invariants', () => {
  const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf-8')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const base = ['app', 'api', 'agents', '[id]']

  it('the route no longer relies on enforceAuth', () => {
    const code = strip(read(...base, 'email', 'addresses', '[address]', 'route.ts'))
    expect(code).not.toMatch(/enforceAuth/)
    expect(code).toContain("authorize(auth, 'modify-agent', id)")
  })

  it('all four address routes agree on the SAME action — no split-brain', () => {
    const files = [
      [...base, 'email', 'addresses', 'route.ts'],
      [...base, 'email', 'addresses', '[address]', 'route.ts'],
      [...base, 'amp', 'addresses', 'route.ts'],
      [...base, 'amp', 'addresses', '[address]', 'route.ts'],
    ]
    for (const f of files) {
      expect(strip(read(...f))).toContain("authorize(auth, 'modify-agent', id)")
    }
  })
})
