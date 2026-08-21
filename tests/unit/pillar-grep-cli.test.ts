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
    // TRDD-DXQNUJII: the version moves WITH the text. This edit used to change the text
    // alone and assert `- **S7.4** — REVISED.`, which the guard now refuses — a rule whose
    // text moves under a pinned id is the defect that card exists to close. The positive
    // control's own point (the tool is not a wall) is unchanged; only the edit is legal now.
    const r = runCli('prrdgrep.mjs', [
      'edit', 'S7.4',
      '--expect', '- **S7.4** — the silver rule under test.',
      '--replace', '- **S7.5** — REVISED.',
      '--design-dir', designDir(),
    ])
    expect(r.status).toBe(0)
    expect(fs.readFileSync(prrdFile(), 'utf-8')).toContain('- **S7.5** — REVISED.')
  })

  it('targets the record own declaration line when --at-line is omitted', () => {
    // The affordance that matters: a caller that had to count lines by hand would
    // eventually count wrong, and a hand-counted line is how you rewrite a NEIGHBOURING
    // rule. `--at-line 8` and no flag must therefore reach the same line.
    // Both forms are driven, because the claim is that they AGREE. Until TRDD-DXQNUJII
    // this test passed `--at-line 8` only — so it asserted nothing about the default it is
    // named for, and would have stayed green with the defaulting deleted.
    const defaulted = runCli('prrdgrep.mjs', [
      'edit', 'S7.4',
      '--expect', '- **S7.4** — the silver rule under test.',
      '--replace', '- **S7.5** — the silver rule under test, once.',
      '--design-dir', designDir(),
    ])
    expect(defaulted.status).toBe(0)
    expect(defaulted.stdout).toContain('@@ line 8 @@')

    const explicit = runCli('prrdgrep.mjs', [
      'edit', 'S7.5', '--at-line', '8',
      '--expect', '- **S7.5** — the silver rule under test, once.',
      '--replace', '- **S7.6** — the silver rule under test, twice.',
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
    // TRDD-DXQNUJII: both edits carry their own version bump, so the batch is legal on
    // every line it touches — the guard judges the whole resulting file, so one unbumped
    // rule in a batch would refuse the batch.
    const r = runCli('prrdgrep.mjs', [
      'edit', 'S7.4',
      '--expect', '- **S7.4** — the silver rule under test.', '--replace', '- **S7.5** — TWO-A.',
      '--at-line', '9',
      '--expect', '- **S64.134** — another silver rule.', '--replace', '- **S64.135** — TWO-B.',
      '--design-dir', designDir(),
    ])
    expect(r.status).toBe(0)
    const after = fs.readFileSync(prrdFile(), 'utf-8')
    expect(after).toContain('- **S7.5** — TWO-A.')
    expect(after).toContain('- **S64.135** — TWO-B.')
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

/**
 * TRDD-BRRJK57P — an UNKNOWN OPTION must be a could-not-run (2), on ALL THREE pillar CLIs.
 *
 * `prrdgrep` and `specgrep` route through `lib/pillar/cli.ts:193` and always did.
 * `trddgrep` does NOT route through that core, and had no equivalent: measured 2026-08-16,
 * `trddgrep validate --min-severity error` printed all 265 findings (264 of them WARN) and
 * exited 1 — byte-identical to the bare command. That flag does not exist. It was dropped
 * silently, so the tool answered a DIFFERENT question than the one asked while returning an
 * exit code that reads as a verdict.
 *
 * The three are asserted TOGETHER deliberately: the defect was one sibling diverging from
 * two, which no per-tool test could have surfaced. A guard on trddgrep alone would let the
 * same drift reappear in the other direction.
 *
 * NEUTER (run 2026-08-16): replacing trddgrep's `unknownFlag` finder with `() => false`
 * restores exit 1 / 265 lines on `validate --xyzzy` — the exact pre-fix behaviour — and reds
 * the trddgrep case here and only it.
 */
describe('every pillar CLI refuses an unknown option rather than ignoring it', () => {
  for (const script of ['trddgrep.mjs', 'prrdgrep.mjs', 'specgrep.mjs']) {
    it(`${script} exits 2 and names the flag`, () => {
      const r = runCli(script, ['--xyzzy-not-a-flag'])
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/unknown option --xyzzy-not-a-flag/)
    })
  }

  // POSITIVE CONTROL. Without it, a CLI that refused EVERY flag would pass the three cases
  // above — "exit 2 on a bad flag" is satisfied by a tool that never works at all.
  it('trddgrep still accepts its real flags (the refusal is selective, not blanket)', () => {
    const r = runCli('trddgrep.mjs', ['board', '--column', 'dev'])
    expect(r.status).toBe(0)
  })
})

/**
 * TRDD-D7KVF4HQ (Unit 1 follow-up) — `--min-severity` / `--rule` are now REAL filters,
 * not the silently-dropped flag pinned above. Run against this repo's own `design/`
 * corpus (no `--design-dir` fixture — same as the positive control two tests up), whose
 * census was measured before this change: 265 findings, exactly ONE error
 * (BODY-STATE-CLAIM / 7123D51A) and exactly THREE STALE-COLUMN warnings.
 * Re-measured 2026-08-19 (TRDD-PTFPGSLV session): 262 findings — the zone-repair that
 * archived 78J4I4QS + S97TNMIJ cleared 2 ZONE-MISMATCH errors and 1 STALE-COLUMN warning,
 * so the census is now ONE error and TWO STALE-COLUMN warnings (979DBDAA, 2XV78BND).
 *
 * A fixture corpus would be safer against drift, but the whole point is to pin the LIVE
 * numbers the ledger cites — a fixture cannot fail if a future card silently breaks the
 * filter on the real thing.
 */
describe('trddgrep validate — --min-severity and --rule actually filter', () => {
  it('--min-severity error prints ONLY the one ERROR line, not all 265', () => {
    const r = runCli('trddgrep.mjs', ['validate', '--min-severity', 'error'])
    const lines = r.stdout.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^ERROR\tBODY-STATE-CLAIM\t7123D51A\t/)
    expect(r.status).toBe(1)
  })

  it('--rule STALE-COLUMN prints exactly the 2 STALE-COLUMN findings and exits 0 (no error among them)', () => {
    const r = runCli('trddgrep.mjs', ['validate', '--rule', 'STALE-COLUMN'])
    const lines = r.stdout.trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line).toMatch(/^WARN\tSTALE-COLUMN\t/)
    expect(r.status).toBe(0)
  })

  it('a filter matching nothing exits 0, not 1 — the exit reflects what was SHOWN', () => {
    const r = runCli('trddgrep.mjs', ['validate', '--rule', 'NO-SUCH-RULE-EVER'])
    expect(r.stdout.trim()).toBe('')
    expect(r.status).toBe(0)
  })

  it('--min-severity rejects a bad value with exit 2, not a silent no-op', () => {
    const r = runCli('trddgrep.mjs', ['validate', '--min-severity', 'critical'])
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--min-severity takes warn\|error/)
  })
})

/**
 * TRDD-IPSNDKGM — `--porcelain`: the machine-readable mode library consumers parse instead
 * of ranked human output (AMOA's F1/F3 declined migrating to the CLIs until it existed).
 * The field ORDER is the contract and is additive-only; these tests pin it.
 */
describe('--porcelain — one TAB-separated record per line, path first', () => {
  it('specgrep show --porcelain: path (absolute) · id · line · zone, nothing else', () => {
    const r = runCli('specgrep.mjs', ['show', '3P-AAA-02', '--porcelain', '--design-dir', designDir()])
    expect(r.status).toBe(0)
    const lines = r.stdout.trim().split('\n')
    expect(lines).toHaveLength(1)
    const f = lines[0].split('\t')
    expect(f[0]).toBe(specFile())
    expect(f[1]).toBe('3P-AAA-02')
    expect(f[2]).toBe('6')
  })

  it('prrdgrep search --porcelain: one record per hit, same field order', () => {
    const r = runCli('prrdgrep.mjs', ['silver', '--porcelain', '--design-dir', designDir()])
    expect(r.status).toBe(0)
    for (const line of r.stdout.trim().split('\n')) {
      const f = line.split('\t')
      expect(f[0]).toBe(prrdFile())
      expect(f[1]).toMatch(/^[GS]\d+/)
    }
  })

  it('porcelain keeps the exit trichotomy: 1 on no match, 2 on a missing corpus', () => {
    expect(runCli('specgrep.mjs', ['zzz-no-such-thing', '--porcelain', '--design-dir', designDir()]).status).toBe(1)
    expect(runCli('specgrep.mjs', ['list', '--porcelain', '--design-dir', path.join(fix, 'nowhere')]).status).toBe(2)
  })

  // POSITIVE CONTROL against the unknown-option refusal two describes up: the flag must be
  // STRIPPED before that check, or every porcelain call would exit 2.
  it('--porcelain is a real flag, not an unknown option', () => {
    const r = runCli('specgrep.mjs', ['list', '--porcelain', '--design-dir', designDir()])
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/unknown option/)
  })

  it('trddgrep show --porcelain: path (absolute) · id · column · zone · title', () => {
    fs.mkdirSync(path.join(fix, 'design', 'tasks'), { recursive: true })
    const card = path.join(fix, 'design', 'tasks', 'TRDD-20260101_000000+0100-PORCCARD-x.md')
    fs.writeFileSync(card, [
      '---', 'trdd-id: PORCCARD', 'title: a porcelain fixture card', 'column: dev',
      'created: 2026-01-01T00:00:00+0100', 'updated: 2026-01-01T00:00:00+0100',
      'current-owner: t', 'task-type: bugfix', '---', '', '# a porcelain fixture card', 'body', '',
    ].join('\n'), 'utf-8')
    const r = runCli('trddgrep.mjs', ['show', 'PORCCARD', '--porcelain', '--design-dir', designDir()])
    expect(r.status).toBe(0)
    const f = r.stdout.trim().split('\t')
    expect(f[0]).toBe(card)
    expect(f[1]).toBe('PORCCARD')
    expect(f[2]).toBe('dev')
    expect(f[3]).toBe('tasks')
    expect(f[4]).toBe('a porcelain fixture card')
    // The search path shares the contract, and the trichotomy holds under the flag.
    const s = runCli('trddgrep.mjs', ['porcelain fixture', '--porcelain', '--design-dir', designDir()])
    expect(s.status).toBe(0)
    expect(s.stdout.trim().split('\n')[0].split('\t')[1]).toBe('PORCCARD')
    expect(runCli('trddgrep.mjs', ['show', 'ZZZZZZZ9', '--porcelain', '--design-dir', designDir()]).status).toBe(1)
    expect(runCli('trddgrep.mjs', ['show', 'PORCCARD', '--porcelain', '--design-dir', path.join(fix, 'nowhere')]).status).toBe(2)
  })
})
