import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  GUARDED_ENV,
  isReleaseMode,
  guardedEnv,
  ignoredEnvNames,
  reportIgnoredEnv,
  resetGuardStateForTests,
} from '@/lib/release-env-guard'

/**
 * Release-mode env guard. 0-IMPACT: only vi.stubEnv, no filesystem, no keychain, no network.
 *
 * The property under test is narrow and load-bearing: a development-only override is HONORED in
 * development and IGNORED in release, so a stray `export` in a shell profile cannot silently
 * downgrade a credential store or redirect a spawned binary on a production host.
 */
beforeEach(() => {
  resetGuardStateForTests()
  // Neutralize anything the dev shell exports, so a developer's real environment cannot make
  // these pass or fail by accident.
  for (const k of Object.keys(GUARDED_ENV)) vi.stubEnv(k, '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetGuardStateForTests()
})

describe('isReleaseMode', () => {
  it('is true only for NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(isReleaseMode()).toBe(true)
    vi.stubEnv('NODE_ENV', 'development')
    expect(isReleaseMode()).toBe(false)
    vi.stubEnv('NODE_ENV', '')
    expect(isReleaseMode()).toBe(false) // `yarn dev` leaves it unset
  })
})

describe('guardedEnv — development honors the override', () => {
  it('returns the value and logs nothing', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/test-reader')
    // Tests depend on these hatches for 0-IMPACT isolation; the guard must not break them.
    expect(guardedEnv('AIM_JSONL_READER_PATH')).toBe('/tmp/test-reader')
    expect(console.warn).not.toHaveBeenCalled()
    expect(ignoredEnvNames()).toEqual([])
  })
})

describe('guardedEnv — release ignores the override', () => {
  it('returns undefined so the caller falls back to its safe built-in default', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/evil')
    expect(guardedEnv('AIM_JSONL_READER_PATH')).toBeUndefined()
    expect(ignoredEnvNames()).toEqual(['AIM_JSONL_READER_PATH'])
  })

  it('ignores the plaintext-downgrade backend', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    expect(guardedEnv('CLAUDE_SAFE_STORAGE_BACKEND')).toBeUndefined()
  })

  it('ignores an SMTP relay redirect', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AIM_SMTP_HOST', 'relay.evil.example')
    expect(guardedEnv('AIM_SMTP_HOST')).toBeUndefined()
  })

  it('logs the reason exactly once per var, however many times it is read', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    guardedEnv('CLAUDE_SAFE_STORAGE_BACKEND')
    guardedEnv('CLAUDE_SAFE_STORAGE_BACKEND')
    guardedEnv('CLAUDE_SAFE_STORAGE_BACKEND')
    // Once: a var read in a hot path must not flood the log and bury the evidence.
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('plaintext')
  })

  it('an unset var is not an event — returns undefined and logs nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(guardedEnv('AIM_SMTP_HOST')).toBeUndefined()
    expect(console.warn).not.toHaveBeenCalled()
    expect(ignoredEnvNames()).toEqual([])
  })
})

describe('the gate cannot be unlocked by the vector it defends against', () => {
  it('a NODE_ENV=development export does not re-enable overrides under PM2', async () => {
    // The whole guard rests on this: PM2's `env` block sets NODE_ENV=production explicitly, so
    // the shell profile carrying `export CLAUDE_SAFE_STORAGE_BACKEND=none` cannot also carry
    // `export NODE_ENV=development` to defeat it — PM2 overwrites the inherited value. Here we
    // simulate the post-PM2 environment: production wins, and the override stays ignored.
    vi.stubEnv('NODE_ENV', 'production') // what PM2 sets, overriding any inherited value
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none') // what the dotfile exported
    expect(guardedEnv('CLAUDE_SAFE_STORAGE_BACKEND')).toBeUndefined()
  })
})

describe('reportIgnoredEnv — boot-time tamper evidence', () => {
  it('a clean release host reports nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(reportIgnoredEnv()).toEqual([])
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('names every ignored var so an attacked host is visibly different from a clean one', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/evil')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    expect(reportIgnoredEnv()).toEqual(['AIM_JSONL_READER_PATH', 'CLAUDE_SAFE_STORAGE_BACKEND'])
  })

  it('reports nothing in development, where the overrides are legitimate', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/test-reader')
    expect(reportIgnoredEnv()).toEqual([])
  })
})

describe('GUARDED_ENV registry', () => {
  it('every entry states a concrete risk, so the log line explains itself', async () => {
    for (const [name, meta] of Object.entries(GUARDED_ENV)) {
      expect(meta.risk, `${name} needs a risk description`).toBeTruthy()
      expect(meta.risk.length, `${name} risk is too terse to act on`).toBeGreaterThan(20)
    }
  })

  it('does NOT guard operational vars — gating those breaks deployments and buys no security', async () => {
    const operational = ['PORT', 'HOSTNAME', 'MAESTRO_MODE', 'NODE_ENV', 'AIMAESTRO_ORG',
      'NOTIFICATIONS_ENABLED', 'ENABLE_LOGGING', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY']
    for (const name of operational) {
      expect(Object.keys(GUARDED_ENV), `${name} must stay configurable`).not.toContain(name)
    }
  })

  it('is frozen — the guarded set is not mutable at runtime', async () => {
    expect(Object.isFrozen(GUARDED_ENV)).toBe(true)
    // A guard whose own registry could be edited at runtime would be theater.
    expect(() => {
      ;(GUARDED_ENV as Record<string, unknown>).AIM_JSONL_READER_PATH = { risk: 'neutered' }
    }).toThrow()
  })
})
