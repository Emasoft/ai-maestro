import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'

/**
 * TRDD-ADYYHLIC — the create ROUTE: who gets a mandate, and what the caller is told.
 * The token is signed from the registry title, so the route must not write `mandate: true` on the
 * strength of a request-side title the registry does not confirm; and it must not widen authority
 * for a caller with no title on the request. The mint and the registry lookup are stubbed here —
 * they are pinned in trdd-mandate-token.test.ts; this file pins the route's own decision.
 */

let designDir: string
let ctx: Record<string, unknown>
let registryTitle: string | null
const record = vi.fn(async (..._a: unknown[]): Promise<string | null> => 'tok-1')

vi.mock('@/lib/route-auth', () => ({ requireAuth: () => ({ ok: true, context: ctx }) }))
vi.mock('@/lib/trdd-design-dir', async (orig) => ({ ...(await orig<object>()), resolveDesignDir: () => designDir }))
// The author label is not the subject here; the real helper needs a registry row.
vi.mock('@/lib/trdd-authz', async (orig) => ({ ...(await orig<object>()), trddActorIdentity: (id?: string) => (id ? 'tester#11111111-1111-4111-8111-111111111111' : 'user') }))
vi.mock('@/lib/trdd-approval-token', async (orig) => ({
  ...(await orig<object>()),
  registryTitleOf: () => registryTitle,
  recordMandateToken: (...a: unknown[]) => record(...a),
}))

beforeEach(() => {
  designDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-create-route-'))
  record.mockReset(); record.mockResolvedValue('tok-1')
})
afterEach(() => { fs.rmSync(designDir, { recursive: true, force: true }) })

async function create() {
  const { POST } = await import('@/app/api/trdd/create/route')
  const res = await POST(new NextRequest('http://localhost/api/trdd/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'a card', taskType: 'feature', minApproval: 'manager' }),
  }))
  const json = await res.json() as { file: string; zone: string; mandate: boolean; mandateToken?: string | null; mandateWarning?: string }
  if (!json.file) throw new Error(`create refused: ${res.status} ${JSON.stringify(json)}`)
  return { status: res.status, json, text: fs.readFileSync(json.file, 'utf8') }
}

describe('POST /api/trdd/create — the mandate decision', () => {
  it('request says manager, registry says manager: a mandate, and the token is recorded', async () => {
    ctx = { isSystemOwner: false, agentId: 'a1', governanceTitle: 'manager' }; registryTitle = 'manager'
    const r = await create()
    expect(r.status).toBe(201)
    expect(r.json.mandate).toBe(true)
    expect(r.text).toMatch(/^mandate: true$/m)
    expect(r.json.mandateToken).toBe('tok-1')
  })

  it('request says manager, registry says member: a PROPOSAL, with no mandate fields written', async () => {
    ctx = { isSystemOwner: false, agentId: 'a1', governanceTitle: 'manager' }; registryTitle = 'member'
    const r = await create()
    expect(r.json.mandate).toBe(false)
    expect(r.json.zone).toBe('proposals')
    expect(r.text).not.toMatch(/^mandate: true$/m)
    expect(r.text).not.toMatch(/^approved: true$/m)
  })

  it('no title on the request (an AMP-key caller), registry says manager: still a proposal — authority is not widened', async () => {
    ctx = { isSystemOwner: false, agentId: 'a1' }; registryTitle = 'manager'
    const r = await create()
    expect(r.json.mandate).toBe(false)
    expect(r.text).not.toMatch(/^mandate: true$/m)
  })

  it('an unreadable registry: a proposal, not a mandate', async () => {
    ctx = { isSystemOwner: false, agentId: 'a1', governanceTitle: 'manager' }; registryTitle = null
    expect((await create()).json.mandate).toBe(false)
  })

  it('the owner mandates without a registry row', async () => {
    ctx = { isSystemOwner: true }; registryTitle = ''
    expect((await create()).json.mandate).toBe(true)
  })

  it('a mandate that could not be given a token says so in the response', async () => {
    ctx = { isSystemOwner: false, agentId: 'a1', governanceTitle: 'manager' }; registryTitle = 'manager'
    record.mockResolvedValue(null)
    const r = await create()
    expect(r.json.mandate).toBe(true)
    expect(r.json.mandateToken).toBeNull()
    expect(r.json.mandateWarning).toMatch(/WITHOUT a mandate-token/)
  })
})
