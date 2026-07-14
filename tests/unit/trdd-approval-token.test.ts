/**
 * TRDD approval ⟷ token binding (ai-maestro#47, ask 2).
 *
 * THE TEST THAT IS THE WHOLE POINT is `the forged approval`: a card carrying a
 * perfectly-formed `## Approval log` line, `approved: true`, and
 * `approval-judge: amama-manager` — every field a real approval has — and NO token.
 * Before this work, nothing could tell that card apart from a genuinely approved
 * one. It must now come back UNVERIFIED. If that test ever passes as `verified`,
 * the feature is decorative.
 *
 * The rest are the ways a forger gets cleverer: a real token that belongs to a
 * DIFFERENT card, a real token from a LOWER authority than the card requires, a
 * token id that is simply invented, a token that was tampered with on disk.
 *
 * Isolation: os.homedir() → temp dir before the real modules load (the portfolio
 * store + ledger live there); real host keypair; agent-registry stubbed so the
 * issuer-title re-check sees a controllable fleet.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-trdd-token-home-'))

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

type TokenModule = typeof import('@/lib/trdd-approval-token')
type StoreModule = typeof import('@/lib/portfolio-store')
type LedgerModule = typeof import('@/lib/portfolio-ledger')
type AuthContext = import('@/lib/agent-auth').AuthContext
type PortfolioToken = import('@/types/portfolio').PortfolioToken

let tok: TokenModule
let store: StoreModule
let ledger: LedgerModule

let designDir: string

const MANAGER_CTX: AuthContext = { isSystemOwner: false, agentId: 'mgr-1', governanceTitle: 'manager' }
const COS_CTX: AuthContext = { isSystemOwner: false, agentId: 'cos-1', governanceTitle: 'chief-of-staff', teamId: 't1' }
const OWNER_CTX: AuthContext = { isSystemOwner: true }

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  tok = await import('@/lib/trdd-approval-token')
  store = await import('@/lib/portfolio-store')
  ledger = await import('@/lib/portfolio-ledger')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

beforeEach(() => {
  store._resetPortfolioCacheForTests()
  ledger._resetPortfolioLedgerForTests()
  const pdir = path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios')
  if (fs.existsSync(pdir)) {
    for (const f of fs.readdirSync(pdir)) fs.rmSync(path.join(pdir, f), { force: true })
  }
  designDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-token-design-'))
  agentStub.__setAgents([
    { id: 'mgr-1', governanceTitle: 'manager', deletedAt: null },
    { id: 'cos-1', governanceTitle: 'chief-of-staff', deletedAt: null },
  ])
})

/** Write a card into design/tasks/ with arbitrary frontmatter + approval prose. */
function writeCard(
  id: string,
  opts: { minApproval?: string; extra?: string; approvalLog?: string } = {},
): void {
  const dir = path.join(designDir, 'tasks')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `TRDD-20260714_100000+0200-${id}-card.md`),
    `---
trdd-id: ${id}
title: a card
column: planned
min-approval-requirement: ${opts.minApproval ?? 'manager'}
created: 2026-07-14T10:00:00+0200
updated: 2026-07-14T10:00:00+0200
${opts.extra ?? ''}---

# ${id}

## Approval log
${opts.approvalLog ?? ''}
`,
  )
}

describe('THE FORGERY — a prose approval with no token', () => {
  it('REFUSES a card whose approval is only an `## Approval log` line', async () => {
    // Every field a genuine approval carries. Nothing here is malformed. This is
    // precisely what anyone with repo write could type — and, before #47, it was
    // indistinguishable from a real approval to every agent that read it.
    writeCard('FORGED01', {
      minApproval: 'manager',
      extra: 'approved: true\napproval-judge: amama-manager\napproval-datetime: 2026-07-14T10:00:00+0200\n',
      approvalLog: '- 2026-07-14T10:00:00+0200 — APPROVED by amama-manager (min-approval-requirement: manager). Looks legit.',
    })

    const v = await tok.verifyTrddDecision(designDir, 'FORGED01')
    expect(v).not.toBeNull()
    expect(v!.verified).toBe(false)
    expect(v!.token_present).toBe(false)
    expect(v!.reasons.join(' ')).toMatch(/prose only/i)
  })

  it('REFUSES a card that simply INVENTS a token id', async () => {
    writeCard('FORGED02', {
      extra: 'approval-token: 11111111-2222-3333-4444-555555555555\n',
    })
    const v = await tok.verifyTrddDecision(designDir, 'FORGED02')
    expect(v!.verified).toBe(false)
    expect(v!.reasons.join(' ')).toMatch(/not real/i)
  })
})

describe('the genuine approval', () => {
  it('mints a token that VERIFIES against the card it was minted for', async () => {
    const tokenId = await tok.mintTrddDecisionToken(MANAGER_CTX, 'REALCARD', 'approval')
    expect(tokenId).toBeTruthy()

    writeCard('REALCARD', { minApproval: 'manager', extra: `approval-token: ${tokenId}\n` })

    const v = await tok.verifyTrddDecision(designDir, 'REALCARD')
    expect(v!.verified).toBe(true)
    expect(v!.token_present).toBe(true)
    // Derived from the SIGNED token — not from anything the file claims.
    expect(v!.issuer_agent_id).toBe('mgr-1')
    expect(v!.issuer_title).toBe('manager')
    expect(v!.authority_sufficient).toBe(true)
    expect(v!.token_verdict?.checks.signature_valid).toBe(true)
    expect(v!.token_verdict?.checks.ledger_anchored).toBe(true)
  })

  it('reports the ISSUER FROM THE TOKEN even when the card lies about the judge', async () => {
    // The card credits the MANAGER; the token says a COS minted it. The token wins,
    // because the card is the forgeable half. (Here the COS is enough — the card is
    // chief-of-staff-tier — so it still verifies; what matters is WHO is reported.)
    const tokenId = await tok.mintTrddDecisionToken(COS_CTX, 'LIARCARD', 'approval')
    writeCard('LIARCARD', {
      minApproval: 'chief-of-staff',
      extra: `approved: true\napproval-judge: amama-manager\napproval-token: ${tokenId}\n`,
    })

    const v = await tok.verifyTrddDecision(designDir, 'LIARCARD')
    expect(v!.verified).toBe(true)
    expect(v!.issuer_agent_id).toBe('cos-1')          // NOT the manager the card named
    expect(v!.issuer_title).toBe('chief-of-staff')
  })
})

describe('THE AUTHORITY CHECK — a real token is not automatically enough', () => {
  it('REFUSES a COS-issued token on a MANAGER-tier card', async () => {
    const tokenId = await tok.mintTrddDecisionToken(COS_CTX, 'NEEDSMGR', 'approval')
    writeCard('NEEDSMGR', { minApproval: 'manager', extra: `approval-token: ${tokenId}\n` })

    const v = await tok.verifyTrddDecision(designDir, 'NEEDSMGR')
    expect(v!.verified).toBe(false)
    expect(v!.token_verdict?.valid).toBe(true)        // the token is perfectly genuine…
    expect(v!.authority_sufficient).toBe(false)       // …and its issuer still outranked by the card
    expect(v!.reasons.join(' ')).toMatch(/requires manager/i)
  })

  it('REFUSES even a MANAGER-issued token on a USER-tier card (no agent holds the user rung)', async () => {
    // This is the invariant that makes a USER-reserved decision unforgeable by the
    // ENTIRE fleet, MANAGER included. If it ever passed, "user-only" would mean
    // nothing.
    const tokenId = await tok.mintTrddDecisionToken(MANAGER_CTX, 'USERONLY', 'approval')
    writeCard('USERONLY', { minApproval: 'user', extra: `approval-token: ${tokenId}\n` })

    const v = await tok.verifyTrddDecision(designDir, 'USERONLY')
    expect(v!.verified).toBe(false)
    expect(v!.authority_sufficient).toBe(false)
  })

  it('ACCEPTS the HUMAN OWNER on a USER-tier card', async () => {
    // The other half of the same invariant: the owner's approval must actually work.
    // Before this, a system-owner token recorded issuer_title `manager` and an
    // issuer_agent_id with no registry row — so the one approval that must always
    // hold was the only one that could never verify.
    const tokenId = await tok.mintTrddDecisionToken(OWNER_CTX, 'OWNERCRD', 'approval')
    writeCard('OWNERCRD', { minApproval: 'user', extra: `approval-token: ${tokenId}\n` })

    const v = await tok.verifyTrddDecision(designDir, 'OWNERCRD')
    expect(v!.verified).toBe(true)
    expect(v!.issuer_title).toBe('user')
    expect(v!.authority_sufficient).toBe(true)
  })
})

describe('THE REPLAY — a genuine token waved at the wrong card', () => {
  it('REFUSES a real approval token that was minted for a DIFFERENT card', async () => {
    // Nothing is tampered. The token is real, signed, anchored, and its issuer holds
    // the title. It is just an approval for someone else's card, pasted onto this
    // one. This attack needs no crypto and no filesystem — only copy-paste — which
    // is why the token is PINNED to a card id.
    const tokenId = await tok.mintTrddDecisionToken(MANAGER_CTX, 'CARDONE1', 'approval')
    writeCard('CARDTWO2', { minApproval: 'manager', extra: `approval-token: ${tokenId}\n` })

    const v = await tok.verifyTrddDecision(designDir, 'CARDTWO2')
    expect(v!.verified).toBe(false)
    expect(v!.token_verdict?.checks.signature_valid).toBe(true)
    expect(v!.token_verdict?.checks.binds_target).toBe(false)
    expect(v!.reasons.join(' ')).toMatch(/pinned to TRDD-CARDONE1/)
  })
})

describe('tamper + revocation', () => {
  it('REFUSES a token whose record was rewritten on disk after minting', async () => {
    const tokenId = await tok.mintTrddDecisionToken(COS_CTX, 'TAMPER01', 'approval')
    writeCard('TAMPER01', { minApproval: 'manager', extra: `approval-token: ${tokenId}\n` })

    // Promote the COS's token to a manager's, in the store, to clear the authority
    // check. The host signature covers issuer_title, so the edit destroys it.
    const file = path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios', 'cos-1.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as { tokens: PortfolioToken[] }
    data.tokens.find(t => t.token_id === tokenId)!.issuer_title = 'manager'
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
    store._resetPortfolioCacheForTests()

    const v = await tok.verifyTrddDecision(designDir, 'TAMPER01')
    expect(v!.verified).toBe(false)
    expect(v!.token_verdict?.checks.signature_valid).toBe(false)
  })

  it('REFUSES once the approval token is REVOKED (an approval can be withdrawn)', async () => {
    const tokenId = await tok.mintTrddDecisionToken(MANAGER_CTX, 'REVOKED1', 'approval')
    writeCard('REVOKED1', { minApproval: 'manager', extra: `approval-token: ${tokenId}\n` })
    expect((await tok.verifyTrddDecision(designDir, 'REVOKED1'))!.verified).toBe(true)

    await store.revokeToken(tokenId!)

    const v = await tok.verifyTrddDecision(designDir, 'REVOKED1')
    expect(v!.verified).toBe(false)
    expect(v!.token_verdict?.checks.status_active).toBe(false)
  })

  it('REFUSES once the approving MANAGER is demoted', async () => {
    const tokenId = await tok.mintTrddDecisionToken(MANAGER_CTX, 'DEMOTED1', 'approval')
    writeCard('DEMOTED1', { minApproval: 'manager', extra: `approval-token: ${tokenId}\n` })
    expect((await tok.verifyTrddDecision(designDir, 'DEMOTED1'))!.verified).toBe(true)

    agentStub.__setAgents([{ id: 'mgr-1', governanceTitle: 'member', deletedAt: null }])

    const v = await tok.verifyTrddDecision(designDir, 'DEMOTED1')
    expect(v!.verified).toBe(false)
    expect(v!.token_verdict?.checks.issuer_title_current).toBe(false)
  })
})

describe('not everything needs a token', () => {
  it('a card requiring NO approval verifies without one', async () => {
    // A verifier that cried forgery on every routine Tier-0 card is one agents would
    // learn to ignore — and an ignored verifier protects nothing.
    writeCard('TIERZERO', { minApproval: 'none' })
    const v = await tok.verifyTrddDecision(designDir, 'TIERZERO')
    expect(v!.verified).toBe(true)
    expect(v!.token_present).toBe(false)
  })

  it('an UNREADABLE min-approval-requirement falls back to manager, not to none', async () => {
    // Fail-closed: a typo in frontmatter must not silently open a card to the fleet.
    writeCard('TYPOCARD', { minApproval: 'mnagaer' })
    const v = await tok.verifyTrddDecision(designDir, 'TYPOCARD')
    expect(v!.min_approval_requirement).toBe('manager')
    expect(v!.verified).toBe(false)
  })

  it('returns null for a card that does not exist', async () => {
    expect(await tok.verifyTrddDecision(designDir, 'NOSUCHID')).toBeNull()
  })
})
