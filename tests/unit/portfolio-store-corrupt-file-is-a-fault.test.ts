/**
 * A portfolio file that EXISTS but cannot be read as a token list is a fault, not an empty
 * portfolio (TRDD-8E6XMDEX). Mirrors aid-token-corrupt-store-is-a-fault.test.ts: revocation must
 * throw and leave the bytes alone; authorization reads must honour no token and log one line.
 *
 * Isolation: os.homedir() is mocked to a temp dir BEFORE the store loads (same seam as
 * portfolio-store.test.ts), so no real ~/.aimaestro state is touched. The "credentials" in the
 * files are placeholder strings.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-corrupt-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

type StoreModule = typeof import('@/lib/portfolio-store')
type PortfolioToken = import('@/types/portfolio').PortfolioToken
let store: StoreModule

const DIR = path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios')
const SUBJECT = 'sub-corrupt'
const FILE = path.join(DIR, `${SUBJECT}.json`)

beforeAll(async () => {
  store = await import('@/lib/portfolio-store')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

function makeToken(id: string): PortfolioToken {
  return {
    token_id: id,
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
  } as PortfolioToken
}

function writeFile(content: string): void {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(FILE, content)
}

let errSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  store._resetPortfolioCacheForTests()
  if (fs.existsSync(DIR)) for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f), { force: true })
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errSpy.mockRestore()
  vi.useRealTimers()
})

const CORRUPT = '{"agent_id":"x","tokens":[{"token_id":"SECRET-PLACEHOLDER"'

describe('missing file stays an empty portfolio (positive controls)', () => {
  it('revoke over a missing file reports 0 and does not throw', async () => {
    const h = await store.revokeTokensForSubjectCompensable(SUBJECT)
    expect(h.count).toBe(0)
    expect(fs.existsSync(FILE)).toBe(false)
  })

  it('revoke over a valid file with a token revokes it', async () => {
    await store.issueToken(makeToken('t-ok'))
    store._resetPortfolioCacheForTests()
    const h = await store.revokeTokensForSubjectCompensable(SUBJECT)
    expect(h.count).toBe(1)
  })
})

describe('corrupt portfolio file is a fault', () => {
  it('corrupt JSON: revoke throws naming the file only, and the bytes are unchanged', async () => {
    writeFile(CORRUPT)
    const before = fs.readFileSync(FILE)
    let msg = ''
    await store.revokeTokensForSubjectCompensable(SUBJECT).catch((e: Error) => { msg = e.message })
    expect(msg).toContain(`${SUBJECT}.json`)
    expect(msg).not.toContain('SECRET-PLACEHOLDER')
    expect(fs.readFileSync(FILE).equals(before)).toBe(true)
  })

  it('corrupt JSON: findActiveTokens honours nothing, does not throw, and logs the fault', () => {
    writeFile(CORRUPT)
    expect(store.findActiveTokens(SUBJECT)).toEqual([])
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(String(errSpy.mock.calls[0][0])).toContain(`${SUBJECT}.json`)
    expect(String(errSpy.mock.calls[0][0])).not.toContain('SECRET-PLACEHOLDER')
  })

  it('wrong shape (valid JSON, no tokens array): revoke throws and the bytes are unchanged', async () => {
    writeFile('{"agent_id":"x","tokens":"nope"}')
    const before = fs.readFileSync(FILE)
    await expect(store.revokeTokensForSubjectCompensable(SUBJECT)).rejects.toThrow(/not a list of token records/)
    expect(fs.readFileSync(FILE).equals(before)).toBe(true)
  })

  it('wrong shape: findActiveTokens returns [] and logs', () => {
    writeFile('{"agent_id":"x"}')
    expect(store.findActiveTokens(SUBJECT)).toEqual([])
    expect(errSpy).toHaveBeenCalledTimes(1)
  })

  it('after a throw, repairing the file on disk makes the tokens readable at once (no poisoned cache)', async () => {
    writeFile(CORRUPT)
    await expect(store.revokeTokensForSubjectCompensable(SUBJECT)).rejects.toThrow()
    writeFile(JSON.stringify({ agent_id: SUBJECT, tokens: [makeToken('t-fixed')] }))
    expect(store.findActiveTokens(SUBJECT).map(t => t.token_id)).toEqual(['t-fixed'])
  })

  it('a stale cache entry does not keep serving tokens from a file that has since gone bad', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await store.issueToken(makeToken('t-stale'))
    expect(store.getTokenById('t-stale')).toBeDefined()
    writeFile(CORRUPT)
    vi.setSystemTime(Date.now() + 10_000) // past the 5s cache TTL
    expect(() => store.loadPortfolio(SUBJECT)).toThrow()
    expect(store.getTokenById('t-stale')).toBeUndefined()
  })

  it('issueToken on a corrupt file throws and does not overwrite it', async () => {
    writeFile(CORRUPT)
    const before = fs.readFileSync(FILE)
    await expect(store.issueToken(makeToken('t-new'))).rejects.toThrow(`${SUBJECT}.json`)
    expect(fs.readFileSync(FILE).equals(before)).toBe(true)
  })

  it('findTokenAnywhere over a corrupt file returns undefined (not honoured) without throwing', () => {
    writeFile(CORRUPT)
    expect(store.findTokenAnywhere('whatever')).toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
  })
})

describe('fault reporting and mutators', () => {
  it('a persistent read fault is logged once per cache window, not once per poll', () => {
    writeFile(CORRUPT)
    store.findActiveTokens(SUBJECT)
    store.findActiveTokens(SUBJECT)
    store.findActiveTokens(SUBJECT)
    expect(errSpy).toHaveBeenCalledTimes(1)
  })

  it('portfolioStoreFault tells empty from unreadable', () => {
    expect(store.portfolioStoreFault(SUBJECT)).toBeNull() // missing file = empty
    writeFile(CORRUPT)
    store._resetPortfolioCacheForTests() // the missing-file answer above is cached for the TTL
    expect(store.portfolioStoreFault(SUBJECT)).toContain(`${SUBJECT}.json`)
    expect(store.portfolioStoreFault(SUBJECT)).not.toContain('SECRET-PLACEHOLDER')
  })

  it('every mutator throws on a corrupt file and leaves its bytes unchanged', async () => {
    writeFile(CORRUPT)
    const before = fs.readFileSync(FILE)
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['issueToken', () => store.issueToken(makeToken('m1'))],
      ['revokeTokensForSubject', () => store.revokeTokensForSubject(SUBJECT)],
      ['revokeTokensForSubjectCompensable', () => store.revokeTokensForSubjectCompensable(SUBJECT)],
      ['revokeTokensFromIssuerCompensable', () => store.revokeTokensFromIssuerCompensable('issuer-mgr')],
      ['revokeTokensFromIssuer', () => store.revokeTokensFromIssuer('issuer-mgr')],
      ['revokeMandatesForTeam', () => store.revokeMandatesForTeam('team-x')],
      ['cleanupExpiredPortfolioTokens', () => store.cleanupExpiredPortfolioTokens()],
      ['revokeToken', () => store.revokeToken('nope')],
      ['consumeToken', () => store.consumeToken('nope')],
      ['setLedgerSeq', () => store.setLedgerSeq('nope', 1)],
    ]
    for (const [name, call] of calls) {
      store._resetPortfolioCacheForTests()
      await expect(call(), name).rejects.toThrow(`${SUBJECT}.json`)
      expect(fs.readFileSync(FILE).equals(before), name).toBe(true)
    }
  })
})
