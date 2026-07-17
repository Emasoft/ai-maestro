import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  TEST_ONLY_ENV,
  isTestRunner,
  testOnlyEnv,
  ignoredTestEnvNames,
  reportIgnoredTestEnv,
  resetTestOnlyEnvStateForTests,
} from '@/lib/test-only-env'

/**
 * Test-only env hatches (TRDD-CC9PY337). 0-IMPACT: only vi.stubEnv — no filesystem, no
 * keychain, no network.
 *
 * The property: a hatch is honored ONLY in the test runner. Not in release, and — the part the
 * first cut got wrong — not in development either, since a dev box runs agents under the same
 * UID as the server and is exactly as exposed to a stray `export` in a shell profile.
 */
beforeEach(() => {
  resetTestOnlyEnvStateForTests()
  // Neutralize anything the dev shell exports, so a developer's real environment cannot make
  // these pass or fail by accident.
  for (const k of Object.keys(TEST_ONLY_ENV)) vi.stubEnv(k, '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetTestOnlyEnvStateForTests()
})

describe('isTestRunner', () => {
  it('vitest really does set NODE_ENV=test — the assumption the whole module rests on', () => {
    // NOT stubbed: this reads the runner's own environment. vitest.config.ts does not set
    // NODE_ENV, so this is vitest's own default. If an upstream change ever drops it, every
    // hatch silently stops working and the suite starts writing to the developer's REAL
    // keychain — a worse outcome than the vector this module closes. Fail loudly here instead.
    expect(process.env.NODE_ENV).toBe('test')
    expect(isTestRunner()).toBe(true)
  })

  it('is false for development and production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(isTestRunner()).toBe(false)
    vi.stubEnv('NODE_ENV', 'production')
    expect(isTestRunner()).toBe(false)
    vi.stubEnv('NODE_ENV', '') // `yarn dev` leaves it unset
    expect(isTestRunner()).toBe(false)
  })
})

describe('testOnlyEnv — the test runner honors the hatch', () => {
  it('returns the value and logs nothing', () => {
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/test-reader')
    // The 0-IMPACT discipline depends on this: a test must be able to redirect the store.
    expect(testOnlyEnv('AIM_JSONL_READER_PATH')).toBe('/tmp/test-reader')
    expect(console.warn).not.toHaveBeenCalled()
    expect(ignoredTestEnvNames()).toEqual([])
  })
})

describe('testOnlyEnv — DEVELOPMENT ignores the hatch (a dev box is not safe either)', () => {
  it('returns undefined so the caller falls back to its safe built-in default', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/evil')
    // The release-gated first cut HONORED this. Agents run on dev boxes too.
    expect(testOnlyEnv('AIM_JSONL_READER_PATH')).toBeUndefined()
    expect(ignoredTestEnvNames()).toEqual(['AIM_JSONL_READER_PATH'])
  })

  it('ignores the plaintext-downgrade backend in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    expect(testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')).toBeUndefined()
  })

  it('ignores a keychain redirect when NODE_ENV is unset, as `yarn dev` leaves it', () => {
    vi.stubEnv('NODE_ENV', '')
    vi.stubEnv('JANITOR_ROTATOR_KEYCHAIN', '/tmp/evil.keychain')
    expect(testOnlyEnv('JANITOR_ROTATOR_KEYCHAIN')).toBeUndefined()
  })
})

describe('testOnlyEnv — RELEASE ignores the hatch', () => {
  it('ignores the plaintext-downgrade backend', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    expect(testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')).toBeUndefined()
  })

  it('ignores an RCE-capable binary redirect', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/evil')
    expect(testOnlyEnv('AIM_JSONL_READER_PATH')).toBeUndefined()
  })
})

describe('testOnlyEnv — logging', () => {
  it('logs the reason exactly once per var, however many times it is read', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')
    testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')
    testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')
    // Once: a var read in a hot path must not flood the log and bury the evidence.
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('plaintext')
  })

  it('an unset var is not an event — returns undefined and logs nothing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')).toBeUndefined()
    expect(console.warn).not.toHaveBeenCalled()
    expect(ignoredTestEnvNames()).toEqual([])
  })
})

describe('reportIgnoredTestEnv — boot-time tamper evidence', () => {
  it('a clean host reports nothing', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(reportIgnoredTestEnv()).toEqual([])
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('names every ignored hatch so an affected host is visibly different from a clean one', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/evil')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    expect(reportIgnoredTestEnv()).toEqual(['AIM_JSONL_READER_PATH', 'CLAUDE_SAFE_STORAGE_BACKEND'])
  })

  it('reports nothing in the test runner, where the hatches are legitimate', () => {
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/test-reader')
    expect(reportIgnoredTestEnv()).toEqual([])
  })
})

describe('TEST_ONLY_ENV registry', () => {
  it('every entry states a concrete risk, so the log line explains itself', () => {
    for (const [name, meta] of Object.entries(TEST_ONLY_ENV)) {
      expect(meta.risk, `${name} needs a risk description`).toBeTruthy()
      expect(meta.risk.length, `${name} risk is too terse to act on`).toBeGreaterThan(20)
    }
  })

  it('holds no var that has a dashboard equivalent — those are DELETED, not gated', () => {
    // AIM_SMTP_* is the worked example: the dashboard owns the relay, so the env read was
    // removed outright (phase 1) rather than listed here. Re-adding one would mean an
    // account-takeover vector had been demoted from "deleted" to "merely gated".
    const deleted = ['AIM_SMTP_HOST', 'AIM_SMTP_PORT', 'AIM_SMTP_USER', 'AIM_SMTP_PASS',
      'AIM_SMTP_FROM', 'AIM_SMTP_SECURE']
    for (const name of deleted) {
      expect(Object.keys(TEST_ONLY_ENV), `${name} must stay deleted, not gated`).not.toContain(name)
    }
  })

  it('holds no ordinary operational var — gating those breaks deployments, buys no security', () => {
    const operational = ['PORT', 'HOSTNAME', 'MAESTRO_MODE', 'NODE_ENV', 'AIMAESTRO_ORG',
      'NOTIFICATIONS_ENABLED', 'ENABLE_LOGGING', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY']
    for (const name of operational) {
      expect(Object.keys(TEST_ONLY_ENV), `${name} must stay configurable`).not.toContain(name)
    }
  })

  it('is frozen — the hatch set is not mutable at runtime', () => {
    expect(Object.isFrozen(TEST_ONLY_ENV)).toBe(true)
    // A registry the running process could edit would be theater.
    expect(() => {
      ;(TEST_ONLY_ENV as Record<string, unknown>).AIM_JSONL_READER_PATH = { risk: 'neutered' }
    }).toThrow()
  })
})
