/**
 * Tests for lib/workdir-gitignore-seed.ts (TRDD-57EBNB72) — the managed
 * .gitignore block that protects a git-repo agent workdir from ai-maestro's
 * in-workdir writes (DEP rules, settings.local.json, runtime artifacts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ensureWorkdirGitignore,
  GITIGNORE_BLOCK_BEGIN,
  GITIGNORE_BLOCK_END,
  MANAGED_GITIGNORE_ENTRIES,
} from '@/lib/workdir-gitignore-seed'

let workdir: string

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'gitignore-workdir-'))
})

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true })
})

describe('ensureWorkdirGitignore', () => {
  it('is a no-op (skipped) when the workdir is not a git repo', async () => {
    const result = await ensureWorkdirGitignore(workdir)
    expect(result.skipped).toBe(true)
    expect(existsSync(join(workdir, '.gitignore'))).toBe(false)
  })

  it('creates .gitignore with the full managed block when .git is a DIRECTORY', async () => {
    mkdirSync(join(workdir, '.git'))
    const result = await ensureWorkdirGitignore(workdir)
    expect(result.created).toBe(true)
    const content = readFileSync(join(workdir, '.gitignore'), 'utf-8')
    expect(content.startsWith(GITIGNORE_BLOCK_BEGIN)).toBe(true)
    expect(content.trimEnd().endsWith(GITIGNORE_BLOCK_END)).toBe(true)
    for (const entry of MANAGED_GITIGNORE_ENTRIES) {
      expect(content).toContain(entry)
    }
  })

  it('also runs when .git is a FILE (linked worktree / submodule)', async () => {
    writeFileSync(join(workdir, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n')
    const result = await ensureWorkdirGitignore(workdir)
    expect(result.created).toBe(true)
    expect(readFileSync(join(workdir, '.gitignore'), 'utf-8')).toContain('.janitor/')
  })

  it('appends the block after existing user content, preserving it byte-for-byte', async () => {
    mkdirSync(join(workdir, '.git'))
    const user = '# my repo\nnode_modules/\ndist/\n'
    writeFileSync(join(workdir, '.gitignore'), user)
    const result = await ensureWorkdirGitignore(workdir)
    expect(result.updated).toBe(true)
    const content = readFileSync(join(workdir, '.gitignore'), 'utf-8')
    expect(content.startsWith(user)).toBe(true)
    expect(content).toContain(GITIGNORE_BLOCK_BEGIN)
  })

  it('dedupes entries the user already lists outside the block', async () => {
    mkdirSync(join(workdir, '.git'))
    writeFileSync(join(workdir, '.gitignore'), 'reports/\nreports_dev/\n')
    await ensureWorkdirGitignore(workdir)
    const content = readFileSync(join(workdir, '.gitignore'), 'utf-8')
    // present once (the user's copy), not repeated inside the managed block
    expect(content.match(/^reports\/$/gm)?.length).toBe(1)
    expect(content.match(/^reports_dev\/$/gm)?.length).toBe(1)
    expect(content).toContain('.janitor/') // non-duplicated entries still added
  })

  it('is content-idempotent — a second call reports unchanged and rewrites nothing', async () => {
    mkdirSync(join(workdir, '.git'))
    await ensureWorkdirGitignore(workdir)
    const first = readFileSync(join(workdir, '.gitignore'), 'utf-8')
    const second = await ensureWorkdirGitignore(workdir)
    expect(second.unchanged).toBe(true)
    expect(readFileSync(join(workdir, '.gitignore'), 'utf-8')).toBe(first)
  })

  it('regenerates a STALE managed block in place (old entry sets heal on wake)', async () => {
    mkdirSync(join(workdir, '.git'))
    const stale = `keep-me-above\n${GITIGNORE_BLOCK_BEGIN}\nold-entry-from-v1/\n${GITIGNORE_BLOCK_END}\nkeep-me-below\n`
    writeFileSync(join(workdir, '.gitignore'), stale)
    const result = await ensureWorkdirGitignore(workdir)
    expect(result.updated).toBe(true)
    const content = readFileSync(join(workdir, '.gitignore'), 'utf-8')
    expect(content).not.toContain('old-entry-from-v1/')
    expect(content).toContain('keep-me-above')
    expect(content).toContain('keep-me-below')
    expect(content).toContain('.claude/settings.local.json')
    // exactly one managed block
    expect(content.split(GITIGNORE_BLOCK_BEGIN).length).toBe(2)
  })

  it('never lists .claude/settings.json or CLAUDE.md (tracked-file masking hazard)', () => {
    expect(MANAGED_GITIGNORE_ENTRIES).not.toContain('.claude/settings.json')
    expect(MANAGED_GITIGNORE_ENTRIES).not.toContain('CLAUDE.md')
  })
})
