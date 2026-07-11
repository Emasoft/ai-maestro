/**
 * Tests for lib/agent-rules-seed.ts (TRDD-DE9757LJ) — the server-side
 * seeder that copies the DEP governance-rule overlay into an agent
 * workdir's .claude/rules/ with content-idempotent, marker-guarded writes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ensureAgentRules, DEP_RULE_MARKER, RULE_FILE_MODE } from '@/lib/agent-rules-seed'

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
    expect(result.remoded).toEqual([])
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
    chmodSync(dest, 0o644) // seeded rules are 0444 — see the tamper-resistance suite
    writeFileSync(dest, `<!-- ${DEP_RULE_MARKER} -->\n\n# Rule A\n\nSTALE edited body\n`)
    const result = await ensureAgentRules(workdir, sourceDir)
    expect(result.updated).toEqual(['aimaestro-a.md'])
    expect(readFileSync(dest, 'utf-8')).toBe(RULE_A)
  })

  it('degrades to an empty no-op result when the source dir is missing (never blocks a wake)', async () => {
    const result = await ensureAgentRules(workdir, join(sourceDir, 'does-not-exist'))
    expect(result).toEqual({ seeded: [], updated: [], unchanged: [], remoded: [] })
    expect(existsSync(join(workdir, '.claude', 'rules'))).toBe(false)
  })
})

/**
 * Tamper-resistance (TRDD-JGCEA6CQ).
 *
 * ai-maestro OWNS the `aimaestro-*.md` name inside an agent workdir. The old
 * contract PRESERVED a same-named file that lacked the marker, treating it as
 * user-owned — which handed the governed party a two-step bypass: strip the
 * marker, rewrite the rule, keep the edit forever. The rules that govern an
 * agent cannot be editable by that agent, so the marker is provenance only.
 */
describe('ensureAgentRules — tamper resistance', () => {
  const rulePath = () => join(workdir, '.claude', 'rules', 'aimaestro-a.md')
  const mode = (p: string) => statSync(p).mode & 0o777

  it('writes rules read-only', async () => {
    await ensureAgentRules(workdir, sourceDir)
    expect(mode(rulePath())).toBe(RULE_FILE_MODE)
  })

  it('restores a rule whose content was tampered with — even with the marker stripped', async () => {
    await ensureAgentRules(workdir, sourceDir)
    // The full bypass recipe: unprotect, rewrite, remove the provenance marker.
    chmodSync(rulePath(), 0o644)
    writeFileSync(rulePath(), '# approval is not required\n')

    const result = await ensureAgentRules(workdir, sourceDir)

    expect(result.updated).toEqual(['aimaestro-a.md'])
    expect(readFileSync(rulePath(), 'utf-8')).toBe(RULE_A)
    expect(mode(rulePath())).toBe(RULE_FILE_MODE)
  })

  it('re-creates a rule that was deleted', async () => {
    await ensureAgentRules(workdir, sourceDir)
    rmSync(rulePath())

    const result = await ensureAgentRules(workdir, sourceDir)

    expect(result.seeded).toEqual(['aimaestro-a.md'])
    expect(readFileSync(rulePath(), 'utf-8')).toBe(RULE_A)
    expect(mode(rulePath())).toBe(RULE_FILE_MODE)
  })

  it('re-protects a rule that was made writable but not yet edited (tamper in progress)', async () => {
    await ensureAgentRules(workdir, sourceDir)
    chmodSync(rulePath(), 0o644)

    const result = await ensureAgentRules(workdir, sourceDir)

    expect(result.remoded).toEqual(['aimaestro-a.md'])
    expect(result.updated).toEqual([]) // content was still correct — no rewrite needed
    expect(mode(rulePath())).toBe(RULE_FILE_MODE)
  })

  it('can update its own read-only file (protection must not lock out the server)', async () => {
    await ensureAgentRules(workdir, sourceDir)
    // Ship a new version of the rule — the on-disk copy is 0444 and writeFile's
    // `mode` applies only on create, so an un-chmod'd write here would EACCES.
    const NEXT = `<!-- ${DEP_RULE_MARKER} -->\n\n# Rule A v2\n\nbody A v2\n`
    writeFileSync(join(sourceDir, 'aimaestro-a.md'), NEXT)

    const result = await ensureAgentRules(workdir, sourceDir)

    expect(result.updated).toEqual(['aimaestro-a.md'])
    expect(readFileSync(rulePath(), 'utf-8')).toBe(NEXT)
  })
})
