import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  keychainAccount,
  primarySecretReadPermitted,
  readLivePrimary,
  readLiveBlob,
  readLiveBlobWithSource,
  primaryLiveItemAbsent,
  writeLiveBlob,
  KEYCHAIN_SERVICE,
} from '@/lib/oauth-rotator/live'

// 0-IMPACT — R16 SAFETY: writeLiveBlob overwrites the REAL Claude Code-credentials item when run
// live. Every test here forces CLAUDE_SAFE_STORAGE_BACKEND=none (keychain + secret-tool inert) and
// points HOME at a temp dir, with a HARD GUARD that refuses to run if HOME is not honored — so the
// credentials-file write (the NO_KEYCHAIN branch) lands in the temp dir and NEVER touches the real
// ~/.claude/.credentials.json. No test ever spawns `security` or reads/writes the live credential.

const ENV_KEYS = ['HOME', 'USER', 'LOGNAME', 'JANITOR_ROTATOR_HEADLESS', 'CLAUDE_SAFE_STORAGE_BACKEND'] as const
let saved: Record<string, string | undefined>
let tmpDir: string
let credFile: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-live-'))
  process.env.HOME = tmpDir
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  delete process.env.JANITOR_ROTATOR_HEADLESS
  credFile = path.join(os.homedir(), '.claude', '.credentials.json')
  // HARD 0-IMPACT/R16 GUARD: never write the live credential outside the temp dir.
  if (!credFile.startsWith(tmpDir)) {
    throw new Error(`refusing to run: credentials path ${credFile} escaped tmp ${tmpDir}`)
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

const liveBlob = () => ({
  claudeAiOauth: { accessToken: 'live-tok', refreshToken: 'r', expiresAt: Date.now() + 3600_000 },
  mcpOAuth: { srv: { token: 'mcp' } }, // the live credential keeps mcpOAuth (unlike a slot)
})

describe('pure config helpers', () => {
  it('keychainAccount resolves $USER, then $LOGNAME, then empty', () => {
    process.env.USER = 'alice'
    expect(keychainAccount()).toBe('alice')
    delete process.env.USER
    process.env.LOGNAME = 'bob'
    expect(keychainAccount()).toBe('bob')
    delete process.env.LOGNAME
    expect(keychainAccount()).toBe('')
  })

  it('primarySecretReadPermitted is true unless JANITOR_ROTATOR_HEADLESS is truthy', () => {
    expect(primarySecretReadPermitted()).toBe(true) // unset
    for (const v of ['0', 'false', 'no', 'off', '']) {
      process.env.JANITOR_ROTATOR_HEADLESS = v
      expect(primarySecretReadPermitted()).toBe(true)
    }
    for (const v of ['1', 'true', 'yes']) {
      process.env.JANITOR_ROTATOR_HEADLESS = v
      expect(primarySecretReadPermitted()).toBe(false)
    }
  })

  it('KEYCHAIN_SERVICE is the exact service Claude Code owns', () => {
    expect(KEYCHAIN_SERVICE).toBe('Claude Code-credentials')
  })
})

describe('readLivePrimary / readLiveBlobWithSource (backend off — file & mirror ladder)', () => {
  it('returns null / "none" when nothing exists anywhere', () => {
    expect(readLivePrimary()).toBeNull()
    expect(readLiveBlob()).toBeNull()
    expect(readLiveBlobWithSource()).toEqual([null, 'none'])
  })

  it('reads the credentials file (Linux/Windows primary) and reports source "primary"', () => {
    const blob = liveBlob()
    fs.mkdirSync(path.dirname(credFile), { recursive: true })
    fs.writeFileSync(credFile, JSON.stringify(blob))
    expect(readLivePrimary()).toEqual(blob)
    expect(readLiveBlobWithSource()).toEqual([blob, 'primary'])
  })
})

describe('primaryLiveItemAbsent (non-macOS branch: the credentials file IS the primary)', () => {
  it('is true with no file, false once the file exists', () => {
    expect(primaryLiveItemAbsent()).toBe(true)
    fs.mkdirSync(path.dirname(credFile), { recursive: true })
    fs.writeFileSync(credFile, '{}')
    expect(primaryLiveItemAbsent()).toBe(false)
  })
})

describe('writeLiveBlob (NO_KEYCHAIN branch → atomic credentials file, temp-dir only)', () => {
  it('writes the FULL blob (incl mcpOAuth) to the credentials file, owner-only, and round-trips', () => {
    const blob = liveBlob()
    writeLiveBlob(blob)
    expect(credFile.startsWith(tmpDir)).toBe(true) // proven in-temp
    expect(fs.existsSync(credFile)).toBe(true)
    expect(fs.statSync(credFile).mode & 0o777).toBe(0o600)
    // Stored verbatim (compact) — NOT stripped like a slot.
    expect(fs.readFileSync(credFile, 'utf8')).toBe(JSON.stringify(blob))
    expect(readLivePrimary()).toEqual(blob)
    expect((readLivePrimary() as Record<string, unknown>).mcpOAuth).toEqual({ srv: { token: 'mcp' } })
    // No tmp left behind.
    expect(fs.readdirSync(path.dirname(credFile)).some(n => n.includes('.tmp.'))).toBe(false)
  })
})
