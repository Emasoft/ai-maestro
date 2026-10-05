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
import { signPortfolioToken } from '@/lib/portfolio-sign'

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
  expect(body.message).toMatch(/Inspect and repair it/)
  // Basename only: no home path, no directory, no file contents.
  expect(raw).not.toContain(TMP_HOME)
  expect(raw).not.toContain(DIR)
  expect(raw).not.toContain('SECRET-CONTENT-MARKER')
}


async function postReq(): Promise<NextRequest> {
  return new NextRequest(new URL(`http://localhost:23000/api/agents/${SUBJECT}/portfolio`), {
    method: 'POST',
    body: JSON.stringify({ kind: 'approval', scope: 'agent:create' }),
    headers: { 'content-type': 'application/json' },
  })
}

const HEALTHY = JSON.stringify({ agent_id: SUBJECT, updated_at: new Date().toISOString(), tokens: [] })
const CORRUPT = '{ not json SECRET-CONTENT-MARKER'

async function snapshot(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() }
}

describe('portfolio route over an unreadable file: no oracle for unauthorized callers', () => {
  const rando = { agentId: 'rando-agent', isSystemOwner: false, governanceTitle: 'member' }

  it('GET as an unrelated agent over a corrupt file answers the same 403 as over a healthy file', async () => {
    mockAuth.buildAuthContext.mockReturnValue(rando)
    writeFile(HEALTHY)
    const healthy = await snapshot(await route.GET(req('GET'), ctx))
    store._resetPortfolioCacheForTests()
    writeFile(CORRUPT)
    const corrupt = await snapshot(await route.GET(req('GET'), ctx))
    expect(healthy.status).toBe(403)
    expect(corrupt).toEqual(healthy)
  })

  it('DELETE as a non-owner over a corrupt file answers the existing revoke 403', async () => {
    mockAuth.buildAuthContext.mockReturnValue(rando)
    writeFile(CORRUPT)
    const res = await snapshot(await route.DELETE(req('DELETE', `?token_id=${TOKEN_ID}`), ctx))
    expect(res.status).toBe(403)
    expect(res.body).toEqual({
      error: 'portfolio_revoke_forbidden',
      message: 'Only the token issuer or the system owner may revoke it.',
    })
  })

  it('POST by an unauthorized caller over a corrupt file keeps the mint refusal', async () => {
    mockAuth.buildAuthContext.mockReturnValue(rando)
    writeFile(HEALTHY)
    const healthy = await snapshot(await route.POST(await postReq(), ctx))
    store._resetPortfolioCacheForTests()
    writeFile(CORRUPT)
    const corrupt = await snapshot(await route.POST(await postReq(), ctx))
    expect(healthy.status).toBe(403)
    expect(corrupt).toEqual(healthy)
  })

  it('POST by an authorized minter over a corrupt file answers portfolio_unreadable', async () => {
    writeFile(CORRUPT)
    await expectUnreadable(await route.POST(await postReq(), ctx))
  })

  it('GET with an id outside the safe token set never reflects the id in the message', async () => {
    const res = await route.GET(
      new NextRequest(new URL('http://localhost:23000/api/agents/x/portfolio')),
      { params: Promise.resolve({ id: 'a<b>.c/d' }) },
    )
    expect(res.status).toBe(500)
    const raw = await res.text()
    expect(JSON.parse(raw).error).toBe('portfolio_unreadable')
    expect(raw).not.toContain('a<b>')
  })
})

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
describe('portfolio route: only the store fault is reported as an unreadable file', () => {
  it('the unreadable message says inspect and repair, names the basename, and does not lead with removal', async () => {
    writeFile(CORRUPT)
    const body = await (await route.GET(req('GET'), ctx)).json()
    expect(body.error).toBe('portfolio_unreadable')
    expect(body.message).toContain(`${SUBJECT}.json`)
    expect(body.message).toMatch(/inspect/i)
    expect(body.message).toMatch(/repair/i)
    expect(body.message).toMatch(/only if it cannot be repaired/)
  })

  it('a non-corruption throw from the load over a healthy file is a generic 500 and never advice to remove', async () => {
    writeFile(HEALTHY)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = vi.spyOn(fs, 'existsSync').mockImplementationOnce(() => {
      throw new Error('simulated transient fault')
    })
    try {
      const res = await route.GET(req('GET'), ctx)
      const raw = await res.text()
      expect(res.status).toBe(500)
      expect(JSON.parse(raw).error).not.toBe('portfolio_unreadable')
      expect(raw).not.toMatch(/remove/i)
      expect(raw).not.toContain('simulated transient fault')
    } finally {
      boom.mockRestore()
      quiet.mockRestore()
    }
  })

  it('POST where the file becomes corrupt between the pre-check and the mint answers portfolio_unreadable', async () => {
    writeFile(HEALTHY)
    // signPortfolioToken runs after the pre-check and before issueToken loads the file again.
    vi.mocked(signPortfolioToken).mockImplementationOnce(() => {
      writeFile(CORRUPT)
      store._resetPortfolioCacheForTests()
      return 'sig'
    })
    await expectUnreadable(await route.POST(await postReq(), ctx))
  })
})
