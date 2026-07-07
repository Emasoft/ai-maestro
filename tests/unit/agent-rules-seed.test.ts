/**
 * Tests for lib/agent-rules-seed.ts (TRDD-DE9757LJ) — the server-side
 * seeder that copies the DEP governance-rule overlay into an agent
 * workdir's .claude/rules/ with content-idempotent, marker-guarded writes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureAgentRules, DEP_RULE_MARKER } from '@/lib/agent-rules-seed'

let sourceDir: string
let workdir: string

const RULE_A = `<!-- ${DEP_RULE_MARKER} -->\n\n# Rule A\n\nbody A\n`
const RULE_B = `<!-- ${DEP_RULE_MARKER} -->\n\n# Rule B\n\nbody B\n`

beforeEach(() => {
  sourceDir = mkdtempSync(join(tmpdir(), 'dep-rules-src-'))
  workdir = mkdtempSync(join(tmpdir(), 'dep-rules-workdir-'))
  writeFileSync(join(sourceDir, 'aimaestro-a.md'), RULE_A)
  writeFileSync(join(sourceDir, 'aimaestro-b.md'), RULE_B)
  writeFileSync(join(sourceDir, 'not-a-rule.txt'), 'ignored — not .md')
})

afterEach(() => {
  rmSync(sourceDir, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
})

describe('ensureAgentRules', () => {
  it('seeds every shipped .md rule into <workdir>/.claude/rules/ on first run', async () => {
    const result = await ensureAgentRules(workdir, sourceDir)
    expect(result.seeded.sort()).toEqual(['aimaestro-a.md', 'aimaestro-b.md'])
    expect(result.updated).toEqual([])
    expect(result.preserved).toEqual([])
    expect(readFileSync(join(workdir, '.claude', 'rules', 'aimaestro-a.md'), 'utf-8')).toBe(RULE_A)
    expect(existsSync(join(workdir, '.claude', 'rules', 'not-a-rule.txt'))).toBe(false)
  })

  it('is a no-op on the second call (content-idempotent)', async () => {
    await ensureAgentRules(workdir, sourceDir)
    const second = await ensureAgentRules(workdir, sourceDir)
    expect(second.seeded).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.unchanged.sort()).toEqual(['aimaestro-a.md', 'aimaestro-b.md'])
  })

  it('re-seeds a marker-stamped file whose bytes drifted (stale copy refresh)', async () => {
    await ensureAgentRules(workdir, sourceDir)
    const dest = join(workdir, '.claude', 'rules', 'aimaestro-a.md')
    writeFileSync(dest, `<!-- ${DEP_RULE_MARKER} -->\n\n# Rule A\n\nSTALE edited body\n`)
    const result = await ensureAgentRules(workdir, sourceDir)
    expect(result.updated).toEqual(['aimaestro-a.md'])
    expect(readFileSync(dest, 'utf-8')).toBe(RULE_A)
  })

  it('never touches a same-named file WITHOUT the marker (user-owned)', async () => {
    const rulesDir = join(workdir, '.claude', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    const userContent = '# My own hand-written rule with the same name\n'
    writeFileSync(join(rulesDir, 'aimaestro-a.md'), userContent)
    const result = await ensureAgentRules(workdir, sourceDir)
    expect(result.preserved).toEqual(['aimaestro-a.md'])
    expect(result.seeded).toEqual(['aimaestro-b.md'])
    expect(readFileSync(join(rulesDir, 'aimaestro-a.md'), 'utf-8')).toBe(userContent)
  })

  it('degrades to an empty no-op result when the source dir is missing (never blocks a wake)', async () => {
    const result = await ensureAgentRules(workdir, join(sourceDir, 'does-not-exist'))
    expect(result).toEqual({ seeded: [], updated: [], unchanged: [], preserved: [] })
    expect(existsSync(join(workdir, '.claude', 'rules'))).toBe(false)
  })
})
