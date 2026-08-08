/**
 * The shipped agent-operating rule file + the fleet-wide sweep (TRDD-JGCEA6CQ).
 *
 * Two things are guarded here, and the first is the unusual one:
 *
 * A SIZE BUDGET. Every file in .claude/rules/ is injected into an agent's context
 * on EVERY turn, so a rule file's cost is (its size) × (turns) × (agents). That
 * makes growth the specific failure mode this file must be protected from — a rule
 * file nobody bounds accumulates prose until it is the largest thing in the
 * context it was meant to keep small. The budget is deliberately tight enough that
 * adding a paragraph trips it and forces the author to ask whether the paragraph
 * is worth what it costs on every turn of every agent, forever.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ensureAgentRulesForWorkdirs,
  DEP_RULE_MARKER,
  RULE_FILE_MODE,
} from '@/lib/agent-rules-seed'
import { MANAGED_GITIGNORE_ENTRIES } from '@/lib/workdir-gitignore-seed'

const RULES_SOURCE_DIR = join(process.cwd(), 'rules', 'aimaestro')
const AGENT_RULES_FILE = 'aimaestro-agent-rules.md'
const AGENT_RULES_PATH = join(RULES_SOURCE_DIR, AGENT_RULES_FILE)

/** ~2 KB ≈ 500 tokens. Raising this is a deliberate decision, not a rebase.
 *  2200 → 2280 (2026-08-08, TRDD-UZ9YT1SD): +1 line teaching cheap-delegation tiering —
 *  fleet-wide guidance whose token savings dwarf its ~100-byte carriage; landed with a
 *  25-byte trim elsewhere, so the net growth is 76 bytes against an 80-byte raise. */
const MAX_BYTES = 2280

describe('the shipped agent-operating rule file', () => {
  it('exists and carries the DEP marker so the seeder can refresh it', () => {
    const body = readFileSync(AGENT_RULES_PATH, 'utf-8')
    expect(body).toContain(DEP_RULE_MARKER)
  })

  it('stays inside its size budget (it is charged on every turn of every agent)', () => {
    const bytes = Buffer.byteLength(readFileSync(AGENT_RULES_PATH))
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES)
  })

  it('is named to match the managed git-exclude glob (else it dirties every adopted repo)', () => {
    // The glob is what keeps a seeded rule out of `git status` in an adopted
    // project repo. A file named e.g. `ai-maestro-rules.md` would NOT match
    // `.claude/rules/aimaestro-*.md` and would surface as untracked in every
    // agent's repo — the exact reason this name has no hyphen after "ai".
    expect(MANAGED_GITIGNORE_ENTRIES).toContain('.claude/rules/aimaestro-*.md')
    expect(AGENT_RULES_FILE.startsWith('aimaestro-')).toBe(true)
    expect(AGENT_RULES_FILE.endsWith('.md')).toBe(true)
  })

  it('states rules as single lines (WHAT, not HOW — no implementation prose)', () => {
    const bullets = readFileSync(AGENT_RULES_PATH, 'utf-8')
      .split('\n')
      .filter((l) => l.startsWith('- '))
    expect(bullets.length).toBeGreaterThan(8)
    // A bullet that wraps onto continuation lines is a paragraph wearing a bullet.
    for (const b of bullets) expect(b.length).toBeLessThanOrEqual(220)
  })
})

describe('ensureAgentRulesForWorkdirs (the boot sweep)', () => {
  let workdirs: string[]

  beforeEach(() => {
    workdirs = [
      mkdtempSync(join(tmpdir(), 'sweep-a-')),
      mkdtempSync(join(tmpdir(), 'sweep-b-')),
    ]
  })

  afterEach(() => {
    for (const w of workdirs) rmSync(w, { recursive: true, force: true })
  })

  it('seeds the real shipped rules into every workdir it is given', async () => {
    const sweep = await ensureAgentRulesForWorkdirs(workdirs)
    expect(sweep.scanned).toBe(2)
    expect(sweep.seeded).toBe(2)
    expect(sweep.failed).toEqual([])
    for (const w of workdirs) {
      expect(existsSync(join(w, '.claude', 'rules', AGENT_RULES_FILE))).toBe(true)
    }
  })

  it('is idempotent — a second boot seeds nothing', async () => {
    await ensureAgentRulesForWorkdirs(workdirs)
    const second = await ensureAgentRulesForWorkdirs(workdirs)
    expect(second.scanned).toBe(2)
    expect(second.seeded).toBe(0)
    expect(second.updated).toBe(0)
  })

  it('restores a drifted rule (a new app version, or an agent that rewrote it)', async () => {
    await ensureAgentRulesForWorkdirs(workdirs)
    const drifted = join(workdirs[0], '.claude', 'rules', AGENT_RULES_FILE)
    chmodSync(drifted, 0o644) // seeded rules are read-only — undo it to simulate the write
    writeFileSync(drifted, `<!-- ${DEP_RULE_MARKER} -->\n\n# an old shipped version\n`)

    const sweep = await ensureAgentRulesForWorkdirs(workdirs)

    expect(sweep.updated).toBe(1)
    expect(readFileSync(drifted, 'utf-8')).toBe(readFileSync(AGENT_RULES_PATH, 'utf-8'))
    expect(statSync(drifted).mode & 0o777).toBe(RULE_FILE_MODE)
  })

  it('re-creates the rule file across the fleet after it is deleted', async () => {
    await ensureAgentRulesForWorkdirs(workdirs)
    for (const w of workdirs) rmSync(join(w, '.claude', 'rules', AGENT_RULES_FILE))

    const sweep = await ensureAgentRulesForWorkdirs(workdirs)

    expect(sweep.seeded).toBe(2)
    for (const w of workdirs) {
      expect(existsSync(join(w, '.claude', 'rules', AGENT_RULES_FILE))).toBe(true)
    }
  })

  it('visits a shared workdir once (two agents can adopt the same project)', async () => {
    const sweep = await ensureAgentRulesForWorkdirs([workdirs[0], workdirs[0], workdirs[1]])
    expect(sweep.scanned).toBe(2)
  })

  it('isolates a failing workdir — one bad agent must not deprive the others', async () => {
    // `.claude` as a regular FILE makes mkdir('.claude/rules') fail with ENOTDIR.
    // Chosen over chmod because it does not depend on the uid running the suite
    // (a root CI runner ignores a read-only mode bit; ENOTDIR is unconditional).
    const broken = workdirs[0]
    writeFileSync(join(broken, '.claude'), 'not a directory')

    const sweep = await ensureAgentRulesForWorkdirs(workdirs)

    expect(sweep.failed).toHaveLength(1)
    expect(sweep.failed[0]).toContain(broken)
    // The healthy agent still got its rules — the whole point of per-workdir isolation.
    expect(sweep.seeded).toBe(1)
    expect(existsSync(join(workdirs[1], '.claude', 'rules', AGENT_RULES_FILE))).toBe(true)
  })
})
