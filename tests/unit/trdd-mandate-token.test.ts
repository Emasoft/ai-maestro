/**
 * Mandate token (TRDD-ADYYHLIC): a server-issued mandate above `none` must verify; a typed one must not.
 * Harness mirrors trdd-approval-token.test.ts (real host keys + ledger, HOME redirected to a temp dir).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-trdd-mandate-home-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, tmpdir: actual.tmpdir },
    homedir: () => TMP_HOME,
    tmpdir: actual.tmpdir,
  }
})

type AgentRow = { id: string; governanceTitle?: string; deletedAt?: string | null }
const AGENT_STUB = path.join(__dirname, '__portfolio_stubs__', 'agent-registry.cjs')
const _origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request === '@/lib/agent-registry') return AGENT_STUB
  return _origResolve.call(this, request, ...rest)
}
const agentStub = require('@/lib/agent-registry') as { __setAgents: (a: AgentRow[]) => void }

type AuthContext = import('@/lib/agent-auth').AuthContext
let tok: typeof import('@/lib/trdd-approval-token')
let create: typeof import('@/lib/trdd-create')
let store: typeof import('@/lib/portfolio-store')
let ledger: typeof import('@/lib/portfolio-ledger')
let designDir: string

const MANAGER_CTX: AuthContext = { isSystemOwner: false, agentId: 'mgr-1', governanceTitle: 'manager' }
const AUTHOR = 'user'

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  tok = await import('@/lib/trdd-approval-token')
  create = await import('@/lib/trdd-create')
  store = await import('@/lib/portfolio-store')
  ledger = await import('@/lib/portfolio-ledger')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

beforeEach(() => {
  store._resetPortfolioCacheForTests()
  ledger._resetPortfolioLedgerForTests()
  designDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-mandate-design-'))
  agentStub.__setAgents([{ id: 'mgr-1', governanceTitle: 'manager', deletedAt: null }])
})

/** The same two steps the create route runs. */
async function mint(minApproval: string) {
  const created = create.createTrdd(designDir, {
    title: 'a mandate', taskType: 'feature', minApproval, authorAuthority: 'manager', author: AUTHOR,
  })
  const token = await tok.recordMandateToken(MANAGER_CTX, created)
  return { created, token }
}
const text = (f: string) => fs.readFileSync(f, 'utf8')

describe('mandate-token on create', () => {
  it('(a) a manager mandate above none carries mandate-token and verifies', async () => {
    const { created, token } = await mint('manager')
    expect(token).toBeTruthy()
    expect(text(created.file)).toMatch(new RegExp(`^mandate-token: ${token}$`, 'm'))
    const v = await tok.verifyTrddDecision(designDir, created.id)
    expect(v!.verified).toBe(true)
    expect(v!.issuer_title).toBe('manager')
  })

  it('(b) the same card with the mandate-token line removed does not verify', async () => {
    const { created } = await mint('manager')
    fs.writeFileSync(created.file, text(created.file).replace(/^mandate-token: .*\n/m, ''))
    expect((await tok.verifyTrddDecision(designDir, created.id))!.verified).toBe(false)
  })

  it('(c) a typed mandate has no token, and a token copied from another card does not pin', async () => {
    const dir = path.join(designDir, 'tasks')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'TRDD-20260714_100000+0200-TYPED001-x.md'),
      '---\ntrdd-id: TYPED001\ntitle: x\ncolumn: backburner\nmin-approval-requirement: manager\nmandate: true\nmandated-by: manager\napproved: true\napproval-judge: amama-manager\n---\n\n# x\n')
    expect((await tok.verifyTrddDecision(designDir, 'TYPED001'))!.verified).toBe(false)

    const a = await mint('manager')
    const b = await mint('manager')
    fs.writeFileSync(b.created.file, text(b.created.file).replace(`mandate-token: ${b.token}`, `mandate-token: ${a.token}`))
    expect((await tok.verifyTrddDecision(designDir, b.created.id))!.verified).toBe(false)
  })

  it('(d) a none self-mandate gets no token and still verifies', async () => {
    const { created, token } = await mint('none')
    expect(token).toBeNull()
    expect(text(created.file)).not.toMatch(/^mandate-token:/m)
    expect((await tok.verifyTrddDecision(designDir, created.id))!.verified).toBe(true)
  })

  it('(e) a caller-supplied mandate-token is not written', async () => {
    const created = create.createTrdd(designDir, {
      title: 'a mandate', taskType: 'feature', minApproval: 'manager', authorAuthority: 'manager', author: AUTHOR,
      ...({ 'mandate-token': 'forged', mandateToken: 'forged' } as object),
    })
    expect(text(created.file)).not.toMatch(/mandate-token/)
  })

  it('a proposal (author below the floor) gets no token', async () => {
    const created = create.createTrdd(designDir, {
      title: 'a proposal', taskType: 'feature', minApproval: 'manager', authorAuthority: 'none', author: AUTHOR,
    })
    expect(await tok.recordMandateToken(MANAGER_CTX, created)).toBeNull()
    expect(text(created.file)).not.toMatch(/mandate-token/)
  })

  // The token signs the issuer's REAL title. Every non-COS agent used to be signed 'manager',
  // which the verifier's issuer check then rejected, so these issuers could never be verified.
  async function mintAs(ctx: AuthContext, authorAuthority: string, minApproval: string) {
    const created = create.createTrdd(designDir, { title: 'a mandate', taskType: 'feature', minApproval, authorAuthority, author: AUTHOR })
    return { created, token: await tok.recordMandateToken(ctx, created) }
  }

  it('an ORCHESTRATOR mandate at the orchestrator floor verifies, signed as orchestrator', async () => {
    agentStub.__setAgents([{ id: 'orch-1', governanceTitle: 'orchestrator', deletedAt: null }])
    const { created, token } = await mintAs({ isSystemOwner: false, agentId: 'orch-1', governanceTitle: 'orchestrator' }, 'orchestrator', 'orchestrator')
    expect(token).toBeTruthy()
    const v = await tok.verifyTrddDecision(designDir, created.id)
    expect(v!.issuer_title).toBe('orchestrator')
    expect(v!.verified).toBe(true)
  })

  it('an orchestrator token does not satisfy a card whose floor is later raised to manager', async () => {
    agentStub.__setAgents([{ id: 'orch-1', governanceTitle: 'orchestrator', deletedAt: null }])
    const { created } = await mintAs({ isSystemOwner: false, agentId: 'orch-1', governanceTitle: 'orchestrator' }, 'orchestrator', 'orchestrator')
    fs.writeFileSync(created.file, text(created.file).replace(/^min-approval-requirement: orchestrator$/m, 'min-approval-requirement: manager'))
    expect(text(created.file)).toMatch(/^min-approval-requirement: manager$/m)
    expect((await tok.verifyTrddDecision(designDir, created.id))!.verified).toBe(false)
  })

  it('the OWNER (no agent id, no title) mandating at the manager floor verifies, signed as user', async () => {
    const { created, token } = await mintAs({ isSystemOwner: true }, 'user', 'manager')
    expect(token).toBeTruthy()
    const v = await tok.verifyTrddDecision(designDir, created.id)
    expect(v!.issuer_title).toBe('user')
    expect(v!.verified).toBe(true)
  })

  it('an agent whose title has no rung on the approval ladder is minted nothing', async () => {
    const created = create.createTrdd(designDir, { title: 'a mandate', taskType: 'feature', minApproval: 'manager', authorAuthority: 'manager', author: AUTHOR })
    agentStub.__setAgents([{ id: 'mem-1', governanceTitle: 'member', deletedAt: null }])
    expect(await tok.recordMandateToken({ isSystemOwner: false, agentId: 'mem-1', governanceTitle: 'member' }, created)).toBeNull()
    expect(text(created.file)).not.toMatch(/^mandate-token:/m)
  })

  it('an agent with NO title on its auth context (an AMP-key caller) is signed with its REGISTRY title', async () => {
    // agentStub holds mgr-1 as manager; the context carries the id only.
    const { created, token } = await mintAs({ isSystemOwner: false, agentId: 'mgr-1' }, 'manager', 'manager')
    expect(token).toBeTruthy()
    const v = await tok.verifyTrddDecision(designDir, created.id)
    expect(v!.issuer_title).toBe('manager')
    expect(v!.verified).toBe(true)
  })

  it('a title CLAIMED on the context but absent from the registry signs nothing', async () => {
    agentStub.__setAgents([{ id: 'mem-2', governanceTitle: 'member', deletedAt: null }])
    const created = create.createTrdd(designDir, { title: 'a mandate', taskType: 'feature', minApproval: 'manager', authorAuthority: 'manager', author: AUTHOR })
    expect(await tok.recordMandateToken({ isSystemOwner: false, agentId: 'mem-2', governanceTitle: 'manager' }, created)).toBeNull()
  })
})
