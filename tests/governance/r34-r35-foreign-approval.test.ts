import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/agents/foreign-approvals/[id]/approve — R34.2 + R35.2.
 *
 * Both rules are enforced by the SAME lines (route.ts:35-38), which is why one file pins
 * both. Each rule has THREE clauses, and the enforcement-map citation covers only the first
 * two — the ledger half now lives in the R51 transaction the route delegates to
 * (services/foreign-approval-service.ts, TRDD-LMAZO2ET), so it is the half a
 * citation-shaped audit cannot see:
 *
 *   R35.2 "only by the MAESTRO user via the UI"          -> enforceMaestro      (:35-36)
 *   R34.2 "requiring a sudo password from the USER (UI)" -> requireSudoToken    (:37-38)
 *   R34.2 "re-issue a NEW AID … recorded in the signed ledger and counts as a verification"
 *   R35.2 "recorded in the signed ledger (which thereafter validates the foreign AID)"
 *                                                        -> recordAidReissue +
 *                                                           recordForeignApproval
 *                                                           (foreign-approval-service G05)
 *
 * COMPLEMENTARY FIXTURES — the reason each refusal test is non-vacuous. The two gates run in
 * order, so a "no sudo token" test that also withholds the session would be refused by gate 1
 * and would pass with gate 2 DELETED, proving nothing (a bare `403` is satisfied by any
 * earlier refusal). So each test lets the OTHER gate pass, leaving exactly one thing that can
 * produce the 403 — and each neuter reddens exactly one test:
 *
 *   delete enforceMaestro   -> only "rejects a non-MAESTRO caller" reddens
 *   delete requireSudoToken -> only "rejects a MAESTRO caller without a fresh sudo token" reddens
 *
 * The staged ZIP is a REAL file in a throwaway tmpdir (the route does its own
 * existsSync/readFileSync/unlinkSync), so the payload-consumption path is exercised rather
 * than mocked away. Nothing is written to the developer's $HOME.
 */

const APPROVAL_ID = 'fa-1'
const FOREIGN_FP = 'FOREIGN-fingerprint-aaaa'
const FRESH_FP = 'FRESH-fingerprint-bbbb'
const SOURCE_HOST = 'host-remote-1'

let dir: string
let payloadPath: string

function makeReq(): NextRequest {
  return new NextRequest(`http://localhost/api/agents/foreign-approvals/${APPROVAL_ID}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aim-peer': '127.0.0.1' },
  })
}

const deny = (msg: string) => NextResponse.json({ error: msg }, { status: 403 })

/**
 * `maestro`/`sudo` select which gate REFUSES. Every other collaborator is stubbed to the
 * happy path, so the ONLY thing that can turn the request away is the gate under test.
 *
 * The stubs model a small stateful WORLD (agents array, keys map, one approval entry)
 * rather than returning constants, because the route now delegates to the R51 pipeline in
 * services/foreign-approval-service.ts, whose snapshots and success-path invariants READ
 * the stores back (loadAgents, loadKeyPair, getForeignApproval). A constant-returning mock
 * would fail those invariants and make the happy-path test assert the wrong branch.
 */
function mockDeps(opts: { maestro: 'allow' | 'deny'; sudo: 'allow' | 'deny' }) {
  const enforceMaestro = vi.fn(() => (opts.maestro === 'deny' ? deny('Forbidden — MAESTRO only') : null))
  const requireSudoToken = vi.fn(() => (opts.sudo === 'deny' ? deny('Sudo token required') : null))

  type Row = Record<string, unknown>
  const world = {
    agents: [] as Row[],
    keys: {} as Record<string, Row>,
    approval: {
      id: APPROVAL_ID,
      kind: 'agent',
      status: 'pending',
      fingerprint: FOREIGN_FP,
      sourceHostId: SOURCE_HOST,
      displayName: 'imported-bot',
      importPayloadPath: payloadPath,
    } as Row,
  }

  const importAgent = vi.fn(async () => {
    world.agents.push({ id: 'agent-local-new', name: 'imported-bot', metadata: {} })
    return {
      status: 200,
      data: { success: true, agent: { id: 'agent-local-new', name: 'imported-bot' }, warnings: [] },
    }
  })
  const generateKeyPair = vi.fn(async () => ({ fingerprint: FRESH_FP, publicKey: 'pub', privateKey: 'priv' }))
  const saveKeyPair = vi.fn((agentId: string, kp: Row) => { world.keys[agentId] = kp })
  const loadKeyPair = vi.fn((agentId: string) => world.keys[agentId] ?? null)
  const deleteKeyPair = vi.fn((agentId: string) => { delete world.keys[agentId]; return true })
  const markAgentAsAMPRegistered = vi.fn(async (agentId: string, ampData: { fingerprint: string }) => {
    const row = world.agents.find(a => a.id === agentId)
    if (!row) return null
    row.ampRegistered = true
    row.metadata = { ...(row.metadata as Row), amp: { fingerprint: ampData.fingerprint } }
    return row
  })
  const loadAgents = vi.fn(() => world.agents)
  const saveAgents = vi.fn((agents: Row[]) => { world.agents = agents; return true })
  const getForeignApproval = vi.fn(() => world.approval)
  const updateForeignApproval = vi.fn((_id: string, patch: Row) => {
    Object.assign(world.approval, patch)
    return world.approval
  })
  const recordAidReissue = vi.fn()
  const recordForeignApproval = vi.fn()
  const recordAidRevocation = vi.fn()

  vi.doMock('@/lib/route-auth', () => ({ enforceMaestro }))
  vi.doMock('@/lib/sudo-guard', () => ({ requireSudoToken }))
  vi.doMock('@/lib/foreign-approval-registry', () => ({ getForeignApproval, updateForeignApproval }))
  vi.doMock('@/services/agents-transfer-service', () => ({ importAgent }))
  vi.doMock('@/lib/amp-keys', () => ({ generateKeyPair, saveKeyPair, loadKeyPair, deleteKeyPair }))
  vi.doMock('@/lib/agent-registry', () => ({ markAgentAsAMPRegistered, loadAgents, saveAgents }))
  vi.doMock('@/lib/aid-ledger-authority', () => ({ recordAidReissue, recordForeignApproval, recordAidRevocation }))

  return {
    enforceMaestro, requireSudoToken, importAgent, saveKeyPair,
    recordAidReissue, recordForeignApproval, updateForeignApproval, recordAidRevocation,
    world,
  }
}

async function callRoute(): Promise<NextResponse> {
  const mod = await import('@/app/api/agents/foreign-approvals/[id]/approve/route')
  const res = await mod.POST(makeReq(), { params: Promise.resolve({ id: APPROVAL_ID }) })
  // Narrowing that is itself an assertion: a route handler must ALWAYS answer. A nullish
  // return would mean the request fell through every branch — worth failing loudly on
  // rather than casting away, since a silent no-answer is the shape of an unenforced gate.
  expect(res, 'the route returned no response at all').toBeTruthy()
  return res as NextResponse
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-foreign-approve-'))
  payloadPath = join(dir, 'staged-export.zip')
  writeFileSync(payloadPath, 'PK not-a-real-zip — importAgent is stubbed')
  vi.resetModules()
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('R35.2 — approval is the MAESTRO user\'s alone (route.ts:35-36)', () => {
  it('rejects a non-MAESTRO caller, and refuses BEFORE consuming the staged payload', async () => {
    // sudo ALLOWS here, so a 403 can only have come from the MAESTRO gate.
    const m = mockDeps({ maestro: 'deny', sudo: 'allow' })
    const res = await callRoute()

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'Forbidden — MAESTRO only' })

    // The refusal is a REFUSAL, not merely a status: nothing downstream ran.
    expect(m.importAgent).not.toHaveBeenCalled()
    expect(m.recordAidReissue).not.toHaveBeenCalled()
    expect(m.recordForeignApproval).not.toHaveBeenCalled()
    expect(m.updateForeignApproval).not.toHaveBeenCalled()
    // The staged ZIP survives — a denied approval must not consume it.
    expect(existsSync(payloadPath)).toBe(true)
  })
})

describe('R34.2 — a fresh sudo password is required (route.ts:37-38)', () => {
  it('rejects a MAESTRO caller without a fresh sudo token', async () => {
    // MAESTRO ALLOWS here, so a 403 can only have come from the sudo gate.
    const m = mockDeps({ maestro: 'allow', sudo: 'deny' })
    const res = await callRoute()

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'Sudo token required' })

    // Proves we got PAST gate 1 — without this the test would pass on gate 1's refusal.
    expect(m.enforceMaestro).toHaveBeenCalledTimes(1)
    expect(m.importAgent).not.toHaveBeenCalled()
    expect(m.recordAidReissue).not.toHaveBeenCalled()
    expect(existsSync(payloadPath)).toBe(true)
  })
})

describe('R34.2 + R35.2 — the approval re-issues a NEW AID and records it in the signed ledger', () => {
  it('with both gates satisfied, issues a fresh fingerprint and writes BOTH ledger ops', async () => {
    const m = mockDeps({ maestro: 'allow', sudo: 'allow' })
    const res = await callRoute()

    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(200)

    // R34.2 "re-issue a NEW AID" — the fingerprint the host trusts is NOT the foreign one.
    // This is the impersonation defense: the foreign fp never becomes a local identity.
    expect(body.newFingerprint).toBe(FRESH_FP)
    expect(body.newFingerprint).not.toBe(FOREIGN_FP)
    expect(m.saveKeyPair).toHaveBeenCalledWith('agent-local-new', expect.objectContaining({ fingerprint: FRESH_FP }))

    // R34.2 "recorded … counts as a verification" + R35.2 "recorded in the signed ledger":
    // BOTH ops, and the reissue must name old -> new so the old fp is provably retired.
    expect(m.recordAidReissue).toHaveBeenCalledWith(
      'agent-local-new', FOREIGN_FP, FRESH_FP, SOURCE_HOST, 'user',
    )
    expect(m.recordForeignApproval).toHaveBeenCalledWith(
      FRESH_FP, 'agent', SOURCE_HOST, 'system-owner', 'user',
    )

    // The staged ZIP is consumed exactly once — a replayed approval finds nothing to import.
    expect(existsSync(payloadPath)).toBe(false)
    expect(m.updateForeignApproval).toHaveBeenCalledWith(
      APPROVAL_ID,
      expect.objectContaining({ status: 'approved', newFingerprint: FRESH_FP }),
    )
    // A clean run emits NO compensating revoke — the revoke is the rollback's
    // signature, so its presence here would mean a gate silently failed.
    expect(m.recordAidRevocation).not.toHaveBeenCalled()
  })
})
