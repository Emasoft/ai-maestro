/**
 * isSoftDeletedAgent fails CLOSED on an unreadable registry — REAL lib/agent-registry, temp state root.
 * TRDD-8E6XMDEX. REAL: agent-registry, agent-auth, session-auth, fs. DOUBLED: only `os` (homedir -> temp root).
 * The session-cookie case drives authenticateAgent with a real createSession token.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const { TMP_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realOs = require('os') as typeof import('os')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsm = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path')
  return { TMP_HOME: fsm.mkdtempSync(p.join(realOs.tmpdir(), 'aim-softdel-strict-')) }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'softdel-strict-host' },
    homedir: () => TMP_HOME,
    hostname: () => 'softdel-strict-host',
  }
})

const REGISTRY = path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json')
let registry: typeof import('@/lib/agent-registry')
let auth: typeof import('@/lib/agent-auth')

function writeRegistry(raw: string) {
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true })
  fs.writeFileSync(REGISTRY, raw)
  // distinct mtime so the mtime cache can never mask a rewrite
  const t = new Date(Date.now() + writeRegistry.n++ * 2000)
  fs.utimesSync(REGISTRY, t, t)
}
writeRegistry.n = 1

const LIVE = { id: 'live-agent', name: 'live' }
const DEAD = { id: 'dead-agent', name: 'dead', deletedAt: '2026-01-01T00:00:00.000Z' }

beforeAll(async () => {
  expect(TMP_HOME).toContain('aim-softdel-strict-')
  registry = await import('@/lib/agent-registry')
  auth = await import('@/lib/agent-auth')
})
beforeEach(() => {
  fs.rmSync(path.dirname(REGISTRY), { recursive: true, force: true })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

describe('soft-deleted check on an unreadable registry', () => {
  it('missing registry file: strict reader returns [] and the agent is not soft-deleted', () => {
    expect(registry.loadAgentsStrict()).toEqual([])
    expect(auth.isSoftDeletedAgent('live-agent')).toBe(false)
  })

  it('valid registry: a live agent is not soft-deleted', () => {
    writeRegistry(JSON.stringify([LIVE, DEAD]))
    expect(auth.isSoftDeletedAgent('live-agent')).toBe(false)
  })

  it('valid registry: a soft-deleted agent is soft-deleted', () => {
    writeRegistry(JSON.stringify([LIVE, DEAD]))
    expect(auth.isSoftDeletedAgent('dead-agent')).toBe(true)
  })

  it('corrupt JSON: strict reader throws and the check refuses (true)', () => {
    writeRegistry('{ not json')
    expect(() => registry.loadAgentsStrict()).toThrow(/registry\.json/)
    expect(auth.isSoftDeletedAgent('live-agent')).toBe(true)
  })

  it('JSON object instead of an array: strict reader throws and the check refuses (true)', () => {
    writeRegistry('{}')
    expect(() => registry.loadAgentsStrict()).toThrow(/not a JSON array/)
    expect(auth.isSoftDeletedAgent('live-agent')).toBe(true)
  })

  it('lenient loadAgents still returns [] on the corrupt file (other callers unchanged)', () => {
    writeRegistry('{ not json')
    expect(registry.loadAgents()).toEqual([])
    writeRegistry('{}')
    expect(registry.loadAgents()).toEqual([])
  })

  it('corrupt after a good read never serves stale cached rows, and recovers once rewritten valid', () => {
    writeRegistry(JSON.stringify([LIVE, DEAD]))
    expect(registry.loadAgents()).toHaveLength(2) // warm the mtime cache
    expect(registry.loadAgentsStrict()).toHaveLength(2)
    writeRegistry('{ not json')
    expect(() => registry.loadAgentsStrict()).toThrow()
    expect(auth.isSoftDeletedAgent('dead-agent')).toBe(true)
    writeRegistry(JSON.stringify([LIVE]))
    expect(registry.loadAgentsStrict()).toEqual([LIVE])
    expect(auth.isSoftDeletedAgent('live-agent')).toBe(false)
  })

  it('web session cookie auth is NOT refused when the registry is corrupt (cookie branch never reads it)', async () => {
    const session = await import('@/lib/session-auth')
    const token = await session.createSession('127.0.0.1')
    writeRegistry('{ not json')
    const res = auth.authenticateAgent(null, null, `${session.SESSION_COOKIE_NAME}=${token}`)
    expect(res.error).toBeUndefined()
  })
})
