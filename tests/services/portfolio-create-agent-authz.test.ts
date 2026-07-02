/**
 * Portfolio authorization INTEGRATION (R28 / R29 / R30 / R34) — the full
 * mandate/approval lifecycle exactly as the CreateAgent G01e gate + the
 * consume-after-success tail (and the createNewTeam mirror) drive it.
 *
 * Rather than mock the ~20 unrelated CreateAgent pipeline dependencies (a
 * brittle approach that would break on any pipeline edit), this wires the REAL
 * portfolio subsystem end-to-end — issue-guard → sign → store → ledger →
 * matchPortfolioToken → consume — under a temp HOME with a real host keypair.
 * It is the authoritative authz flow the pipelines invoke:
 *
 *   COS CreateAgent DENIED without a mandate
 *     → MANAGER mints an `agent:create` mandate (R30.1)
 *     → matchPortfolioToken GRANTS (and returns the token, as G01e threads it)
 *   COS one-shot APPROVAL: granted once → consumed after success → second
 *     attempt DENIED (the one-shot is burned).
 *
 * os.homedir() is mocked to a temp dir before the modules load; agent-registry
 * is mocked so issuerStillValid sees a live MANAGER/COS issuer.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-authz-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

// portfolio-check (issuerStillValid) and portfolio-issue-guard (isAgentInTeam)
// reach the registries via runtime `require('@/lib/...')`, which vitest's
// resolve.alias does NOT rewrite. Redirect those two specifiers to CJS stubs
// (see the stub headers) so the REAL subsystem runs against controllable
// registry data.
// __dirname = tests/services; the shared stubs live in tests/unit/__portfolio_stubs__.
const STUB_DIR = path.resolve(__dirname, '..', 'unit', '__portfolio_stubs__')
const AGENT_STUB = path.join(STUB_DIR, 'agent-registry.cjs')
const TEAM_STUB = path.join(STUB_DIR, 'team-registry.cjs')
const _origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request === '@/lib/agent-registry') return AGENT_STUB
  if (request === '@/lib/team-registry') return TEAM_STUB
  return _origResolve.call(this, request, ...rest)
}
const agentStub = require('@/lib/agent-registry') as {
  __setAgents: (a: Array<{ id: string; governanceTitle?: string; deletedAt?: string | null }>) => void
}
const teamStub = require('@/lib/team-registry') as {
  __setTeams: (t: Array<{ id: string; agentIds: string[] }>) => void
}

type CheckModule = typeof import('@/lib/portfolio-check')
type StoreModule = typeof import('@/lib/portfolio-store')
type LedgerModule = typeof import('@/lib/portfolio-ledger')
type SignModule = typeof import('@/lib/portfolio-sign')
type GuardModule = typeof import('@/lib/portfolio-issue-guard')
type PortfolioToken = import('@/types/portfolio').PortfolioToken
type AuthContext = import('@/lib/agent-auth').AuthContext

let check: CheckModule
let store: StoreModule
let ledger: LedgerModule
let sign: SignModule
let guard: GuardModule

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  check = await import('@/lib/portfolio-check')
  store = await import('@/lib/portfolio-store')
  ledger = await import('@/lib/portfolio-ledger')
  sign = await import('@/lib/portfolio-sign')
  guard = await import('@/lib/portfolio-issue-guard')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

function wipeDisk() {
  const dir = path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
  }
}

beforeEach(() => {
  store._resetPortfolioCacheForTests()
  ledger._resetPortfolioLedgerForTests()
  wipeDisk()
  // Seed the registry stubs: a live MANAGER + COS issuer, and a team whose
  // membership the COS-mint own-team check consults.
  agentStub.__setAgents([
    { id: 'mgr-1', governanceTitle: 'manager', deletedAt: null },
    { id: 'cos-1', governanceTitle: 'chief-of-staff', deletedAt: null },
  ])
  teamStub.__setTeams([{ id: 'team-1', agentIds: ['cos-1', 'newhire-target'] }])
  // The pipelines gate CreateAgent on 'agent:create'.
  check.OPERATIONS_REQUIRING_TOKEN.CreateAgent = 'agent:create'
})

afterEach(() => {
  for (const k of Object.keys(check.OPERATIONS_REQUIRING_TOKEN)) {
    delete check.OPERATIONS_REQUIRING_TOKEN[k]
  }
})

/**
 * Mint a token the way the POST /portfolio route does: canIssue → sign →
 * issueToken → emitPortfolioOp(issue) → setLedgerSeq. Returns the anchored
 * token id.
 */
async function mint(
  issuerCtx: AuthContext,
  body: { kind: PortfolioToken['kind']; scope: string; subject_agent_id: string; target_agent_id?: string; uses_remaining?: number | null },
): Promise<string> {
  const decision = guard.canIssue(issuerCtx, {
    kind: body.kind,
    scope: body.scope,
    subject_agent_id: body.subject_agent_id,
    target_agent_id: body.target_agent_id,
  })
  if (!decision.ok) throw new Error(`canIssue refused: ${decision.reason}`)

  const now = new Date()
  const token: PortfolioToken = {
    token_id: `mint-${Math.random().toString(36).slice(2, 10)}`,
    kind: body.kind,
    subject_agent_id: body.subject_agent_id,
    scope: body.scope,
    ...(body.target_agent_id ? { target_agent_id: body.target_agent_id } : {}),
    issuer_agent_id: issuerCtx.agentId ?? 'system-owner',
    issuer_title: (issuerCtx.governanceTitle || '').toLowerCase() === 'chief-of-staff' ? 'chief-of-staff' : 'manager',
    ...(issuerCtx.teamId ? { issuer_team_id: issuerCtx.teamId } : {}),
    uses_remaining: body.kind === 'approval' ? (body.uses_remaining ?? 1) : null,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 3600_000).toISOString(),
    issuer_sig: '',
    ledger_seq: null,
    status: 'active',
  }
  token.issuer_sig = sign.signPortfolioToken(token)
  await store.issueToken(token)
  const seq = await ledger.emitPortfolioOp('issue_portfolio_token', token.token_id, ledger.issueDiff(token))
  if (seq === null) throw new Error('ledger anchor failed')
  await store.setLedgerSeq(token.token_id, seq)
  return token.token_id
}

/** Reproduces the CreateAgent G01e + consume-after-success tail. */
async function createAgentGate(ctx: AuthContext, target?: { agentId?: string }): Promise<{ ok: boolean; reason?: string }> {
  // G01e
  const m = await check.matchPortfolioToken(ctx, 'CreateAgent', target)
  if (!m.ok) return { ok: false, reason: m.reason }
  const matchedId = m.token?.token_id ?? null
  // ... (pipeline does the real CreateAgent side effects here) ...
  // consume-after-success
  if (matchedId) {
    const tok = store.getTokenById(matchedId)
    const consumed = await store.consumeToken(matchedId)
    if (consumed && tok) {
      void ledger.emitPortfolioOp('consume_portfolio_token', tok.token_id, ledger.consumeDiff(tok, (tok.uses_remaining ?? 1) - 1))
    }
  }
  return { ok: true }
}

const cosCtx: AuthContext = { isSystemOwner: false, agentId: 'cos-1', governanceTitle: 'chief-of-staff', teamId: 'team-1' }
const mgrCtx: AuthContext = { isSystemOwner: false, agentId: 'mgr-1', governanceTitle: 'manager' }

describe('CreateAgent mandate lifecycle (R30.1)', () => {
  it('COS is DENIED CreateAgent without a mandate', async () => {
    const r = await createAgentGate(cosCtx)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/agent:create/)
  })

  it('after the MANAGER mints an agent:create MANDATE, the COS is GRANTED — repeatedly (mandate is not consumed)', async () => {
    await mint(mgrCtx, { kind: 'mandate', scope: 'agent:create', subject_agent_id: 'cos-1' })
    expect((await createAgentGate(cosCtx)).ok).toBe(true)
    // A mandate is not one-shot — a second CreateAgent still passes.
    expect((await createAgentGate(cosCtx)).ok).toBe(true)
  })

  it('a COS may NOT mint an APPROVAL (mandate-only) — canIssue refuses (R30.3)', async () => {
    // mint() runs the REAL canIssue; a COS minting an approval is refused, which
    // the helper surfaces as a throw.
    await expect(
      mint(cosCtx, { kind: 'approval', scope: 'agent:create', subject_agent_id: 'newhire-target' }),
    ).rejects.toThrow(/CHIEF-OF-STAFF may mint only mandate/)
  })
})

describe('CreateAgent one-shot approval lifecycle (R28 §4.3)', () => {
  it('a one-shot approval is granted once, consumed after success, then DENIED on the second attempt', async () => {
    // MANAGER grants the COS a single-use approval.
    await mint(mgrCtx, { kind: 'approval', scope: 'agent:create', subject_agent_id: 'cos-1', uses_remaining: 1 })

    // First CreateAgent — granted, and the consume tail burns the approval.
    const first = await createAgentGate(cosCtx)
    expect(first.ok).toBe(true)

    // The store reflects the consumption.
    expect(store.findActiveTokens('cos-1')).toHaveLength(0)

    // Second CreateAgent — DENIED (the one-shot is gone).
    const second = await createAgentGate(cosCtx)
    expect(second.ok).toBe(false)
  })

  it('an approval pinned to a target agent only authorizes that target', async () => {
    await mint(mgrCtx, { kind: 'approval', scope: 'agent:create', subject_agent_id: 'cos-1', target_agent_id: 'newhire-target', uses_remaining: 1 })
    // Wrong target → denied.
    expect((await createAgentGate(cosCtx, { agentId: 'someone-else' })).ok).toBe(false)
    // Right target → granted.
    expect((await createAgentGate(cosCtx, { agentId: 'newhire-target' })).ok).toBe(true)
  })
})
