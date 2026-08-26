import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  describeSecurityArgv,
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

  // NEUTER RUNS (2026-08-26 — OBSERVED via scripts/dev/neuter, restore verified by blob hash).
  // A COMPLEMENTARY PAIR, because neither mutation alone can reach all three tests: disabling the
  // log cannot redden a test that asserts silence, and forcing it cannot redden one that asserts
  // a log. Run singly, either would have certified a third of this block as pinned when it was not.
  //   s/if \(elapsedMs >= SLOW_SECURITY_LOG_MS\)/if (false)/  → 2 red / 18 green:
  //       runSecurity LOGS elapsed + argv for a spawn at/over the slow threshold
  //       runSecurity marks the log TIMED OUT when the spawn is killed by its own timeout
  //   s/if \(elapsedMs >= SLOW_SECURITY_LOG_MS\)/if (true)/   → 1 red / 19 green:
  //       runSecurity stays SILENT for a fast spawn (a healthy box logs nothing)
  // Each test falls to exactly one mutation; none is vacuous.
  // TRDD-MFTDMSJY — the SLOW-op instrumentation. The latch fired 350 times in 46 days recording
  // only "hung past 5s", with no duration and no argv, so nobody could tell a hanging ACL prompt
  // from any other block. These pin that a slow spawn now names itself. They drive `sleep`/`true`
  // rather than `security`: 0-IMPACT holds (no keychain is touched) and the timing is the subject.
  it('runSecurity LOGS elapsed + argv for a spawn at/over the slow threshold', () => {
    const seen: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => {
      seen.push(String(m))
    })
    try {
      const run = runSecurity(['sleep', '3'])
      expect(run.spawned).toBe(true)
    } finally {
      spy.mockRestore()
    }
    const slow = seen.filter(l => l.includes('SLOW `security` op'))
    expect(slow).toHaveLength(1)
    expect(slow[0]).toMatch(/verb=3/) // argv[1] of ['sleep','3']
    expect(slow[0]).toMatch(/SLOW `security` op: \d{4,}ms/)
    expect(slow[0]).not.toMatch(/TIMED OUT/)
  })

  it('runSecurity marks the log TIMED OUT when the spawn is killed by its own timeout', () => {
    const seen: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => {
      seen.push(String(m))
    })
    try {
      // Killed at 2700ms > the 2500ms log threshold, so it both logs AND carries the timeout mark.
      runSecurity(['sleep', '30'], { timeoutMs: 2700 })
    } finally {
      spy.mockRestore()
    }
    const slow = seen.filter(l => l.includes('SLOW `security` op'))
    expect(slow).toHaveLength(1)
    expect(slow[0]).toMatch(/TIMED OUT/)
    expect(slow[0]).toMatch(/timeout 2700ms/)
  })

  // NEUTER (2026-08-26 — OBSERVED via scripts/dev/neuter, restore verified by blob hash). The
  // mutation restores the EXACT shipped bug rather than merely disabling the guard:
  //   s/  return `verb=${verb}...`/  return argv.join(" ")/   → 3 red / 19 green:
  //       describeSecurityArgv NEVER emits the secret from a STORE argv
  //       describeSecurityArgv describes a RETRIEVE argv without the -w flag leaking a value
  //       runSecurity LOGS elapsed + argv for a spawn at/over the slow threshold
  // So these tests would have caught the original leak, which is the only property worth pinning.
  // THE LEAK GUARD. The first draft of the slow-op log printed `argv.join(' ')`, which would have
  // written a live OAuth token to pm2-error.log on any slow WRITE: `macosStoreArgv` carries the
  // secret ON ARGV as `-w <secret>` (deliberately — the stdin form truncates at 128 bytes), while
  // `macosRetrieveArgv`'s `-w` is a valueless "print the password" flag. Same flag, opposite
  // meaning. This asserts the description is an ALLOWLIST, so no argv shape can leak through it.
  it('describeSecurityArgv NEVER emits the secret from a STORE argv', () => {
    const secret = 'sk-ant-oat01-THIS-MUST-NEVER-BE-LOGGED'
    const line = describeSecurityArgv(macosStoreArgv('svc-x', 'acct-y', secret))
    expect(line).not.toContain(secret)
    expect(line).not.toContain('sk-ant')
    // ...and it still answers the question the log exists for: WHICH item blocked.
    expect(line).toContain('verb=add-generic-password')
    expect(line).toContain('service=svc-x')
    expect(line).toContain('account=acct-y')
  })

  it('describeSecurityArgv describes a RETRIEVE argv without the -w flag leaking a value', () => {
    const line = describeSecurityArgv(macosRetrieveArgv('svc-r', 'acct-r'))
    expect(line).toBe('verb=find-generic-password service=svc-r account=acct-r')
  })

  it('runSecurity stays SILENT for a fast spawn (a healthy box logs nothing)', () => {
    const seen: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => {
      seen.push(String(m))
    })
    try {
      const run = runSecurity(['true'])
      expect(run.spawned).toBe(true)
    } finally {
      spy.mockRestore()
    }
    expect(seen.filter(l => l.includes('SLOW `security` op'))).toHaveLength(0)
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
