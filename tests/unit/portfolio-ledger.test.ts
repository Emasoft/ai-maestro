/**
 * Portfolio ledger tests (R28 / R33 / R34) — the dedicated host-signed chain.
 *
 * Covers: emitPortfolioOp returns a monotonically-increasing seq; ledgerHasIssue
 * binds seq↔tokenId to a real issue entry (R34) and rejects a wrong seq / a
 * consume entry; reconstructPortfoliosFromLedger replays issue−consume−revoke−
 * expiry to rebuild the live store; the portfolio ledger verifies under the
 * host key.
 *
 * Isolation: os.homedir() is mocked to a temp dir before the ledger + store +
 * host-keys modules load, so the chain (portfolios.ledger.json) and the files
 * live under the temp HOME, signed by a throwaway host keypair.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-ledger-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

type LedgerModule = typeof import('@/lib/portfolio-ledger')
type StoreModule = typeof import('@/lib/portfolio-store')
type SignModule = typeof import('@/lib/portfolio-sign')
type PortfolioToken = import('@/types/portfolio').PortfolioToken
let ledger: LedgerModule
let store: StoreModule
let sign: SignModule

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  ledger = await import('@/lib/portfolio-ledger')
  store = await import('@/lib/portfolio-store')
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

let _seq = 0
function makeSignedToken(over: Partial<PortfolioToken> = {}): PortfolioToken {
  _seq += 1
  const tok: PortfolioToken = {
    token_id: over.token_id ?? `tok-led-${_seq}`,
    kind: over.kind ?? 'approval',
    subject_agent_id: over.subject_agent_id ?? 'led-subject',
    scope: over.scope ?? 'agent:create',
    issuer_agent_id: over.issuer_agent_id ?? 'issuer-mgr',
    issuer_title: over.issuer_title ?? 'manager',
    uses_remaining: over.uses_remaining ?? 1,
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

beforeEach(() => {
  // Drop the ledger singleton AND the store cache, AND wipe disk, so each test
  // sees a fresh empty chain + empty files.
  ledger._resetPortfolioLedgerForTests()
  store._resetPortfolioCacheForTests()
  wipeDisk()
})

describe('emitPortfolioOp', () => {
  it('returns a monotonically-increasing seq across appends', async () => {
    const s0 = await ledger.emitPortfolioOp('issue_portfolio_token', 't0', ledger.issueDiff(makeSignedToken({ token_id: 't0' })))
    const s1 = await ledger.emitPortfolioOp('issue_portfolio_token', 't1', ledger.issueDiff(makeSignedToken({ token_id: 't1' })))
    expect(s0).toBe(0)
    expect(s1).toBe(1)
  })
})

describe('ledgerHasIssue (R34 anchor)', () => {
  it('resolves true for a real issue entry bound to its token id + seq', async () => {
    const tok = makeSignedToken({ token_id: 'anchored' })
    const seq = await ledger.emitPortfolioOp('issue_portfolio_token', tok.token_id, ledger.issueDiff(tok))
    expect(seq).not.toBeNull()
    expect(await ledger.ledgerHasIssue('anchored', seq as number)).toBe(true)
  })

  it('rejects a wrong seq for the token id', async () => {
    const tok = makeSignedToken({ token_id: 'anchored2' })
    await ledger.emitPortfolioOp('issue_portfolio_token', tok.token_id, ledger.issueDiff(tok))
    expect(await ledger.ledgerHasIssue('anchored2', 999)).toBe(false)
  })

  it('rejects when the entry at that seq is NOT an issue op (a consume entry)', async () => {
    const tok = makeSignedToken({ token_id: 'mixA' })
    await ledger.emitPortfolioOp('issue_portfolio_token', tok.token_id, ledger.issueDiff(tok)) // seq 0
    const consumeSeq = await ledger.emitPortfolioOp('consume_portfolio_token', tok.token_id, ledger.consumeDiff(tok, 0)) // seq 1
    expect(await ledger.ledgerHasIssue('mixA', consumeSeq as number)).toBe(false)
  })
})

describe('reconstructPortfoliosFromLedger (R33)', () => {
  it('replays issue → consume → revoke → expiry into the live store', async () => {
    // issue 3 tokens for one subject
    const live = makeSignedToken({ token_id: 'r-live', subject_agent_id: 'rsub', uses_remaining: 2 })
    const consumed = makeSignedToken({ token_id: 'r-consumed', subject_agent_id: 'rsub', uses_remaining: 1 })
    const revoked = makeSignedToken({ token_id: 'r-revoked', subject_agent_id: 'rsub', kind: 'mandate', uses_remaining: null })
    const expired = makeSignedToken({ token_id: 'r-expired', subject_agent_id: 'rsub', expires_at: new Date(Date.now() - 60_000).toISOString() })

    await ledger.emitPortfolioOp('issue_portfolio_token', live.token_id, ledger.issueDiff(live))
    await ledger.emitPortfolioOp('issue_portfolio_token', consumed.token_id, ledger.issueDiff(consumed))
    await ledger.emitPortfolioOp('issue_portfolio_token', revoked.token_id, ledger.issueDiff(revoked))
    await ledger.emitPortfolioOp('issue_portfolio_token', expired.token_id, ledger.issueDiff(expired))
    // consume r-consumed to 0
    await ledger.emitPortfolioOp('consume_portfolio_token', consumed.token_id, ledger.consumeDiff(consumed, 0))
    // revoke r-revoked
    await ledger.emitPortfolioOp('revoke_portfolio_token', revoked.token_id, ledger.revokeDiff(revoked))

    // Wipe the file mirror so reconstruct is the only writer.
    store._resetPortfolioCacheForTests()
    wipeDisk()

    const rebuilt = await ledger.reconstructPortfoliosFromLedger()
    expect(rebuilt).toBe(1) // one subject file

    store._resetPortfolioCacheForTests()
    const tokens = store.loadPortfolio('rsub')
    const byId = Object.fromEntries(tokens.map(t => [t.token_id, t]))
    expect(byId['r-live'].status).toBe('active')
    expect(byId['r-consumed'].status).toBe('consumed')
    expect(byId['r-consumed'].uses_remaining).toBe(0)
    expect(byId['r-revoked'].status).toBe('revoked')
    expect(byId['r-expired'].status).toBe('expired')
    // Each replayed token is re-anchored to its own issue seq.
    expect(byId['r-live'].ledger_seq).toBe(0)
  })

  it('returns 0 when the chain is empty', async () => {
    expect(await ledger.reconstructPortfoliosFromLedger()).toBe(0)
  })
})

describe('chain integrity', () => {
  it('the portfolio ledger verifies under the host key after appends', async () => {
    const tok = makeSignedToken({ token_id: 'verify-me' })
    await ledger.emitPortfolioOp('issue_portfolio_token', tok.token_id, ledger.issueDiff(tok))
    const { SignedLedger } = await import('@/lib/signed-ledger')
    const sl = new SignedLedger(ledger.PORTFOLIO_LEDGER_REGISTRY_PATH)
    const result = await sl.verify()
    expect(result.ok).toBe(true)
  })
})
