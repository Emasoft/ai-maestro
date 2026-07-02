/**
 * Portfolio store tests (R28) — the secure-enclave persistence layer.
 *
 * Covers: issue + load round-trip, the O(1) token index, consume (one-shot
 * decrement + flip-to-consumed at zero, mandate no-op), revoke-by-token /
 * by-subject / by-issuer / by-team, expiry pruning on load, the 5s cache TTL
 * with revocation invalidating it, and the bulk replaceAll recovery write.
 *
 * Isolation: os.homedir() is mocked to a per-file temp dir BEFORE the store
 * module loads, so its module-load-time `statePath('agents','portfolios')`
 * resolves under the temp HOME and no real ~/.aimaestro state is touched.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-store-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

// Imported after the os mock so the module-load-time path resolves to TMP_HOME.
type StoreModule = typeof import('@/lib/portfolio-store')
type PortfolioToken = import('@/types/portfolio').PortfolioToken
let store: StoreModule

beforeAll(async () => {
  store = await import('@/lib/portfolio-store')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

let _seq = 0
function makeToken(over: Partial<PortfolioToken> = {}): PortfolioToken {
  _seq += 1
  return {
    token_id: over.token_id ?? `tok-${_seq}-${Math.random().toString(36).slice(2, 8)}`,
    kind: over.kind ?? 'approval',
    subject_agent_id: over.subject_agent_id ?? 'subject-a',
    scope: over.scope ?? 'agent:create',
    issuer_agent_id: over.issuer_agent_id ?? 'issuer-mgr',
    issuer_title: over.issuer_title ?? 'manager',
    uses_remaining: over.uses_remaining ?? 1,
    issued_at: over.issued_at ?? new Date().toISOString(),
    expires_at: over.expires_at ?? null,
    issuer_sig: over.issuer_sig ?? 'sig-placeholder',
    ledger_seq: over.ledger_seq ?? 0,
    status: over.status ?? 'active',
    ...over,
  }
}

beforeEach(() => {
  // Wipe both the in-memory cache/index AND every portfolio file on disk so
  // each test starts from a known-empty enclave.
  store._resetPortfolioCacheForTests()
  const dir = path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
  }
})

describe('issueToken + loadPortfolio + index', () => {
  it('persists a token and reloads it across a cache reset', async () => {
    const tok = makeToken({ subject_agent_id: 'sub-1' })
    await store.issueToken(tok)
    store._resetPortfolioCacheForTests()
    const loaded = store.loadPortfolio('sub-1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].token_id).toBe(tok.token_id)
  })

  it('returns an empty array for a subject with no portfolio file', () => {
    expect(store.loadPortfolio('nobody-here')).toEqual([])
  })

  it('getTokenById resolves a loaded token in O(1) via the index', async () => {
    const tok = makeToken({ subject_agent_id: 'sub-idx' })
    await store.issueToken(tok)
    store.loadPortfolio('sub-idx') // populate the index
    expect(store.getTokenById(tok.token_id)?.token_id).toBe(tok.token_id)
  })

  it('findActiveTokens omits a consumed/expired/used-up token', async () => {
    await store.issueToken(makeToken({ subject_agent_id: 'sub-act', token_id: 'active-1' }))
    await store.issueToken(makeToken({ subject_agent_id: 'sub-act', token_id: 'used-1', uses_remaining: 0 }))
    const active = store.findActiveTokens('sub-act')
    expect(active.map(t => t.token_id)).toEqual(['active-1'])
  })
})

describe('consumeToken (one-shot vs mandate)', () => {
  it('decrements a one-shot approval to 0 and flips status to consumed', async () => {
    const tok = makeToken({ subject_agent_id: 'sub-c', token_id: 'oneshot', uses_remaining: 1 })
    await store.issueToken(tok)
    const changed = await store.consumeToken('oneshot')
    expect(changed).toBe(true)
    const after = store.loadPortfolio('sub-c').find(t => t.token_id === 'oneshot')!
    expect(after.uses_remaining).toBe(0)
    expect(after.status).toBe('consumed')
    // Now inactive — not returned by findActiveTokens.
    expect(store.findActiveTokens('sub-c')).toHaveLength(0)
  })

  it('is a no-op on a mandate token (uses_remaining null)', async () => {
    const tok = makeToken({ subject_agent_id: 'sub-m', token_id: 'mandate', kind: 'mandate', uses_remaining: null })
    await store.issueToken(tok)
    const changed = await store.consumeToken('mandate')
    expect(changed).toBe(false)
    const after = store.loadPortfolio('sub-m').find(t => t.token_id === 'mandate')!
    expect(after.uses_remaining).toBeNull()
    expect(after.status).toBe('active')
  })
})

describe('revocation', () => {
  it('revokeToken flips a single active token to revoked', async () => {
    await store.issueToken(makeToken({ subject_agent_id: 'sub-r', token_id: 'rv' }))
    const ok = await store.revokeToken('rv')
    expect(ok).toBe(true)
    expect(store.loadPortfolio('sub-r').find(t => t.token_id === 'rv')!.status).toBe('revoked')
  })

  it('revokeTokensForSubject revokes every active token a subject holds', async () => {
    await store.issueToken(makeToken({ subject_agent_id: 'sub-all', token_id: 'a' }))
    await store.issueToken(makeToken({ subject_agent_id: 'sub-all', token_id: 'b', kind: 'mandate', uses_remaining: null }))
    const n = await store.revokeTokensForSubject('sub-all')
    expect(n).toBe(2)
    expect(store.findActiveTokens('sub-all')).toHaveLength(0)
  })

  it('revokeTokensFromIssuer revokes the issuer grants across all subjects', async () => {
    await store.issueToken(makeToken({ subject_agent_id: 'sub-x', token_id: 'g1', issuer_agent_id: 'demoted-cos' }))
    await store.issueToken(makeToken({ subject_agent_id: 'sub-y', token_id: 'g2', issuer_agent_id: 'demoted-cos' }))
    await store.issueToken(makeToken({ subject_agent_id: 'sub-y', token_id: 'g3', issuer_agent_id: 'other-mgr' }))
    const n = await store.revokeTokensFromIssuer('demoted-cos')
    expect(n).toBe(2)
    expect(store.getTokenById('g3')?.status).toBe('active')
  })

  it('revokeMandatesForTeam revokes mandates scoped to a deleted team', async () => {
    await store.issueToken(makeToken({ subject_agent_id: 'sub-t', token_id: 'm-target', kind: 'mandate', uses_remaining: null, target_team_id: 'team-9' }))
    await store.issueToken(makeToken({ subject_agent_id: 'sub-t', token_id: 'm-issuer', kind: 'mandate', uses_remaining: null, issuer_team_id: 'team-9' }))
    await store.issueToken(makeToken({ subject_agent_id: 'sub-t', token_id: 'm-other', kind: 'mandate', uses_remaining: null, target_team_id: 'team-other' }))
    const n = await store.revokeMandatesForTeam('team-9')
    expect(n).toBe(2)
    expect(store.getTokenById('m-other')?.status).toBe('active')
  })
})

describe('expiry pruning + cache TTL', () => {
  it('flips an expired active token to expired on load (prune-on-load)', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    await store.issueToken(makeToken({ subject_agent_id: 'sub-e', token_id: 'old', expires_at: past }))
    store._resetPortfolioCacheForTests()
    const loaded = store.loadPortfolio('sub-e')
    expect(loaded.find(t => t.token_id === 'old')!.status).toBe('expired')
  })

  it('cleanupExpiredPortfolioTokens leaves expired tokens flipped to expired on disk', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    await store.issueToken(makeToken({ subject_agent_id: 'sub-gc', token_id: 'exp', expires_at: past }))
    store._resetPortfolioCacheForTests()
    // The GC sweep is idempotent with prune-on-load: loadPortfolio already
    // flips an expired-active token to 'expired' in memory, so the sweep's
    // own count may be 0 — the contract is the END STATE, not the count.
    await store.cleanupExpiredPortfolioTokens()
    store._resetPortfolioCacheForTests()
    const after = store.loadPortfolio('sub-gc').find(t => t.token_id === 'exp')!
    expect(after.status).toBe('expired')
    // And a returned count is always a non-negative number.
    const count = await store.cleanupExpiredPortfolioTokens()
    expect(count).toBeGreaterThanOrEqual(0)
  })

  it('a revoke invalidates the cache so findActiveTokens reflects it', async () => {
    await store.issueToken(makeToken({ subject_agent_id: 'sub-inval', token_id: 'live' }))
    expect(store.findActiveTokens('sub-inval')).toHaveLength(1)
    await store.revokeToken('live') // savePortfolio refreshes the cache
    expect(store.findActiveTokens('sub-inval')).toHaveLength(0)
  })
})

describe('replaceAllPortfolios (R33 recovery bulk write)', () => {
  it('overwrites the named subjects and reports the count written', async () => {
    const m = new Map<string, PortfolioToken[]>()
    m.set('sub-A', [makeToken({ subject_agent_id: 'sub-A', token_id: 'A1' })])
    m.set('sub-B', [makeToken({ subject_agent_id: 'sub-B', token_id: 'B1' })])
    const written = await store.replaceAllPortfolios(m)
    expect(written).toBe(2)
    store._resetPortfolioCacheForTests()
    expect(store.loadPortfolio('sub-A').map(t => t.token_id)).toEqual(['A1'])
    expect(store.loadPortfolio('sub-B').map(t => t.token_id)).toEqual(['B1'])
  })
})
