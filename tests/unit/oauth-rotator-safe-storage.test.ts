import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  macosStoreArgv,
  macosRetrieveArgv,
  macosDeleteArgv,
  secretToolStoreArgv,
  secretToolRetrieveArgv,
  secretToolDeleteArgv,
  keychainScopeArgs,
  detectBackend,
  isDenial,
  strictB64Utf8Decode,
  runSecurity,
  setKeychainDenied,
  clearKeychainDenied,
  keychainDeniedLatched,
  store,
  retrieve,
  deleteSecret,
  StoreResult,
} from '@/lib/oauth-rotator/safe-storage'
import { globalStateDir } from '@/lib/oauth-rotator/global-state'

// 0-IMPACT: no test here ever spawns the real `security` binary or touches the real
// keychain. The latch tests point JANITOR_GLOBAL_STATE_DIR at an isolated temp dir; the
// store/retrieve tests force CLAUDE_SAFE_STORAGE_BACKEND=none so no backend is invoked.

const ENV_KEYS = [
  'JANITOR_GLOBAL_STATE_DIR',
  'JANITOR_ROTATOR_KEYCHAIN',
  'CLAUDE_SAFE_STORAGE_BACKEND',
  'CLAUDE_KEYCHAIN_LATCH_COOLDOWN_S',
  'XDG_STATE_HOME',
] as const

let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-safe-storage-'))
  // Isolate the latch to the temp dir for every test (also disables the legacy dual-read).
  process.env.JANITOR_GLOBAL_STATE_DIR = tmpDir
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort temp cleanup
  }
})

describe('argv builders', () => {
  it('macos store puts the secret on argv with -U (never stdin)', () => {
    expect(macosStoreArgv('svc', 'acct', 'B64DATA')).toEqual([
      'security',
      'add-generic-password',
      '-U',
      '-s',
      'svc',
      '-a',
      'acct',
      '-w',
      'B64DATA',
    ])
  })

  it('macos retrieve uses -w; delete has no -w', () => {
    expect(macosRetrieveArgv('svc', 'acct')).toEqual([
      'security',
      'find-generic-password',
      '-s',
      'svc',
      '-a',
      'acct',
      '-w',
    ])
    expect(macosDeleteArgv('svc', 'acct')).toEqual([
      'security',
      'delete-generic-password',
      '-s',
      'svc',
      '-a',
      'acct',
    ])
  })

  it('keychainScopeArgs appends the scoped keychain only when JANITOR_ROTATOR_KEYCHAIN is set', () => {
    expect(keychainScopeArgs()).toEqual([])
    process.env.JANITOR_ROTATOR_KEYCHAIN = '/tmp/test.keychain'
    expect(keychainScopeArgs()).toEqual(['/tmp/test.keychain'])
    expect(macosRetrieveArgv('s', 'a')).toEqual([
      'security',
      'find-generic-password',
      '-s',
      's',
      '-a',
      'a',
      '-w',
      '/tmp/test.keychain',
    ])
  })

  it('secret-tool argv shape (store/lookup/clear on service+account)', () => {
    expect(secretToolStoreArgv('svc', 'acct')).toEqual([
      'secret-tool',
      'store',
      '--label',
      'ai-maestro-janitor safe-storage',
      'service',
      'svc',
      'account',
      'acct',
    ])
    expect(secretToolRetrieveArgv('svc', 'acct')).toEqual([
      'secret-tool',
      'lookup',
      'service',
      'svc',
      'account',
      'acct',
    ])
    expect(secretToolDeleteArgv('svc', 'acct')).toEqual([
      'secret-tool',
      'clear',
      'service',
      'svc',
      'account',
      'acct',
    ])
  })
})

describe('detectBackend', () => {
  it('honours the forced-backend override verbatim', () => {
    process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
    expect(detectBackend()).toBe('none')
    process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'macos'
    expect(detectBackend()).toBe('macos')
  })
})

describe('isDenial', () => {
  it('an ACL/interaction/user-canceled marker is a denial', () => {
    expect(isDenial('SecKeychain: User interaction is not allowed.')).toBe(true)
    expect(isDenial('error -25293 (errSecAuthFailed)')).toBe(true)
    expect(isDenial('The user canceled the operation.')).toBe(true)
  })
  it('a benign not-found is NOT a denial (must not latch)', () => {
    expect(isDenial('The specified item could not be found in the keychain.')).toBe(false)
    expect(isDenial('SecKeychainSearchCopyNext: could not be found')).toBe(false)
  })
  it('unrelated stderr is not a denial', () => {
    expect(isDenial('some other error')).toBe(false)
  })
})

describe('strictB64Utf8Decode', () => {
  it('round-trips a valid base64 UTF-8 value', () => {
    const raw = Buffer.from('héllo {"a":1}', 'utf8').toString('base64')
    expect(strictB64Utf8Decode(raw)).toBe('héllo {"a":1}')
  })
  it('rejects non-canonical base64 (fail-safe → null)', () => {
    expect(strictB64Utf8Decode('not base64!!')).toBeNull()
    expect(strictB64Utf8Decode('YWJj')).toBe('abc') // sanity: valid decodes
    expect(strictB64Utf8Decode('YWJ')).toBeNull() // wrong length (%4 != 0)
  })
  it('rejects base64 of invalid UTF-8 bytes (fail-safe → null)', () => {
    const badUtf8 = Buffer.from([0xff, 0xfe, 0xfd]).toString('base64')
    expect(strictB64Utf8Decode(badUtf8)).toBeNull()
  })
})

describe('denied-latch circuit breaker (isolated temp dir)', () => {
  it('set → latched → clear cycle writes under the resolved global-state dir', () => {
    expect(globalStateDir()).toBe(path.resolve(tmpDir))
    expect(keychainDeniedLatched()).toBe(false)
    setKeychainDenied('test denial', { quiet: true })
    expect(keychainDeniedLatched()).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'keychain-denied.latch'))).toBe(true)
    expect(clearKeychainDenied()).toBe(true)
    expect(keychainDeniedLatched()).toBe(false)
  })

  it('runSecurity short-circuits a FRESH latch WITHOUT spawning `security`', () => {
    setKeychainDenied('fresh latch', { quiet: true })
    const run = runSecurity(['security', 'find-generic-password', '-s', 'nope', '-a', 'nope', '-w'])
    // Fresh latch (age ~0 << 600s cooldown) → CLOSED: never spawns, returns denied.
    expect(run.spawned).toBe(false)
    expect(run.denied).toBe(true)
    expect(run.ok).toBe(false)
  })

  it('cooldown <= 0 keeps an OLD latch permanently CLOSED (auto-recovery disabled, no spawn)', () => {
    setKeychainDenied('old latch', { quiet: true })
    // Backdate the latch mtime well past any cooldown.
    const latch = path.join(tmpDir, 'keychain-denied.latch')
    const old = new Date(Date.now() - 3600_000)
    fs.utimesSync(latch, old, old)
    process.env.CLAUDE_KEYCHAIN_LATCH_COOLDOWN_S = '0'
    const run = runSecurity(['security', 'find-generic-password', '-s', 'nope', '-a', 'nope', '-w'])
    expect(run.spawned).toBe(false)
    expect(run.denied).toBe(true)
  })
})

describe('public API with no backend (no spawn, no keychain)', () => {
  beforeEach(() => {
    process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  })
  it('store returns NO_BACKEND', () => {
    expect(store('svc', 'acct', 'secret')).toBe(StoreResult.NO_BACKEND)
  })
  it('retrieve returns null', () => {
    expect(retrieve('svc', 'acct')).toBeNull()
  })
  it('deleteSecret is a no-op that never throws', () => {
    expect(() => deleteSecret('svc', 'acct')).not.toThrow()
  })
})
