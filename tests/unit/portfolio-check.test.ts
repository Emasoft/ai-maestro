/**
 * Portfolio check tests (R28 check #3) — checkPortfolioToken / matchPortfolioToken.
 *
 * The verifier wires together the real store, sign, ledger, and an
 * issuer-title re-check (agent-registry). Covers all the spec cases:
 *  - op NOT in OPERATIONS_REQUIRING_TOKEN → null (the D2 empty-map no-op)
 *  - system-owner bypass / MANAGER bypass / no-agentId bypass
 *  - COS WITH a valid ledger-anchored mandate → null (+ token returned)
 *  - COS WITHOUT a mandate → denied
 *  - expired token → denied; revoked token → denied
 *  - target-agent / target-team mismatch → denied
 *  - ledger-UNANCHORED token (ledger_seq=null OR no real issue entry) → denied (R34)
 *  - scope wildcard (agent:*) satisfies a required agent:create
 *
 * Isolation: os.homedir() → temp dir before the real modules load; real host
 * keypair; agent-registry mocked so issuerStillValid sees a live MANAGER issuer.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-check-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

// issuerStillValid re-checks the issuer's CURRENT title via a runtime
// `require('@/lib/agent-registry')`, which vitest's resolve.alias does NOT
// rewrite. Redirect that one specifier to a CJS stub (see its header) so the
// real verifier runs against a controllable issuer table. __setAgents drives it.
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
const DEFAULT_AGENTS: AgentRow[] = [
  { id: 'issuer-mgr', governanceTitle: 'manager', deletedAt: null },
  { id: 'issuer-cos', governanceTitle: 'chief-of-staff', deletedAt: null },
]

type CheckModule = typeof import('@/lib/portfolio-check')
type StoreModule = typeof import('@/lib/portfolio-store')
type LedgerModule = typeof import('@/lib/portfolio-ledger')
type SignModule = typeof import('@/lib/portfolio-sign')
type PortfolioToken = import('@/types/portfolio').PortfolioToken
type AuthContext = import('@/lib/agent-auth').AuthContext

let check: CheckModule
let store: StoreModule
let ledger: LedgerModule
let sign: SignModule

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  check = await import('@/lib/portfolio-check')
  store = await import('@/lib/portfolio-store')
  ledger = await import('@/lib/portfolio-ledger')
  sign = await import('@/lib/portfolio-sign')
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
  agentStub.__setAgents(DEFAULT_AGENTS) // live MANAGER + COS issuers by default
})

afterEach(() => {
  // Restore the empty map so the no-op default is never leaked between tests.
  for (const k of Object.keys(check.OPERATIONS_REQUIRING_TOKEN)) {
    delete check.OPERATIONS_REQUIRING_TOKEN[k]
  }
})

function enable(op: string, scope: string) {
  check.OPERATIONS_REQUIRING_TOKEN[op] = scope
}

let _seq = 0
function token(over: Partial<PortfolioToken> = {}): PortfolioToken {
  _seq += 1
  const tok: PortfolioToken = {
    token_id: over.token_id ?? `tok-chk-${_seq}`,
    kind: over.kind ?? 'mandate',
    subject_agent_id: over.subject_agent_id ?? 'cos-agent',
    scope: over.scope ?? 'agent:create',
    issuer_agent_id: over.issuer_agent_id ?? 'issuer-mgr',
    issuer_title: over.issuer_title ?? 'manager',
    uses_remaining: over.uses_remaining ?? null,
    issued_at: over.issued_at ?? new Date().toISOString(),
    expires_at: over.expires_at ?? null,
    issuer_sig: '',
    ledger_seq: null,
    status: over.status ?? 'active',
    ...over,
  }
  tok.issuer_sig = sign.signPortfolioToken(tok)
  return tok
}

/** Issue a token AND properly ledger-anchor it (the happy R34 path). */
async function issueAnchored(over: Partial<PortfolioToken> = {}): Promise<PortfolioToken> {
  const tok = token(over)
  await store.issueToken(tok)
  const seq = await ledger.emitPortfolioOp('issue_portfolio_token', tok.token_id, ledger.issueDiff(tok))
  if (seq !== null) await store.setLedgerSeq(tok.token_id, seq)
  return tok
}

const cosCtx: AuthContext = { isSystemOwner: false, agentId: 'cos-agent', governanceTitle: 'chief-of-staff', teamId: 'team-1' }

describe('no-op / bypass cases', () => {
  it('returns null when the operation is NOT gated (empty-map default)', async () => {
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent')).toBeNull()
  })

  it('system-owner bypasses even a gated op', async () => {
    enable('CreateAgent', 'agent:create')
    const sysCtx: AuthContext = { isSystemOwner: true }
    expect(await check.checkPortfolioToken(sysCtx, 'CreateAgent')).toBeNull()
  })

  it('a caller with no agentId bypasses (defence-in-depth)', async () => {
    enable('CreateAgent', 'agent:create')
    expect(await check.checkPortfolioToken({ isSystemOwner: false }, 'CreateAgent')).toBeNull()
  })

  it('MANAGER bypasses (self-empowerment for its own R29 authority)', async () => {
    enable('CreateAgent', 'agent:create')
    const mgr: AuthContext = { isSystemOwner: false, agentId: 'issuer-mgr', governanceTitle: 'manager' }
    expect(await check.checkPortfolioToken(mgr, 'CreateAgent')).toBeNull()
  })
})

describe('delegated caller (COS) — gated op', () => {
  it('GRANTS when a valid, ledger-anchored mandate exists (and returns the token)', async () => {
    enable('CreateAgent', 'agent:create')
    const tok = await issueAnchored({ subject_agent_id: 'cos-agent', scope: 'agent:create' })
    const m = await check.matchPortfolioToken(cosCtx, 'CreateAgent')
    expect(m.ok).toBe(true)
    expect(m.ok && m.token?.token_id).toBe(tok.token_id)
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent')).toBeNull()
  })

  it('DENIES when the COS holds no token at all', async () => {
    enable('CreateAgent', 'agent:create')
    const reason = await check.checkPortfolioToken(cosCtx, 'CreateAgent')
    expect(reason).toBeTruthy()
    expect(reason).toMatch(/agent:create/)
  })

  it('a scope WILDCARD (agent:*) satisfies the required agent:create', async () => {
    enable('CreateAgent', 'agent:create')
    await issueAnchored({ subject_agent_id: 'cos-agent', scope: 'agent:*' })
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent')).toBeNull()
  })
})

describe('token state denials', () => {
  it('DENIES an expired token', async () => {
    enable('CreateAgent', 'agent:create')
    // findActiveTokens filters expired tokens out → no satisfying token.
    await issueAnchored({ subject_agent_id: 'cos-agent', expires_at: new Date(Date.now() - 60_000).toISOString() })
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent')).toBeTruthy()
  })

  it('DENIES a revoked token', async () => {
    enable('CreateAgent', 'agent:create')
    const tok = await issueAnchored({ subject_agent_id: 'cos-agent' })
    await store.revokeToken(tok.token_id)
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent')).toBeTruthy()
  })
})

describe('target pinning', () => {
  it('DENIES when a target_agent_id pin does not match', async () => {
    enable('CreateAgent', 'agent:create')
    await issueAnchored({ subject_agent_id: 'cos-agent', kind: 'approval', uses_remaining: 1, target_agent_id: 'only-this-one' })
    const reason = await check.checkPortfolioToken(cosCtx, 'CreateAgent', { agentId: 'someone-else' })
    expect(reason).toBeTruthy()
  })

  it('GRANTS when the target_agent_id pin matches', async () => {
    enable('CreateAgent', 'agent:create')
    await issueAnchored({ subject_agent_id: 'cos-agent', kind: 'approval', uses_remaining: 1, target_agent_id: 'pinned' })
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent', { agentId: 'pinned' })).toBeNull()
  })

  it('DENIES when a target_team_id pin does not match', async () => {
    enable('CreateTeam', 'team:create')
    await issueAnchored({ subject_agent_id: 'cos-agent', scope: 'team:create', target_team_id: 'team-A' })
    expect(await check.checkPortfolioToken(cosCtx, 'CreateTeam', { teamId: 'team-B' })).toBeTruthy()
  })
})

describe('R34 ledger-anchor anti-forgery', () => {
  it('DENIES a token written straight to the file with NO ledger anchor (ledger_seq null)', async () => {
    enable('CreateAgent', 'agent:create')
    // Issue to the store WITHOUT emitting a ledger entry → ledger_seq stays null.
    await store.issueToken(token({ subject_agent_id: 'cos-agent', token_id: 'forged-no-anchor' }))
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent')).toBeTruthy()
  })

  it('DENIES a token whose ledger_seq points at a non-existent issue entry', async () => {
    enable('CreateAgent', 'agent:create')
    // Fabricate a seq that has no matching issue entry in the (empty) chain.
    const tok = token({ subject_agent_id: 'cos-agent', token_id: 'forged-bad-seq' })
    await store.issueToken(tok)
    await store.setLedgerSeq(tok.token_id, 12345) // no such entry in the ledger
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent')).toBeTruthy()
  })
})

describe('issuer-still-valid re-check', () => {
  it('DENIES a token whose issuer is no longer the recorded title (demoted)', async () => {
    enable('CreateAgent', 'agent:create')
    // Mint while the issuer is a manager, then DEMOTE it: issuerStillValid must
    // refuse the now-stale token even though the revoke sweep never ran.
    await issueAnchored({ subject_agent_id: 'cos-agent', issuer_agent_id: 'issuer-mgr', issuer_title: 'manager' })
    agentStub.__setAgents([{ id: 'issuer-mgr', governanceTitle: 'member', deletedAt: null }])
    expect(await check.checkPortfolioToken(cosCtx, 'CreateAgent')).toBeTruthy()
  })
})
