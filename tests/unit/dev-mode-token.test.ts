import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * lib/dev-mode-token.ts (TRDD-A9335BZ6) — the crypto core of unattended dev login.
 *
 * WHY THIS FILE EXISTS AT ALL, written down because the gap it closes was invisible:
 * the card deliberately does NOT build an `AI_MAESTRO_DEV_MODE` env var — a bare env
 * read that can weaken authentication is what TRDD-CC9PY337 deletes rather than gates.
 * The dashboard-owned `enabled` flag IS the replacement, i.e. it is the entire security
 * justification for that refusal. A NEUTER run on 2026-08-21 (`if (!rec || rec.enabled
 * !== true)` -> `if (!rec)`) reddened **0 of 14** tests across the route and login
 * suites: the flag was enforced by nothing, so the justification was decorative. These
 * tests are what make it real. If you weaken the flag, `refuses a correct token while
 * disabled` must go red.
 *
 * Runs REAL against a throwaway $HOME — governance.json is written for real, so
 * "revoked" and "disabled" mean what they say on disk rather than in a mock.
 */

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-dev-mode-token-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

const load = () => import('@/lib/dev-mode-token')

describe('dev-mode token — the dashboard-owned enable flag', () => {
  it('refuses a correct token while disabled, and honours it again when re-enabled', async () => {
    const m = await load()
    const token = await m.mintDevToken()
    expect(await m.verifyDevToken(token)).toBe(true)

    await m.setDevModeEnabled(false)
    expect(m.getDevTokenStatus().enabled).toBe(false)
    // The token is UNCHANGED and still stored — this asserts the flag alone refuses it.
    expect(m.getDevTokenStatus().issued).toBe(true)
    expect(await m.verifyDevToken(token)).toBe(false)

    await m.setDevModeEnabled(true)
    expect(await m.verifyDevToken(token)).toBe(true)
  })

  it('a toggle set before any mint does not fabricate an issued token', async () => {
    const m = await load()
    await m.setDevModeEnabled(true)
    const s = m.getDevTokenStatus()
    expect(s.enabled).toBe(true)
    expect(s.issued).toBe(false)
  })
})

describe('dev-mode token — mint / verify / revoke', () => {
  it('mints an am- prefixed token, enables login, and stamps createdAt', async () => {
    const m = await load()
    const token = await m.mintDevToken()
    expect(token.startsWith(m.DEV_TOKEN_PREFIX)).toBe(true)
    expect(token.length).toBeGreaterThan(40)
    const s = m.getDevTokenStatus()
    expect(s).toMatchObject({ enabled: true, issued: true })
    expect(s.createdAt).toBeTruthy()
    expect(s.lastUsedAt).toBeNull()
  })

  it('never exposes the token or its hash through the status surface', async () => {
    const m = await load()
    const token = await m.mintDevToken()
    const s = m.getDevTokenStatus() as unknown as Record<string, unknown>
    expect(Object.keys(s).sort()).toEqual(['createdAt', 'enabled', 'issued', 'lastUsedAt'])
    expect(JSON.stringify(s)).not.toContain(token)
    expect(JSON.stringify(s)).not.toContain(token.slice(m.DEV_TOKEN_PREFIX.length, 20))
  })

  it('rejects a wrong token, a malformed one, and one lacking the prefix', async () => {
    const m = await load()
    const token = await m.mintDevToken()
    expect(await m.verifyDevToken(token + 'x')).toBe(false)
    expect(await m.verifyDevToken('am-not-the-token')).toBe(false)
    expect(await m.verifyDevToken(token.slice(m.DEV_TOKEN_PREFIX.length))).toBe(false)
    expect(await m.verifyDevToken('')).toBe(false)
    // positive control: the real token still works, so the rejections above are
    // discrimination and not a store that simply refuses everything
    expect(await m.verifyDevToken(token)).toBe(true)
  })

  it('re-minting kills the previous token — "I lost it" also means "the lost one is dead"', async () => {
    const m = await load()
    const first = await m.mintDevToken()
    const second = await m.mintDevToken()
    expect(second).not.toBe(first)
    expect(await m.verifyDevToken(first)).toBe(false)
    expect(await m.verifyDevToken(second)).toBe(true)
  })

  it('revoke destroys the record, so nothing is left to honour', async () => {
    const m = await load()
    const token = await m.mintDevToken()
    await m.revokeDevToken()
    const s = m.getDevTokenStatus()
    expect(s.issued).toBe(false)
    expect(s.enabled).toBe(false)
    expect(await m.verifyDevToken(token)).toBe(false)
  })

  it('refuses before anything has ever been minted', async () => {
    const m = await load()
    expect(m.getDevTokenStatus()).toEqual({
      enabled: false, issued: false, createdAt: null, lastUsedAt: null,
    })
    expect(await m.verifyDevToken('am-anything')).toBe(false)
  })

  it('stamps lastUsedAt on a successful verify only', async () => {
    const m = await load()
    const token = await m.mintDevToken()
    expect(await m.verifyDevToken('am-wrong')).toBe(false)
    expect(m.getDevTokenStatus().lastUsedAt).toBeNull()
    expect(await m.verifyDevToken(token)).toBe(true)
    expect(m.getDevTokenStatus().lastUsedAt).toBeTruthy()
  })
})
