/**
 * findActiveTokens vs a soft-deleted holder (TRDD-8E6XMDEX, containment not revocation).
 *
 * A soft-deleted agent keeps its registry row (deletedAt set) so the user can
 * resurrect it; its portfolio tokens must be dormant meanwhile. A subject with NO
 * local row (user, service identity, remote-host agent) is unchanged.
 *
 * Isolation: os.homedir() mocked to a temp dir before the store loads. The registry
 * is a stateful double so reads reflect writes. Case (e), a caller-level check
 * through matchPortfolioToken, is skipped on purpose: OPERATIONS_REQUIRING_TOKEN is
 * shipped empty and a token only passes after ledger-anchored signature
 * verification, so reaching it needs the signer + host-signed ledger, and
 * mocking findActiveTokens there would mock the function under test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-softdel-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

const rows = new Map<string, { id: string; deletedAt?: string }>()
vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string, includeDeleted: boolean = false) => {
    const a = rows.get(id) ?? null
    if (a && a.deletedAt && !includeDeleted) return null
    return a
  },
}))

type PortfolioToken = import('@/types/portfolio').PortfolioToken
let store: typeof import('@/lib/portfolio-store')

beforeAll(async () => {
  store = await import('@/lib/portfolio-store')
})
afterAll(() => fs.rmSync(TMP_HOME, { recursive: true, force: true }))

function makeToken(subject: string, id: string): PortfolioToken {
  return {
    token_id: id,
    kind: 'approval',
    subject_agent_id: subject,
    scope: 'agent:create',
    issuer_agent_id: 'issuer-mgr',
    issuer_title: 'manager',
    uses_remaining: 1,
    issued_at: new Date().toISOString(),
    expires_at: null,
    issuer_sig: 'sig-placeholder',
    ledger_seq: 0,
    status: 'active',
  }
}

beforeEach(() => {
  rows.clear()
  const dir = path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios')
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
  // drop the store's 5s per-subject cache by loading a nonexistent subject is not enough;
  // distinct subject ids per test avoid stale cache hits instead.
})

describe('findActiveTokens and the holder registry row', () => {
  it('(a) live holder: its token is returned active', async () => {
    rows.set('h-live', { id: 'h-live' })
    await store.issueToken(makeToken('h-live', 'tok-live'))
    expect(store.findActiveTokens('h-live').map(t => t.token_id)).toEqual(['tok-live'])
  })

  it('(b) soft-deleted holder: no active tokens', async () => {
    rows.set('h-del', { id: 'h-del', deletedAt: new Date().toISOString() })
    await store.issueToken(makeToken('h-del', 'tok-del'))
    expect(store.findActiveTokens('h-del')).toEqual([])
  })

  it('(c) deletedAt cleared again: the token is active again', async () => {
    rows.set('h-back', { id: 'h-back', deletedAt: new Date().toISOString() })
    await store.issueToken(makeToken('h-back', 'tok-back'))
    expect(store.findActiveTokens('h-back')).toEqual([])
    delete rows.get('h-back')!.deletedAt
    expect(store.findActiveTokens('h-back').map(t => t.token_id)).toEqual(['tok-back'])
  })

  it('(d) subject with no registry row: unchanged, token active', async () => {
    await store.issueToken(makeToken('no-row-subject', 'tok-norow'))
    expect(rows.has('no-row-subject')).toBe(false)
    expect(store.findActiveTokens('no-row-subject').map(t => t.token_id)).toEqual(['tok-norow'])
  })
})
