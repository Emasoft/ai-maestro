import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

/**
 * TRDD-D7KVF4HQ — `prrdgrep` and `specgrep`, the two CLIs that expose the USER's edit
 * transaction to a human and to an agent.
 *
 * SPAWNED, not called in-process, for the reason `pillar-cli-exit-codes.test.ts`
 * already records: an exit code is a contract of the BINARY, and nothing that imports
 * the library can observe it. The edit verb makes that sharper — a caller decides
 * whether to retry from the code and the `STALE` token, so both are the contract.
 *
 * EVERY EDIT ASSERTION HERE IS PAIRED WITH ITS FILE STATE. "exit 2" alone is satisfied
 * by a tool that refuses everything; "exit 0" alone is satisfied by one that reports
 * success over an unwritten file. The pair is what makes either meaningful.
 */

const REPO = process.cwd()
let fakeHome: string
let fix: string

/** CONTAINMENT — the spawned CLI must never resolve state into the developer's home. */
function runCli(script: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join('scripts', script), ...args], {
    cwd: REPO,
    encoding: 'utf-8',
    env: { ...process.env, TRDD_DEBUG: '', NO_COLOR: '1', HOME: fakeHome },
  })
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const PRRD_FIXTURE = [
  '---', // 1
  'project-id: fixture', // 2
  '---', // 3
  '', // 4
  '# PRRD', // 5
  '', // 6
  '- **G1.1** — every agent self-identifies on GitHub.', // 7
  '- **S7.4** — the silver rule under test.', // 8
  '- **S64.134** — another silver rule.', // 9
  '', // 10
].join('\n')

const SPEC_FIXTURE = [
  '---',
  'spec-version: 1.0.0',
  '---',
  '',
  '`3P-AAA-01` **first** — the first clause.',
  '`3P-AAA-02` **second** — the second clause.',
  '',
  'Prose that cites 3P-AAA-01 without declaring it.',
  '',
].join('\n')

const prrdFile = () => path.join(fix, 'design', 'requirements', 'PRRD.md')
const specFile = () => path.join(fix, 'design', 'specs', 'x-spec.md')
const designDir = () => path.join(fix, 'design')

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-home-'))
  fix = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-fix-'))
  fs.mkdirSync(path.join(fix, 'design', 'requirements'), { recursive: true })
  fs.mkdirSync(path.join(fix, 'design', 'specs'), { recursive: true })
  fs.writeFileSync(prrdFile(), PRRD_FIXTURE, 'utf-8')
  fs.writeFileSync(specFile(), SPEC_FIXTURE, 'utf-8')
})
afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true })
  fs.rmSync(fix, { recursive: true, force: true })
})

describe.each([
  { tool: 'prrdgrep.mjs', label: 'PRRD', id: 'S7.4', text: 'the silver rule under test', line: 8 },
  { tool: 'specgrep.mjs', label: 'spec', id: '3P-AAA-02', text: 'the second clause', line: 6 },
])('$tool — the query verbs', ({ tool, label, id, line }) => {
  it('lists its records and exits 0', () => {
    const r = runCli(tool, ['list', '--design-dir', designDir()])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(id)
  })

  it('prints the FILE line, so the number can be used to find the record', () => {
    // Not cosmetic: the same number is what `edit` aims the compare-and-swap at.
    const r = runCli(tool, ['list', '--design-dir', designDir()])
    expect(r.stdout).toMatch(new RegExp(`${id.replace(/[.[\]]/g, '\\$&')}\\s+\\S+:${line}\\b`))
  })

  it('exits 1 — not 0 — for an id that does not exist', () => {
    const r = runCli(tool, ['show', 'NO-SUCH-ID-9', '--design-dir', designDir()])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(label)
  })

  it('exits 2 when the corpus is ABSENT, so "clean" and "never looked" stay different answers', () => {
    const r = runCli(tool, ['list', '--design-dir', path.join(fix, 'nowhere')])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain(label)
  })

  it('answers `env` WITHOUT a corpus — the diagnostic must work where the corpus does not', () => {
    const r = runCli(tool, ['env', '--design-dir', path.join(fix, 'nowhere')])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('corpus=')
  })
})

describe('prrdgrep edit — AT LINE N REPLACE X WITH Y', () => {
  it('POSITIVE CONTROL: the edit LANDS, and the file actually changes', () => {
    // Without this, every "it blocks" assertion below is satisfied by a tool that
    // blocks unconditionally — which would pass while being useless. It is also the
    // assertion that caught the body-vs-file line defect: it FAILED first, against a
    // tool whose refusal looked perfectly correct.
    const r = runCli('prrdgrep.mjs', [
      'edit', 'S7.4', '--expect', 'the silver rule under test', '--replace', 'REVISED',
      '--design-dir', designDir(),
    ])
    expect(r.status).toBe(0)
    expect(fs.readFileSync(prrdFile(), 'utf-8')).toContain('- **S7.4** — REVISED.')
  })

  it('targets the record own declaration line when --at-line is omitted', () => {
    // The affordance that matters: a caller that had to count lines by hand would
    // eventually count wrong, and a hand-counted line is how you rewrite a NEIGHBOURING
    // rule. `--at-line 8` and no flag must therefore reach the same line.
    const explicit = runCli('prrdgrep.mjs', [
      'edit', 'S7.4', '--at-line', '8', '--expect', 'silver rule under test', '--replace', 'X',
      '--design-dir', designDir(),
    ])
    expect(explicit.status).toBe(0)
    expect(explicit.stdout).toContain('@@ line 8 @@')
  })

  it('BLOCKS a stale edit with exit 2, the USER message, and a byte-identical file', () => {
    const before = fs.readFileSync(prrdFile(), 'utf-8')
    const r = runCli('prrdgrep.mjs', [
      'edit', 'S7.4', '--expect', 'text that is not there', '--replace', 'X',
      '--design-dir', designDir(),
    ])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/changed since your command was enqueued.*reread the file first/s)
    expect(fs.readFileSync(prrdFile(), 'utf-8')).toBe(before)
  })

  it('prints STALE as its FIRST stderr token, because exit 2 also means "no corpus"', () => {
    // A retry loop keying on the exit code alone would spin forever in the wrong
    // directory. The token is the only thing that separates "re-read and retry" from
    // "you are not where you think you are" — no code in the trichotomy can carry it.
    const stale = runCli('prrdgrep.mjs', [
      'edit', 'S7.4', '--expect', 'not there', '--replace', 'X', '--design-dir', designDir(),
    ])
    const noCorpus = runCli('prrdgrep.mjs', [
      'edit', 'S7.4', '--expect', 'x', '--replace', 'y', '--design-dir', path.join(fix, 'nowhere'),
    ])
    expect(stale.status).toBe(2)
    expect(noCorpus.status).toBe(2)
    expect(stale.stderr.startsWith('STALE ')).toBe(true)
    expect(noCorpus.stderr.startsWith('STALE ')).toBe(false)
  })

  it('is ALL-OR-NOTHING across a batch: one stale edit reverts the valid one', () => {
    const before = fs.readFileSync(prrdFile(), 'utf-8')
    const r = runCli('prrdgrep.mjs', [
      'edit', 'S7.4',
      '--expect', 'the silver rule under test', '--replace', 'WOULD-LAND', // valid
      '--at-line', '9', '--expect', 'NOT THERE', '--replace', 'Y', // stale
      '--design-dir', designDir(),
    ])
    expect(r.status).toBe(2)
    expect(fs.readFileSync(prrdFile(), 'utf-8')).toBe(before)
    expect(before).not.toContain('WOULD-LAND')
  })

  it('binds a TRAILING --at-line to its OWN edit, not to the pair before it', () => {
    // The parser defect this pins: under "any repeated field opens the next edit", the
    // `--at-line 9` below filled edit 1's still-empty line slot, so edit 1 was aimed at
    // edit 2's line and the refusal blamed the wrong text. Both were exit 2, so only
    // the MESSAGE could tell the two parsers apart.
    const r = runCli('prrdgrep.mjs', [
      'edit', 'S7.4',
      '--expect', 'the silver rule under test', '--replace', 'A',
      '--at-line', '99', '--expect', 'NOT THERE', '--replace', 'B',
      '--design-dir', designDir(),
    ])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('line 99 expected to contain: "NOT THERE"')
  })

  it('lands a batch of two VALID edits together (batch positive control)', () => {
    const r = runCli('prrdgrep.mjs', [
      'edit', 'S7.4',
      '--expect', 'the silver rule under test', '--replace', 'TWO-A',
      '--at-line', '9', '--expect', 'another silver rule', '--replace', 'TWO-B',
      '--design-dir', designDir(),
    ])
    expect(r.status).toBe(0)
    const after = fs.readFileSync(prrdFile(), 'utf-8')
    expect(after).toContain('TWO-A')
    expect(after).toContain('TWO-B')
  })

  it('exits 1 for an edit to an id that does not exist, rather than writing anything', () => {
    const before = fs.readFileSync(prrdFile(), 'utf-8')
    const r = runCli('prrdgrep.mjs', [
      'edit', 'NOPE-9', '--expect', 'x', '--replace', 'y', '--design-dir', designDir(),
    ])
    expect(r.status).toBe(1)
    expect(fs.readFileSync(prrdFile(), 'utf-8')).toBe(before)
  })

  it('refuses an edit with no --expect/--replace instead of performing a no-op write', () => {
    const r = runCli('prrdgrep.mjs', ['edit', 'S7.4', '--design-dir', designDir()])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--expect/)
  })
})

describe('specgrep edit — the same transaction, the other per-line pillar', () => {
  it('edits a spec clause and blocks the same command on its second run', () => {
    // The twin exists because a shared core is only shared if BOTH entry points reach
    // it. A wrapper that passed the wrong PillarKind would still look correct here on
    // the happy path — so the SECOND run, which must now be stale, is the real check.
    const first = runCli('specgrep.mjs', [
      'edit', '3P-AAA-02', '--expect', 'the second clause', '--replace', 'REWRITTEN',
      '--design-dir', designDir(),
    ])
    expect(first.status).toBe(0)
    expect(fs.readFileSync(specFile(), 'utf-8')).toContain('REWRITTEN')

    const second = runCli('specgrep.mjs', [
      'edit', '3P-AAA-02', '--expect', 'the second clause', '--replace', 'AGAIN',
      '--design-dir', designDir(),
    ])
    expect(second.status).toBe(2)
    expect(second.stderr.startsWith('STALE ')).toBe(true)
  })

  it('resolves a DECLARATION and not a citation of the same id', () => {
    // `3P-AAA-01` appears twice in the fixture: declared on line 5, cited in prose on
    // line 8. Only the declaration is a record — a tool that matched the citation would
    // aim an edit at a sentence ABOUT the clause.
    const r = runCli('specgrep.mjs', ['show', '3P-AAA-01', '--design-dir', designDir()])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(':5')
  })
})

describe('prrdgrep resolves a rule by NUMBER, whatever tier it currently sits in', () => {
  it('finds S7.4 when asked for 7.4, because promote/demote flips only the letter', () => {
    // PRRD_KIND.normalizeId drops the tier letter: G7 and S7 cannot coexist, so the
    // NUMBER is the id. An agent citing `PRRD G7.4` must still reach a rule that has
    // since been demoted to silver — that is the whole reason the letter is dropped.
    const r = runCli('prrdgrep.mjs', ['show', 'G7.4', '--design-dir', designDir()])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('S7.4')
  })
})
