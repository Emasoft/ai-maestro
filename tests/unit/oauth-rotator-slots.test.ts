import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  fingerprint,
  oauthOf,
  expiresInH,
  loadState,
  saveState,
  writeSlot,
  readSlot,
  deleteSlot,
  fileSlot,
  rotatorRoot,
  stateFilePath,
  slotFilePath,
  type RotatorState,
} from '@/lib/oauth-rotator/slots'
import { tryAcquireTickLock } from '@/lib/oauth-rotator/tick-lock'

// 0-IMPACT is enforced structurally: HOME is pointed at an isolated temp dir so rotatorRoot()
// resolves entirely inside it, CLAUDE_SAFE_STORAGE_BACKEND=none makes the keychain + secret-tool
// tiers inert (slot I/O uses the temp-dir plaintext path), and JANITOR_GLOBAL_STATE_DIR keeps
// fileSlot's lock in the temp dir. A hard guard (below) fails the test BEFORE any write if HOME
// is not honored, so nothing can ever land in the real ~/.claude.

const ENV_KEYS = [
  'HOME',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_ROTATOR_HOME',
  'CLAUDE_SAFE_STORAGE_BACKEND',
  'JANITOR_GLOBAL_STATE_DIR',
] as const

let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-slots-'))
  process.env.HOME = tmpDir // rotatorRoot() derives from os.homedir() → tmp/.claude/...
  delete process.env.CLAUDE_PLUGIN_DATA // no foreign redirect; canonical derives from HOME
  delete process.env.CLAUDE_ROTATOR_HOME
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none' // keychain + secret-tool inert → plaintext path
  process.env.JANITOR_GLOBAL_STATE_DIR = tmpDir // fileSlot's tick-lock lands here
  // HARD 0-IMPACT GUARD: if HOME is not honored, refuse to run rather than write to the real home.
  if (!rotatorRoot().startsWith(tmpDir)) {
    throw new Error(`refusing to run: rotatorRoot() ${rotatorRoot()} escaped tmp ${tmpDir}`)
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

const blob = (accessToken: string, extra: Record<string, unknown> = {}) => ({
  claudeAiOauth: { accessToken, ...extra },
  mcpOAuth: { 'some-server': { token: 'x'.repeat(200) } }, // the ~8KB bloat writeSlot must strip
})

describe('pure blob helpers', () => {
  it('oauthOf returns the claudeAiOauth section, or {} for a non-object / missing', () => {
    expect(oauthOf({ claudeAiOauth: { accessToken: 't' } })).toEqual({ accessToken: 't' })
    expect(oauthOf({})).toEqual({})
    expect(oauthOf(null)).toEqual({})
    expect(oauthOf('nope')).toEqual({})
  })

  it('fingerprint is sha256(accessToken)[:16], and empty when there is no token', () => {
    const want = crypto.createHash('sha256').update('tok', 'utf8').digest('hex').slice(0, 16)
    expect(fingerprint(blob('tok'))).toBe(want)
    expect(fingerprint(blob('tok'))).toHaveLength(16)
    expect(fingerprint({ claudeAiOauth: {} })).toBe('')
    expect(fingerprint({})).toBe('')
  })

  it('expiresInH handles ms (>1e12), seconds, and non-numeric → null', () => {
    expect(expiresInH({ claudeAiOauth: { expiresAt: Date.now() + 3600_000 } })).toBeGreaterThan(0.9)
    expect(expiresInH({ claudeAiOauth: { expiresAt: Date.now() + 3600_000 } })).toBeLessThan(1.1)
    const secs = Math.floor(Date.now() / 1000) + 3600
    expect(expiresInH({ claudeAiOauth: { expiresAt: secs } })).toBeGreaterThan(0.9)
    expect(expiresInH({ claudeAiOauth: { expiresAt: secs } })).toBeLessThan(1.1)
    expect(expiresInH({ claudeAiOauth: {} })).toBeNull()
    expect(expiresInH({ claudeAiOauth: { expiresAt: 'soon' } })).toBeNull()
  })
})

describe('loadState / saveState', () => {
  it('returns the empty default when no state.json exists', () => {
    expect(loadState()).toEqual({ live_email: null, live_fp: null, slots: {} })
  })

  it('round-trips a state through save → load (with the integrity sidecars written)', () => {
    const st: RotatorState = {
      live_email: 'a@example.com',
      live_fp: 'abc123',
      slots: { 'a@example.com': { captured_at: 't', fp: 'abc123', expires_at: 1234, via: 'browser' } },
    }
    saveState(st)
    expect(fs.existsSync(stateFilePath() + '.sha256')).toBe(true)
    expect(fs.existsSync(stateFilePath() + '.bak')).toBe(true)
    expect(loadState()).toEqual(st)
  })

  it('recovers via integrity when the primary state.json is corrupted', () => {
    saveState({ live_email: 'x@e.com', live_fp: 'f', slots: {} })
    fs.writeFileSync(stateFilePath(), 'not json at all') // corrupt primary; .bak + sidecars intact
    expect(loadState().live_email).toBe('x@e.com') // restored from .bak
  })
})

describe('writeSlot / readSlot (plaintext path — backend forced off)', () => {
  it('round-trips a slot and STRIPS mcpOAuth (only claudeAiOauth is stored)', () => {
    writeSlot('a@example.com', blob('tok-a'))
    // The plaintext slot file lives under the temp rotator root — 0-impact.
    expect(slotFilePath('a@example.com').startsWith(tmpDir)).toBe(true)
    expect(fs.existsSync(slotFilePath('a@example.com'))).toBe(true)
    const got = readSlot('a@example.com')
    expect(got).toEqual({ claudeAiOauth: { accessToken: 'tok-a' } }) // mcpOAuth stripped
    expect((got as Record<string, unknown>).mcpOAuth).toBeUndefined()
  })

  it('readSlot returns null for an account with no slot', () => {
    expect(readSlot('nobody@example.com')).toBeNull()
  })

  it('the plaintext slot file is owner-only (0600)', () => {
    writeSlot('b@example.com', blob('tok-b'))
    expect(fs.statSync(slotFilePath('b@example.com')).mode & 0o777).toBe(0o600)
  })

  it('deleteSlot removes the plaintext slot', () => {
    writeSlot('c@example.com', blob('tok-c'))
    deleteSlot('c@example.com')
    expect(readSlot('c@example.com')).toBeNull()
  })
})

describe('fileSlot (locked capture: writeSlot + state index in one step)', () => {
  it('writes the slot AND records its no-secret index entry under the lock', async () => {
    const ok = await fileSlot('d@example.com', blob('tok-d'), { via: 'browser', expiresAt: 999 })
    expect(ok).toBe(true)
    expect(readSlot('d@example.com')).toEqual({ claudeAiOauth: { accessToken: 'tok-d' } })
    const entry = loadState().slots['d@example.com']
    expect(entry.via).toBe('browser')
    expect(entry.expires_at).toBe(999)
    expect(entry.fp).toBe(fingerprint(blob('tok-d'))) // fingerprint, never the token
    expect(entry.captured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/)
  })

  it('returns false WITHOUT writing when the lock cannot be taken within the timeout', async () => {
    const held = tryAcquireTickLock() // hold the server tick lock (our live pid, fresh)
    expect(held).not.toBeNull()
    try {
      const ok = await fileSlot('e@example.com', blob('tok-e'), {
        via: 'token',
        expiresAt: null,
        timeoutMs: 200,
      })
      expect(ok).toBe(false)
      expect(readSlot('e@example.com')).toBeNull() // nothing written on the lost-lock path
      expect(loadState().slots['e@example.com']).toBeUndefined()
    } finally {
      held!.release()
    }
  })
})
