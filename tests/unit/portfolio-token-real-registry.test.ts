/**
 * Portfolio tokens vs a soft-deleted holder — REAL lib/agent-registry + REAL lib/portfolio-store.
 * TRDD-8E6XMDEX.
 *
 * portfolio-token-soft-deleted-holder.test.ts and delete-agent-revokes-held-portfolio-tokens.test.ts
 * drive findActiveTokens against a MOCKED registry. Here the registry row is a real one: created by
 * createAgent, soft-deleted by deleteAgent(id, false), and brought back by clearing deletedAt and
 * saving through the real saveAgents.
 *
 * REAL: agent-registry, portfolio-store (issueToken / findActiveTokens, real files), file-lock, fs.
 * DOUBLED: only `os` (homedir -> temp root, fixed hostname) for containment. issueToken stores
 * whatever record it is handed, so no signer or ledger is needed to drive findActiveTokens; the
 * token's signature is a placeholder and is never verified on this path.
 * CONTAINMENT: fingerprint (size + sha256) of the developer's real registry.json, sessions.json and
 * portfolio files before the dynamic imports and after; plus a positive control that the temp root
 * received the registry and the portfolio file.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const { TMP_HOME, REAL_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realOs = require('os') as typeof import('os')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsm = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path')
  return {
    REAL_HOME: realOs.homedir(),
    TMP_HOME: fsm.mkdtempSync(p.join(realOs.tmpdir(), 'aim-portfolio-real-')),
  }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'portfolio-real-host' },
    homedir: () => TMP_HOME,
    hostname: () => 'portfolio-real-host',
  }
})

const REAL_AIM = path.join(REAL_HOME, '.aimaestro')
const REAL_PORTFOLIOS = path.join(REAL_AIM, 'agents', 'portfolios')

function fingerprint(): Record<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto')
  const files = [
    path.join(REAL_AIM, 'agents', 'registry.json'),
    path.join(REAL_AIM, 'sessions.json'),
    ...(fs.existsSync(REAL_PORTFOLIOS)
      ? fs.readdirSync(REAL_PORTFOLIOS, { withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(REAL_PORTFOLIOS, e.name))
      : []),
  ]
  const out: Record<string, string> = {}
  for (const f of files) {
    out[f] = fs.existsSync(f)
      ? `${fs.statSync(f).size}:${createHash('sha256').update(fs.readFileSync(f)).digest('hex')}`
      : 'absent'
  }
  return out
}
const realFingerprintBefore = fingerprint()

type PortfolioToken = import('@/types/portfolio').PortfolioToken
let registry: typeof import('@/lib/agent-registry')
let store: typeof import('@/lib/portfolio-store')
let holderId: string
const NAME = `pf-${Math.random().toString(36).slice(2, 8)}`
const TOKEN_ID = `tok-${Math.random().toString(36).slice(2, 10)}`

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

beforeAll(async () => {
  expect(TMP_HOME).not.toBe(REAL_HOME)
  registry = await import('@/lib/agent-registry')
  store = await import('@/lib/portfolio-store')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

// Ordered steps sharing state (one holder, one token): shuffle: false keeps them in source order under --sequence.shuffle (describe.sequential does NOT: measured).
describe('portfolio token activity follows the REAL registry row (temp state root)', { shuffle: false }, () => {
  it('a live holder with an issued token: the store reports it active, and the temp root received the files', async () => {
    const workdir = path.join(TMP_HOME, 'agents', NAME)
    fs.mkdirSync(workdir, { recursive: true })
    const agent = await registry.createAgent({
      name: NAME,
      program: 'claude',
      taskDescription: 'portfolio real registry',
      workingDirectory: workdir,
    })
    holderId = agent.id
    await store.issueToken(makeToken(holderId, TOKEN_ID))

    expect(store.findActiveTokens(holderId).map(t => t.token_id)).toEqual([TOKEN_ID])
    // positive control: both real stores wrote under the TEMP root
    expect(fs.existsSync(path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json'))).toBe(true)
    expect(fs.existsSync(path.join(TMP_HOME, '.aimaestro', 'agents', 'portfolios', `${holderId}.json`))).toBe(true)
  })

  it('soft-deleting the holder row: the store reports NO active token for it (the token is dormant, not revoked)', async () => {
    expect(await registry.deleteAgent(holderId, false)).toBe(true)
    expect(registry.getAgent(holderId, true)?.deletedAt).toBeTruthy()

    expect(store.findActiveTokens(holderId)).toEqual([])
    // containment, not revocation: the record is still on disk as active
    expect(store.getTokenById(TOKEN_ID)?.status).toBe('active')
  })

  it('clearing deletedAt again (a rolled-back delete): the same token is active again', () => {
    const agents = registry.loadAgents()
    const row = agents.find(a => a.id === holderId)!
    expect(row.deletedAt).toBeTruthy()
    delete row.deletedAt
    row.status = 'offline'
    expect(registry.saveAgents(agents)).toBe(true)
    expect(registry.getAgent(holderId)?.deletedAt).toBeUndefined()

    expect(store.findActiveTokens(holderId).map(t => t.token_id)).toEqual([TOKEN_ID])
  })

  it('containment: the developer real registry, sessions and portfolio files are byte-identical', () => {
    expect(fingerprint()).toEqual(realFingerprintBefore)
    expect(fs.existsSync(path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json'))).toBe(true)
  })
})
