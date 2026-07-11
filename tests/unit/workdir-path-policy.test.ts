/**
 * The forbidden-directory policy (TRDD-QMD7X3FB).
 *
 * The USER's directive: no agent may have `/` or `$HOME` as its working directory.
 *
 * These are the cases that must NEVER regress. Each one is a directory an agent was
 * never handed, and since the shell guard permits writes anywhere UNDER the workdir,
 * the workdir IS the write boundary — so `/` means the filesystem, `$HOME` means every
 * project and dotfile the user owns, and the install tree means the server rebuilding
 * itself from inside the agent it is running.
 *
 * The empty case is here for a reason that is easy to miss: an absent workdir used to
 * fall back to `process.cwd()`, the server's own directory. So `/` was refused while
 * "" quietly granted something worse. Absence must be a refusal, never a fallback.
 */
import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { join, resolve } from 'path'
import {
  checkWorkdirPathPolicy,
  AGENTS_ROOT,
  INSTALL_ROOT,
} from '@/lib/workdir-path-policy'

const HOME = homedir()

describe('forbidden working directories — these must never regress', () => {
  it('refuses the filesystem root', () => {
    const v = checkWorkdirPathPolicy('/')
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/filesystem root/)
  })

  it('refuses $HOME itself', () => {
    const v = checkWorkdirPathPolicy(HOME)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/\$HOME/)
  })

  it('refuses $HOME reached via ~ and via traversal', () => {
    expect(checkWorkdirPathPolicy('~').ok).toBe(false)
    expect(checkWorkdirPathPolicy(join(AGENTS_ROOT, '..')).ok).toBe(false)
  })

  it('refuses the filesystem root reached via traversal', () => {
    expect(checkWorkdirPathPolicy(join(AGENTS_ROOT, '..', '..', '..', '..')).ok).toBe(false)
  })

  it('refuses the user-data roots', () => {
    for (const d of ['Desktop', 'Documents', 'Downloads', 'Library']) {
      const v = checkWorkdirPathPolicy(join(HOME, d))
      expect(v.ok, d).toBe(false)
    }
  })

  it('refuses the ai-maestro install tree (an agent must not rebuild its own server)', () => {
    const v = checkWorkdirPathPolicy(INSTALL_ROOT)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/recursion/)
  })

  it('refuses anything outside $HOME', () => {
    expect(checkWorkdirPathPolicy('/tmp/evil').ok).toBe(false)
    expect(checkWorkdirPathPolicy('/Volumes/external/project').ok).toBe(false)
  })

  it('refuses an EMPTY workdir — it would inherit the server\'s own directory', () => {
    // The bypass this closes: `/` was refused, but "" fell back to process.cwd(),
    // which IS the install tree. Refusing the named directory while granting it
    // through the unnamed one is not a policy.
    for (const empty of ['', '   ', undefined, null]) {
      const v = checkWorkdirPathPolicy(empty as unknown as string)
      expect(v.ok, JSON.stringify(empty)).toBe(false)
      expect(v.reason).toMatch(/required/)
    }
  })
})

describe('permitted working directories', () => {
  it('permits ~/agents/<name> (the canonical home)', () => {
    expect(checkWorkdirPathPolicy(join(AGENTS_ROOT, 'peter-bot')).ok).toBe(true)
  })

  it('permits ~/agents/ itself', () => {
    expect(checkWorkdirPathPolicy(AGENTS_ROOT).ok).toBe(true)
  })

  it('permits an adopted project under $HOME (the MAINTAINER case)', () => {
    // ~/Code/<project> is the whole point of external adoption (TRDD-57EBNB72) —
    // the policy must not become so strict that it forbids the feature it guards.
    expect(checkWorkdirPathPolicy(join(HOME, 'Code', 'some-plugin')).ok).toBe(true)
  })

  it('resolves ~ in a permitted path', () => {
    expect(checkWorkdirPathPolicy('~/agents/foo').ok).toBe(true)
    expect(resolve(join(HOME, 'agents', 'foo'))).toBe(join(AGENTS_ROOT, 'foo'))
  })
})
