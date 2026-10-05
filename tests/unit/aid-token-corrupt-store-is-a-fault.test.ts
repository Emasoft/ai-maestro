/**
 * A corrupt token store is a FAULT, not an empty store — TRDD-8E6XMDEX.
 *
 * Before: a file that existed but would not parse loaded as [], so revocation reported "nothing to
 * revoke" over a store holding tokens and the next save overwrote the recoverable file with [].
 * Real files in a temp state dir; the store path is redirected through ecosystem-constants.
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import type { AIDTokenRecord } from '@/lib/aid-token'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-corrupt-tokens-'))
  return { FAKE_HOME: path.join(root, 'home'), FAKE_STATE: path.join(root, 'state') }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

const TOKENS_DIR = join(FAKE_STATE, 'governance-tokens')
const TOKENS_FILE = join(TOKENS_DIR, 'active-tokens.json')
const RAW = 'aim_tk_corrupt-store-test-token'

afterAll(() => {
  rmSync(FAKE_STATE, { recursive: true, force: true })
  rmSync(FAKE_HOME, { recursive: true, force: true })
})

/** Fresh module (it caches the store for 5 s) over a store holding exactly `content`, or no file. */
async function loadAid(content: string | null) {
  vi.resetModules()
  rmSync(TOKENS_DIR, { recursive: true, force: true })
  if (content !== null) mkdirSync(TOKENS_DIR, { recursive: true })  // null = fresh install: no directory at all
  if (content !== null) writeFileSync(TOKENS_FILE, content)
  return import('@/lib/aid-token')
}

function record(agentId: string, tokenHash: string): AIDTokenRecord {
  return {
    token_hash: tokenHash,
    agent_id: agentId,
    agent_name: agentId,
    governance_title: 'member',
    team_id: null,
    scope: 'governance',
    issued_at: '2026-07-01T00:00:00.000Z',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  }
}

describe('corrupt active-tokens store', () => {
  it('missing file: revoke reports 0 and does not throw (legal absence)', async () => {
    const m = await loadAid(null)
    await expect(m.revokeTokensForAgent('a1')).resolves.toBe(0)
  })

  it('valid store: revoke removes the agent\'s tokens', async () => {
    const m = await loadAid(JSON.stringify([record('a1', 'sha256:aa'), record('a2', 'sha256:bb')]))
    await expect(m.revokeTokensForAgent('a1')).resolves.toBe(1)
    expect(m.countTokensForAgent('a2')).toBe(1)
  })

  it('corrupt JSON: revoke throws naming the file, and the bytes on disk are unchanged', async () => {
    const corrupt = '[{"token_hash":"sha256:secretvalue","agent_id":"a1",'
    const m = await loadAid(corrupt)
    const err = await m.revokeTokensForAgent('a1').then(() => null, (e: Error) => e)
    expect(err?.message).toContain('active-tokens.json')
    expect(err?.message).not.toContain('secretvalue')
    expect(readFileSync(TOKENS_FILE, 'utf-8')).toBe(corrupt)
  })

  it('corrupt JSON: validating a presented token is rejected (null), not accepted', async () => {
    const m = await loadAid('{not json')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(m.validateGovernanceToken(RAW)).toBeNull()
      // The rejection must come from the fault path, not from "token not found in an empty store".
      expect(spy.mock.calls.flat().join(' ')).toContain('could not be read or parsed')
    } finally { spy.mockRestore() }
  })

  it('wrong shape (valid JSON, not an array of records): revoke throws and bytes are unchanged', async () => {
    const wrong = JSON.stringify({ tokens: [record('a1', 'sha256:aa')] })
    const m = await loadAid(wrong)
    const err = await m.revokeTokensForAgent('a1').then(() => null, (e: Error) => e)
    expect(err?.message).toContain('not an array of token records')
    expect(readFileSync(TOKENS_FILE, 'utf-8')).toBe(wrong)
  })

  it('wrong shape: validating a presented token is rejected', async () => {
    const m = await loadAid('{"a":1}')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(m.validateGovernanceToken(RAW)).toBeNull()
      expect(spy.mock.calls.flat().join(' ')).toContain('not an array of token records')
    } finally { spy.mockRestore() }
  })

  it('fresh install, no token directory at all: revoke reports 0 and does not throw', async () => {
    const m = await loadAid(null)
    expect(existsSync(TOKENS_DIR)).toBe(false)
    await expect(m.revokeTokensForAgent('a1')).resolves.toBe(0)
  })

  it('empty (0-byte) file: a fault, because the atomic writer never leaves 0 bytes', async () => {
    const m = await loadAid('')
    const err = await m.revokeTokensForAgent('a1').then(() => null, (e: Error) => e)
    expect(err?.message).toContain('could not be read or parsed')
    expect(readFileSync(TOKENS_FILE, 'utf-8')).toBe('')
  })

  it('corrupt store: validation returns the normal invalid result (null) and never throws', async () => {
    const m = await loadAid('][')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => m.validateGovernanceToken(RAW)).not.toThrow()
      expect(m.validateGovernanceToken(RAW)).toBeNull()
    } finally { spy.mockRestore() }
  })
})
