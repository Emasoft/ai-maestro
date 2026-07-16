import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import {
  addPasswordArgv,
  keychainItemExists,
  securityWrite,
  securityReadRaw,
  securityDelete,
  KeychainWriteResult,
} from '@/lib/oauth-rotator/keychain'

// 0-IMPACT: the argv-builder tests are pure (no spawn). The runtime tests force
// CLAUDE_SAFE_STORAGE_BACKEND=none so keychain.ts's macosActive() gate is false and NO op ever
// spawns `security` — the real keychain is never touched on any platform.

let savedBackend: string | undefined

beforeEach(() => {
  savedBackend = process.env.CLAUDE_SAFE_STORAGE_BACKEND
})

afterEach(() => {
  if (savedBackend === undefined) delete process.env.CLAUDE_SAFE_STORAGE_BACKEND
  else process.env.CLAUDE_SAFE_STORAGE_BACKEND = savedBackend
})

describe('addPasswordArgv (pure builder — the TRDD-EQJPPZ2L create-vs-update ACL rule)', () => {
  it('CREATE + allowAny → -A (allow-all, the slot family)', () => {
    expect(addPasswordArgv('svc', 'acct', 'RAWDATA', { allowAny: true, setAcl: true })).toEqual([
      'security',
      'add-generic-password',
      '-U',
      '-s',
      'svc',
      '-a',
      'acct',
      '-A',
      '-w',
      'RAWDATA',
    ])
  })

  it('CREATE + !allowAny → the -T partners (/usr/bin/security + this interpreter — the live family)', () => {
    const exe = fs.realpathSync(process.execPath)
    expect(addPasswordArgv('svc', 'acct', 'D', { allowAny: false, setAcl: true })).toEqual([
      'security',
      'add-generic-password',
      '-U',
      '-s',
      'svc',
      '-a',
      'acct',
      '-T',
      '/usr/bin/security',
      '-T',
      exe,
      '-w',
      'D',
    ])
  })

  it('UPDATE (setAcl:false) emits NO ACL flag — no SecKeychainItemSetAccess prompt', () => {
    expect(addPasswordArgv('svc', 'acct', 'D', { allowAny: true, setAcl: false })).toEqual([
      'security',
      'add-generic-password',
      '-U',
      '-s',
      'svc',
      '-a',
      'acct',
      '-w',
      'D',
    ])
  })

  it('stores the value RAW on -w (no base64 wrapping — a shared janitor read parses it as JSON)', () => {
    const argv = addPasswordArgv('svc', 'acct', '{"claudeAiOauth":{"accessToken":"t"}}')
    const wIdx = argv.indexOf('-w')
    expect(argv[wIdx + 1]).toBe('{"claudeAiOauth":{"accessToken":"t"}}')
  })
})

describe('macosActive gate — forced backend=none makes every op inert (no spawn)', () => {
  beforeEach(() => {
    process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  })
  it('securityWrite → NO_KEYCHAIN', () => {
    expect(securityWrite('svc', 'acct', 'D')).toBe(KeychainWriteResult.NO_KEYCHAIN)
  })
  it('securityReadRaw → null', () => {
    expect(securityReadRaw('svc', 'acct')).toBeNull()
  })
  it('keychainItemExists → true (assume-exists: never risk an ACL prompt)', () => {
    expect(keychainItemExists('svc', 'acct')).toBe(true)
  })
  it('securityDelete → no-op, never throws', () => {
    expect(() => securityDelete('svc', 'acct')).not.toThrow()
  })
})
