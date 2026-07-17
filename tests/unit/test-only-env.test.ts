import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  TEST_ONLY_ENV,
  FORBIDDEN_ENV,
  isTestRunner,
  testOnlyEnv,
  ignoredTestEnvNames,
  reportIgnoredTestEnv,
  resetTestOnlyEnvStateForTests,
} from '@/lib/test-only-env'

/**
 * Test-only env hatches (TRDD-CC9PY337). 0-IMPACT: only vi.stubEnv + read-only source scans —
 * no filesystem writes, no keychain, no network.
 *
 * The property: a GATED hatch is honored ONLY in the test runner. Not in release, and — the part
 * the first cut got wrong — not in development either, since a dev box runs agents under the same
 * UID as the server and is exactly as exposed to a stray `export` in a shell profile. A FORBIDDEN
 * name is honored NOWHERE (its read was deleted); it exists only for the fence + tamper-evidence.
 */
beforeEach(() => {
  resetTestOnlyEnvStateForTests()
  // Neutralize anything the dev shell exports, so a developer's real environment cannot make
  // these pass or fail by accident.
  for (const k of [...Object.keys(TEST_ONLY_ENV), ...Object.keys(FORBIDDEN_ENV)]) vi.stubEnv(k, '')
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
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    // The 0-IMPACT discipline depends on this: a test must be able to force the plaintext path.
    expect(testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')).toBe('none')
    expect(console.warn).not.toHaveBeenCalled()
    expect(ignoredTestEnvNames()).toEqual([])
  })
})

describe('testOnlyEnv — DEVELOPMENT ignores the hatch (a dev box is not safe either)', () => {
  it('returns undefined so the caller falls back to its safe built-in default', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    // The release-gated first cut HONORED this. Agents run on dev boxes too.
    expect(testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')).toBeUndefined()
    expect(ignoredTestEnvNames()).toEqual(['CLAUDE_SAFE_STORAGE_BACKEND'])
  })

  it('ignores a keychain redirect when NODE_ENV is unset, as `yarn dev` leaves it', () => {
    vi.stubEnv('NODE_ENV', '')
    vi.stubEnv('JANITOR_ROTATOR_KEYCHAIN', '/tmp/evil.keychain')
    expect(testOnlyEnv('JANITOR_ROTATOR_KEYCHAIN')).toBeUndefined()
  })

  it('ignores a state-dir redirect in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('JANITOR_GLOBAL_STATE_DIR', '/tmp/evil-state')
    expect(testOnlyEnv('JANITOR_GLOBAL_STATE_DIR')).toBeUndefined()
  })
})

describe('testOnlyEnv — RELEASE ignores the hatch', () => {
  it('ignores the plaintext-downgrade backend', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    expect(testOnlyEnv('CLAUDE_SAFE_STORAGE_BACKEND')).toBeUndefined()
  })

  it('ignores the SMTP file-backend downgrade', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AIM_SMTP_CRED_BACKEND', 'file')
    expect(testOnlyEnv('AIM_SMTP_CRED_BACKEND')).toBeUndefined()
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

  it('names every ignored gated hatch so an affected host is visibly different from a clean one', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    vi.stubEnv('JANITOR_ROTATOR_KEYCHAIN', '/tmp/evil.keychain')
    expect(reportIgnoredTestEnv()).toEqual(['CLAUDE_SAFE_STORAGE_BACKEND', 'JANITOR_ROTATOR_KEYCHAIN'])
  })

  it('also names a FORBIDDEN (deleted) name that is present — inert, but a tamper signal', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AIM_JSONL_READER_PATH', '/tmp/evil')
    // Nothing reads AIM_JSONL_READER_PATH anymore, but its presence means someone exported a name
    // AI Maestro deleted on purpose — the boot summary surfaces it beside the gated ones.
    expect(reportIgnoredTestEnv()).toEqual(['AIM_JSONL_READER_PATH'])
  })

  it('merges gated + forbidden into one sorted, de-duplicated list', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    vi.stubEnv('OPENCLAW_TMUX_SOCKET_DIR', '/tmp/evil-sockets')
    expect(reportIgnoredTestEnv()).toEqual(['CLAUDE_SAFE_STORAGE_BACKEND', 'OPENCLAW_TMUX_SOCKET_DIR'])
  })

  it('reports nothing in the test runner, where the gated hatches are legitimate', () => {
    vi.stubEnv('CLAUDE_SAFE_STORAGE_BACKEND', 'none')
    expect(reportIgnoredTestEnv()).toEqual([])
  })
})

describe('registry invariants', () => {
  it('every gated + forbidden entry states a concrete risk, so the log line explains itself', () => {
    for (const [name, meta] of [...Object.entries(TEST_ONLY_ENV), ...Object.entries(FORBIDDEN_ENV)]) {
      expect(meta.risk, `${name} needs a risk description`).toBeTruthy()
      expect(meta.risk.length, `${name} risk is too terse to act on`).toBeGreaterThan(20)
    }
  })

  it('TEST_ONLY_ENV and FORBIDDEN_ENV are DISJOINT — a var is a live seam OR a deleted hatch, never both', () => {
    const gated = new Set(Object.keys(TEST_ONLY_ENV))
    const overlap = Object.keys(FORBIDDEN_ENV).filter((n) => gated.has(n))
    expect(overlap, `these names are in both registries: ${overlap.join(', ')}`).toEqual([])
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

  it('both registries are frozen — the name sets are not mutable at runtime', () => {
    expect(Object.isFrozen(TEST_ONLY_ENV)).toBe(true)
    expect(Object.isFrozen(FORBIDDEN_ENV)).toBe(true)
    // A registry the running process could edit would be theater.
    expect(() => {
      ;(FORBIDDEN_ENV as Record<string, unknown>).AIM_JSONL_READER_PATH = { risk: 'neutered' }
    }).toThrow()
  })
})

/**
 * THE REGRESSION FENCE — the durable value of this whole TRDD (CC9PY337).
 *
 * No dangerous name (gated or forbidden) may be read via a bare `process.env.<NAME>` anywhere in
 * the server-side source. The ONLY legal reader is test-only-env.ts itself, via the COMPUTED form
 * `process.env[name]` — which this literal-anchored scan does not match. So any hit is a
 * re-introduced hatch: a gated var must go through testOnlyEnv(), a forbidden var must not be read
 * at all.
 *
 * A Node-fs walk, deliberately NOT grep/git-grep: a security fence must not depend on a grep
 * dialect (BSD vs GNU `\b`) or on whether a newly-added file has been `git add`-ed yet — an
 * untracked file with a hatch is exactly the case a fence must still catch.
 */
describe('regression fence — no dangerous env name read via bare process.env in server source', () => {
  const REPO_ROOT = process.cwd()
  const SCAN_ROOTS = ['lib', 'services', 'app']
  const SELF = path.join('lib', 'test-only-env.ts') // the one legal (computed) reader
  const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js'])

  function walk(dir: string, out: string[]): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue
        walk(full, out)
      } else if (EXTS.has(path.extname(e.name))) {
        out.push(full)
      }
    }
  }

  it('finds zero re-introduced hatches (fails with file:line if a contributor adds one)', () => {
    const files: string[] = []
    for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), files)
    expect(files.length, 'the scan matched no source files — walk is misconfigured').toBeGreaterThan(50)

    const names = [...Object.keys(TEST_ONLY_ENV), ...Object.keys(FORBIDDEN_ENV)]
    // Literal `process.env.<NAME>` where the next char is NOT an identifier char (so a longer name
    // that merely contains one of ours does not false-match). The computed `process.env[name]`
    // form in test-only-env.ts has a `[`, never a `.`, so it is not matched.
    const patterns = names.map((n) => ({
      name: n,
      re: new RegExp('process\\.env\\.' + n + '(?![A-Za-z0-9_])'),
    }))

    const offenders: string[] = []
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file)
      if (rel === SELF) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const { name, re } of patterns) {
          if (re.test(line)) offenders.push(`${rel}:${i + 1}  reads ${name} (route it through testOnlyEnv, or it is forbidden)`)
        }
      })
    }
    expect(offenders, `re-introduced env hatch(es):\n${offenders.join('\n')}`).toEqual([])
  })
})
