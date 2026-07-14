/**
 * THE VERIFIER (ai-maestro#47, ask 2) — explainPortfolioToken.
 *
 * A verifier that never fails is not a verifier. So most of this file is the
 * NEGATIVE half: every way a token can be inauthentic must produce `valid:false`
 * with a reason naming the check that failed. The positive case is one test.
 *
 * The forgery this exists to catch: before it, "the MANAGER approved this" was a
 * prose line in a git-tracked file, which anyone with repo write can type. Here
 * the same claim is a host-signed, ledger-anchored token — and the tests below
 * tamper with each of its load-bearing fields to prove the claim collapses.
 *
 * The last test is the one that keeps the other 20 honest: the GATE
 * (matchPortfolioToken) must accept EXACTLY what the verifier calls valid. Two
 * implementations of "is this token good" would drift, and drift always favors
 * the attacker.
 *
 * Isolation: os.homedir() → temp dir before the real modules load; real host
 * keypair; agent-registry stubbed so issuerStillValid sees a controllable issuer.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-verify-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

// issuerStillValid re-checks the issuer's CURRENT title via a runtime
// `require('@/lib/agent-registry')`, which vitest's resolve.alias does NOT
// rewrite. Redirect that one specifier to the shared CJS stub.
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

const SUBJECT = 'cos-agent'
const PORTFOLIO_DIR = () => path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios')

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

beforeEach(() => {
  store._resetPortfolioCacheForTests()
  ledger._resetPortfolioLedgerForTests()
  const dir = PORTFOLIO_DIR()
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
  }
  agentStub.__setAgents(DEFAULT_AGENTS)
})

afterEach(() => {
  for (const k of Object.keys(check.OPERATIONS_REQUIRING_TOKEN)) {
    delete check.OPERATIONS_REQUIRING_TOKEN[k]
  }
})

let _seq = 0
function token(over: Partial<PortfolioToken> = {}): PortfolioToken {
  _seq += 1
  const tok: PortfolioToken = {
    token_id: over.token_id ?? `tok-ver-${_seq}`,
    kind: over.kind ?? 'mandate',
    subject_agent_id: over.subject_agent_id ?? SUBJECT,
    scope: over.scope ?? 'trdd:approve',
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

/** Mint + ledger-anchor: the ONLY path that produces an authentic token. */
async function issueAnchored(over: Partial<PortfolioToken> = {}): Promise<PortfolioToken> {
  const tok = token(over)
  await store.issueToken(tok)
  const seq = await ledger.emitPortfolioOp('issue_portfolio_token', tok.token_id, ledger.issueDiff(tok))
  if (seq !== null) {
    await store.setLedgerSeq(tok.token_id, seq)
    tok.ledger_seq = seq
  }
  return tok
}

/** Re-read a token from disk, as the verify route does (never trust our copy). */
function fromDisk(tokenId: string, subject = SUBJECT): PortfolioToken {
  store._resetPortfolioCacheForTests()
  const t = store.loadPortfolio(subject).find(x => x.token_id === tokenId)
  if (!t) throw new Error(`token ${tokenId} not on disk`)
  return t
}

/**
 * Rewrite a token's record ON DISK — impersonating an attacker with filesystem
 * (or repo) write, which is exactly the adversary the `## Approval log` line
 * could not withstand.
 */
function tamperOnDisk(tokenId: string, mutate: (t: PortfolioToken) => void, subject = SUBJECT): void {
  const file = path.join(PORTFOLIO_DIR(), `${subject}.json`)
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { tokens: PortfolioToken[] }
  const t = data.tokens.find(x => x.token_id === tokenId)
  if (!t) throw new Error(`token ${tokenId} not on disk`)
  mutate(t)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  store._resetPortfolioCacheForTests()
}

describe('the authentic token', () => {
  it('VERIFIES: signature, ledger anchor, issuer title, status, expiry all pass', async () => {
    const tok = await issueAnchored({ target_trdd_id: 'K3QX9P2W' })
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { trddId: 'K3QX9P2W' })

    expect(v.valid).toBe(true)
    expect(v.reasons).toEqual([])
    expect(v.checks.signature_valid).toBe(true)
    expect(v.checks.ledger_anchored).toBe(true)
    expect(v.checks.issuer_title_current).toBe(true)
    expect(v.checks.status_active).toBe(true)
    expect(v.checks.not_expired).toBe(true)
    expect(v.checks.uses_available).toBe(true)
    expect(v.checks.binds_target).toBe(true)
  })

  it('reports WHAT the token binds, so a caller can see it rather than infer it', async () => {
    const tok = await issueAnchored({ kind: 'approval', uses_remaining: 1, scope: 'trdd:approve', target_trdd_id: 'ABCD1234' })
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { trddId: 'ABCD1234' })

    expect(v.binds.kind).toBe('approval')
    expect(v.binds.scope).toBe('trdd:approve')
    expect(v.binds.target_trdd_id).toBe('ABCD1234')
    expect(v.binds.issuer_agent_id).toBe('issuer-mgr')
    expect(v.binds.issuer_title).toBe('manager')
  })
})

describe('THE FORGERY TESTS — tampering must be refused', () => {
  it('REFUSES a token whose SCOPE was widened on disk (privilege escalation)', async () => {
    const tok = await issueAnchored({ scope: 'trdd:approve' })
    // The attacker upgrades a narrow approval into a wildcard over everything.
    tamperOnDisk(tok.token_id, t => { t.scope = '*:*' })

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.signature_valid).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/signature/i)
  })

  it('REFUSES a token re-pinned to a DIFFERENT card on disk (approval theft)', async () => {
    const tok = await issueAnchored({ target_trdd_id: 'K3QX9P2W' })
    // The attacker moves a real approval onto the card they want approved.
    tamperOnDisk(tok.token_id, t => { t.target_trdd_id = 'EVIL0000' })

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { trddId: 'EVIL0000' })
    expect(v.valid).toBe(false)
    expect(v.checks.signature_valid).toBe(false)
  })

  it('REFUSES a token whose ISSUER was rewritten on disk (authority forgery)', async () => {
    const tok = await issueAnchored({ issuer_agent_id: 'issuer-cos', issuer_title: 'chief-of-staff' })
    // "It was the MANAGER who approved it, honest."
    tamperOnDisk(tok.token_id, t => { t.issuer_title = 'manager' })

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.signature_valid).toBe(false)
  })

  it('REFUSES a token whose EXPIRY was extended on disk', async () => {
    const tok = await issueAnchored({ expires_at: new Date(Date.now() + 60_000).toISOString() })
    tamperOnDisk(tok.token_id, t => { t.expires_at = new Date(Date.now() + 10 * 365 * 24 * 3600_000).toISOString() })

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.signature_valid).toBe(false)
  })

  it('REFUSES a token INVENTED wholesale in the store, with no ledger anchor (R34)', async () => {
    // The whole record is written straight to the file — the exact move the
    // `## Approval log` line could not defend against. It has no host signature
    // it could pass, and no chained ledger entry either.
    const forged = { ...token({ token_id: 'forged-1' }), issuer_sig: 'AAAA' }
    await store.issueToken(forged)

    const v = await check.explainPortfolioToken(fromDisk('forged-1'))
    expect(v.valid).toBe(false)
    expect(v.checks.signature_valid).toBe(false)
    expect(v.checks.ledger_anchored).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/ledger anchor/i)
  })

  it('REFUSES a correctly-signed token with NO ledger anchor (signature alone is not enough)', async () => {
    // This is the subtle one: the signature is REAL (we signed it with the host
    // key), but it was never anchored. R34 says the JSON record alone is not
    // trusted — a store write that skipped the chain is still a forgery.
    await store.issueToken(token({ token_id: 'unanchored-1' }))

    const v = await check.explainPortfolioToken(fromDisk('unanchored-1'))
    expect(v.checks.signature_valid).toBe(true)
    expect(v.checks.ledger_anchored).toBe(false)
    expect(v.valid).toBe(false)
  })

  it('REFUSES a token whose ledger_seq points at an entry that does not exist', async () => {
    const tok = token({ token_id: 'bad-seq-1' })
    await store.issueToken(tok)
    await store.setLedgerSeq(tok.token_id, 9999)

    const v = await check.explainPortfolioToken(fromDisk('bad-seq-1'))
    expect(v.checks.ledger_anchored).toBe(false)
    expect(v.valid).toBe(false)
  })
})

describe('lifecycle refusals', () => {
  it('REFUSES an expired token', async () => {
    const tok = await issueAnchored({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.not_expired).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/expired/i)
  })

  it('REFUSES a revoked token', async () => {
    const tok = await issueAnchored()
    await store.revokeToken(tok.token_id)
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.status_active).toBe(false)
  })

  it('REFUSES a one-shot approval that was already consumed (no replay)', async () => {
    const tok = await issueAnchored({ kind: 'approval', uses_remaining: 1 })
    await store.consumeToken(tok.token_id)
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.uses_available === false || v.checks.status_active === false).toBe(true)
  })

  it('REFUSES a token whose issuer was DEMOTED after minting', async () => {
    const tok = await issueAnchored({ issuer_agent_id: 'issuer-mgr', issuer_title: 'manager' })
    agentStub.__setAgents([{ id: 'issuer-mgr', governanceTitle: 'member', deletedAt: null }])

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.issuer_title_current).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/no longer holds the title/i)
  })

  it('REFUSES a token whose issuer was DELETED after minting', async () => {
    const tok = await issueAnchored({ issuer_agent_id: 'issuer-mgr', issuer_title: 'manager' })
    agentStub.__setAgents([{ id: 'issuer-mgr', governanceTitle: 'manager', deletedAt: '2026-07-14T00:00:00Z' }])

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.issuer_title_current).toBe(false)
  })
})

describe('asking the SPECIFIC question (--binds)', () => {
  it('REFUSES a real approval REPLAYED onto a different card', async () => {
    // Nothing is tampered here. The token is genuine — it is just an approval for
    // SOMEONE ELSE'S card, waved at this one. This is the attack the vague question
    // ("is this token real?") passes and the specific one ("is it for THIS card?")
    // catches, and it needs no filesystem access at all.
    const tok = await issueAnchored({ target_trdd_id: 'K3QX9P2W' })

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { trddId: 'ZZZZ9999' })
    expect(v.valid).toBe(false)
    expect(v.checks.signature_valid).toBe(true)   // genuinely signed…
    expect(v.checks.ledger_anchored).toBe(true)   // …and genuinely issued…
    expect(v.checks.binds_target).toBe(false)     // …but NOT for this card.
    expect(v.reasons.join(' ')).toMatch(/pinned to TRDD-K3QX9P2W/)
  })

  it('REFUSES a card-pinned token when the caller asks about NO card at all', async () => {
    // A caller that forgets to name the card must not be told "valid" — that is
    // how a pinned token gets treated as a universal one.
    const tok = await issueAnchored({ target_trdd_id: 'K3QX9P2W' })
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    expect(v.valid).toBe(false)
    expect(v.checks.binds_target).toBe(false)
  })

  it('matches a TRDD id case-INSENSITIVELY (ids are written upper, matched either way)', async () => {
    const tok = await issueAnchored({ target_trdd_id: 'K3QX9P2W' })
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { trddId: 'k3qx9p2w' })
    expect(v.valid).toBe(true)
  })

  it('REFUSES when the required SCOPE is not satisfied', async () => {
    const tok = await issueAnchored({ scope: 'trdd:approve' })
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { scope: 'agent:create' })
    expect(v.valid).toBe(false)
    expect(v.checks.scope_satisfied).toBe(false)
  })

  it('accepts a wildcard scope (trdd:*) for a required trdd:approve', async () => {
    const tok = await issueAnchored({ scope: 'trdd:*' })
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { scope: 'trdd:approve' })
    expect(v.valid).toBe(true)
    expect(v.checks.scope_satisfied).toBe(true)
  })

  it('does not COUNT a check the caller never asked (null ≠ pass)', async () => {
    const tok = await issueAnchored({ scope: 'trdd:approve' })
    const v = await check.explainPortfolioToken(fromDisk(tok.token_id))
    // Unasked → null, and null must not be silently reported as `true`: that is
    // how a verifier stops verifying while still looking like it does.
    expect(v.checks.scope_satisfied).toBeNull()
    expect(v.checks.binds_target).toBeNull()
    expect(v.valid).toBe(true)
  })
})

describe('THE GATE AND THE VERIFIER MUST AGREE', () => {
  const cosCtx: AuthContext = {
    isSystemOwner: false,
    agentId: SUBJECT,
    governanceTitle: 'chief-of-staff',
    teamId: 'team-1',
  }

  it('the gate GRANTS exactly the token the verifier calls valid', async () => {
    check.OPERATIONS_REQUIRING_TOKEN.CreateAgent = 'agent:create'
    const tok = await issueAnchored({ scope: 'agent:create' })

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { scope: 'agent:create' })
    const m = await check.matchPortfolioToken(cosCtx, 'CreateAgent')

    expect(v.valid).toBe(true)
    expect(m.ok).toBe(true)
    expect(m.ok && m.token?.token_id).toBe(tok.token_id)
  })

  it('the gate REFUSES exactly what the verifier refuses (tampered token)', async () => {
    check.OPERATIONS_REQUIRING_TOKEN.CreateAgent = 'agent:create'
    const tok = await issueAnchored({ scope: 'agent:create' })
    tamperOnDisk(tok.token_id, t => { t.scope = '*:*' })

    const v = await check.explainPortfolioToken(fromDisk(tok.token_id), { scope: 'agent:create' })
    const m = await check.matchPortfolioToken(cosCtx, 'CreateAgent')

    // The verifier says forged; the gate must not let it through on other grounds.
    expect(v.valid).toBe(false)
    expect(m.ok).toBe(false)
  })
})
