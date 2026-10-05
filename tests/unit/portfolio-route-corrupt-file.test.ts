/**
 * The portfolio route tells the owner the truth about an unreadable portfolio file
 * (TRDD-8E6XMDEX, open item 3). A file that EXISTS but is corrupt/wrong-shape must answer a clear
 * 500 naming only the file BASENAME on every read site (GET list, GET active tokens, DELETE), never
 * an empty list and never a home path. Missing and healthy files keep their behaviour.
 *
 * The store is REAL: os.homedir() is redirected to a temp dir before it loads, so no real
 * ~/.aimaestro state is touched. Only auth, ledger and signing are stubbed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-route-corrupt-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {
    authenticateFromRequest: vi.fn(() => ({})),
    buildAuthContext: vi.fn((): { agentId?: string; isSystemOwner: boolean } => ({ isSystemOwner: true })),
  },
}))
vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/portfolio-ledger', () => ({
  emitPortfolioOp: vi.fn(() => Promise.resolve(1)),
  issueDiff: vi.fn(() => []),
  revokeDiff: vi.fn(() => []),
}))
vi.mock('@/lib/portfolio-sign', () => ({ signPortfolioToken: vi.fn(() => 'sig') }))
vi.mock('@/lib/agent-registry', () => ({ getAgent: vi.fn(() => ({ id: 'sub-route' })) }))

const SUBJECT = 'sub-route'
const DIR = path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios')
const FILE = path.join(DIR, `${SUBJECT}.json`)
const TOKEN_ID = '11111111-1111-4111-8111-111111111111'

let route: typeof import('@/app/api/agents/[id]/portfolio/route')
let store: typeof import('@/lib/portfolio-store')

beforeAll(async () => {
  store = await import('@/lib/portfolio-store')
  route = await import('@/app/api/agents/[id]/portfolio/route')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true })
  store._resetPortfolioCacheForTests()
  mockAuth.buildAuthContext.mockReturnValue({ agentId: undefined, isSystemOwner: true })
})

function writeFile(content: string): void {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(FILE, content)
}

const ctx = { params: Promise.resolve({ id: SUBJECT }) }

function req(method: string, query = ''): NextRequest {
  return new NextRequest(new URL(`http://localhost:23000/api/agents/${SUBJECT}/portfolio${query}`), { method })
}

async function expectUnreadable(res: Response): Promise<void> {
  expect(res.status).toBe(500)
  const raw = await res.text()
  const body = JSON.parse(raw)
  expect(body.error).toBe('portfolio_unreadable')
  expect(body.message).toContain(`${SUBJECT}.json`)
  expect(body.message).toMatch(/unreadable/)
  expect(body.message).toMatch(/repair or remove/)
  // Basename only: no home path, no directory, no file contents.
  expect(raw).not.toContain(TMP_HOME)
  expect(raw).not.toContain(DIR)
  expect(raw).not.toContain('SECRET-CONTENT-MARKER')
}

describe('portfolio route over an unreadable portfolio file', () => {
  it('GET as subject answers an unreadable-file 500 (loadPortfolio site)', async () => {
    mockAuth.buildAuthContext.mockReturnValue({ agentId: SUBJECT, isSystemOwner: false })
    writeFile('{ not json SECRET-CONTENT-MARKER')
    await expectUnreadable(await route.GET(req('GET'), ctx))
  })

  it('GET as system owner never answers an empty token list (findActiveTokens site)', async () => {
    writeFile(JSON.stringify({ agent_id: SUBJECT, tokens: 'SECRET-CONTENT-MARKER' }))
    const res = await route.GET(req('GET'), ctx)
    await expectUnreadable(res)
  })

  it('DELETE answers an unreadable-file 500 (loadPortfolio site)', async () => {
    writeFile('{ not json SECRET-CONTENT-MARKER')
    await expectUnreadable(await route.DELETE(req('DELETE', `?token_id=${TOKEN_ID}`), ctx))
  })
})

describe('portfolio route controls', () => {
  it('GET over a missing file answers an empty list', async () => {
    const res = await route.GET(req('GET'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).tokens).toEqual([])
  })

  it('GET over a healthy file lists its token', async () => {
    writeFile(
      JSON.stringify({
        agent_id: SUBJECT,
        updated_at: new Date().toISOString(),
        tokens: [
          {
            token_id: TOKEN_ID,
            kind: 'approval',
            subject_agent_id: SUBJECT,
            scope: 'agent:create',
            issuer_agent_id: 'issuer-mgr',
            issuer_title: 'manager',
            uses_remaining: 1,
            issued_at: new Date().toISOString(),
            expires_at: null,
            issuer_sig: 'sig-placeholder',
            ledger_seq: 0,
            status: 'active',
          },
        ],
      }),
    )
    const res = await route.GET(req('GET'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).tokens.map((t: { token_id: string }) => t.token_id)).toEqual([TOKEN_ID])
  })
})