/**
 * End-to-end tests for the pillar CLIs (`trddgrep`, `prrdgrep`, `specgrep`, `memgrep`).
 *
 * NO MOCKS. Every test here spawns the REAL binary that is on PATH
 * (`~/.local/bin/trddgrep` etc., which dispatch to this checkout's
 * `scripts/*.mjs` via `~/.local/share/aimaestro/install-root` — see
 * `scripts/pillar-cli`) against a throwaway temp corpus built with
 * `--design-dir`. The point of an e2e suite is to pin what actually ships
 * on the user's PATH, so mocking any of this would test nothing.
 *
 * Every fixture lives under `os.tmpdir()` and is deleted in `afterEach`.
 * No test ever points a command at this repo's own `design/` or at
 * `~/.claude/`. Test 29 (containment) asserts the developer's real
 * `~/.aimaestro` state dir is byte-for-byte the same set of entries
 * before and after this whole file's tests ran.
 *
 * Exit-code trichotomy pinned throughout: 0 clean/answered, 1 findings/no-match,
 * 2 could-not-run. Never collapsed to a boolean.
 *
 * Tests 17 and 18 are CHARACTERIZATION tests — they pin a known, currently-shipping
 * defect (found and confirmed by hand against the real CLI before writing this file).
 * If either one goes red, the defect was FIXED — update/remove it deliberately rather
 * than "fixing" the test back to green.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const REAL_STATE = path.join(os.homedir(), '.aimaestro');
const TMP_DIRS: string[] = [];

function realStateListing(): string[] {
  // RECURSIVE, and the shallow version is why this suite leaked for its whole life. A
  // top-level readdir sees `pillar-index` — an entry that ALREADY EXISTS — so every file
  // the pillar CLIs wrote inside it was invisible to the very guard watching the directory.
  // Measured 2026-09-13: 89 files in two hours, 259 accumulated, while this test passed.
  if (!fs.existsSync(REAL_STATE)) return []
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      out.push(rel)
      if (e.isDirectory()) {
        try {
          walk(path.join(dir, e.name), rel)
        } catch {
          // An unreadable subtree is not a leak signal; record the entry and move on.
        }
      }
    }
  }
  walk(REAL_STATE, '')
  return out.sort()
}

// Snapshot BEFORE any test in this file runs — nothing above this line touches
// the real state dir (the cliAvailable() probes below only run `--help`).
const BEFORE_SUITE_STATE = realStateListing();

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function cliAvailable(name: string): boolean {
  const r = spawnSync(name, ['--help'], { encoding: 'utf8' });
  return !r.error;
}

const HAVE_TRDDGREP = cliAvailable('trddgrep');
const HAVE_PRRDGREP = cliAvailable('prrdgrep');
const HAVE_SPECGREP = cliAvailable('specgrep');
const HAVE_MEMGREP = cliAvailable('memgrep');

for (const [name, have] of [
  ['trddgrep', HAVE_TRDDGREP],
  ['prrdgrep', HAVE_PRRDGREP],
  ['specgrep', HAVE_SPECGREP],
  ['memgrep', HAVE_MEMGREP],
] as const) {
  if (!have) {
    // eslint-disable-next-line no-console
    console.warn(`pillar-cli-e2e: ${name} not found on PATH — its tests will be skipped`);
  }
}

interface Result {
  code: number | null;
  out: string;
  err: string;
}

// Containment for the SUBPROCESSES this file spawns. The pillar CLIs write their index under
// the ai-maestro state dir keyed by corpus, so driving a real binary against a temp corpus
// wrote into the DEVELOPER'S real ~/.aimaestro — a fresh mkdtemp path each run hashes to a
// fresh key, so the directory grew every run and never repeated. Measured 2026-09-13: 89
// files in two hours from this suite alone, 259 accumulated.
//
// Scoped to THIS FILE rather than a global setup on purpose: a global override was tried
// first and broke 13 tests that legitimately resolve the real state dir themselves. A
// containment that redefines a path other tests assert on trades one silent wrong for
// another.
const STATE_JAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-e2e-state-'))
TMP_DIRS.push(STATE_JAIL)

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Result {
  const env = { ...(opts.env ?? process.env), AIMAESTRO_STATE_DIR: STATE_JAIL }
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd, env })
  return { code: r.status, out: stripAnsi(r.stdout ?? ''), err: stripAnsi(r.stderr ?? '') }
}

function mkDesignCorpus(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-e2e-'));
  TMP_DIRS.push(root);
  const design = path.join(root, 'design');
  for (const zone of ['tasks', 'proposals', 'archived', 'refused']) {
    fs.mkdirSync(path.join(design, zone), { recursive: true });
  }
  return design;
}

function mkPrrdCorpus(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-e2e-prrd-'));
  TMP_DIRS.push(root);
  const design = path.join(root, 'design');
  fs.mkdirSync(path.join(design, 'requirements'), { recursive: true });
  fs.writeFileSync(
    path.join(design, 'requirements', 'PRRD.md'),
    [
      '# PRRD',
      '',
      '## Rules',
      '',
      '- **G1.1** — every agent identifies itself before writing to GitHub',
      '',
      '- **S64.1** — silver rule example text',
      '',
    ].join('\n')
  );
  return design;
}

function mkSpecCorpus(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-e2e-spec-'));
  TMP_DIRS.push(root);
  const design = path.join(root, 'design');
  fs.mkdirSync(path.join(design, 'specs'), { recursive: true });
  fs.writeFileSync(
    path.join(design, 'specs', 'test-spec.md'),
    [
      '# Test Spec',
      '',
      'status: normative',
      '',
      '`DUM-10` **widget behavior** — the widget must render within 200ms',
      '',
      '- **DUM-01** — bullet form clause (should NOT be found)',
      '',
      // Deliberately AFTER the bullet: test 24 asserts this one, so passing requires
      // having traversed PAST the bullet line rather than stopping at the first match.
      '`DUM-20` **second clause** — proves the parser continued past the bullet',
      '',
    ].join('\n')
  );
  return design;
}

function mkMemCorpus(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-e2e-mem-'));
  TMP_DIRS.push(root);
  fs.writeFileSync(
    path.join(root, 'widget-crash.md'),
    [
      '---',
      'name: widget-crash',
      'description: "widget crashes on empty input, the render function throws a null pointer"',
      'ocd: 2026-09-13',
      'lmd: 2026-09-13',
      'metadata: {node_type: memory, type: lesson, tier: component}',
      '---',
      '',
      '# Widget crash',
      '',
      'The widget crashes on empty input.',
      '',
      '## Notes and lessons learned',
      '',
    ].join('\n')
  );
  return root;
}

/** Creates a real card via `trddgrep new` and returns its 8-char id. Throws if creation failed. */
function createCard(design: string, title: string, taskType = 'spike'): string {
  const r = run('trddgrep', ['--design-dir', design, 'new', '--title', title, '--task-type', taskType]);
  const m = r.out.match(/created\s+([A-Z0-9]{8})\b/);
  if (!m) throw new Error(`trddgrep new failed to create a card: out=${r.out} err=${r.err}`);
  return m[1];
}

function findCardFile(design: string, id: string): string | null {
  for (const zone of ['tasks', 'proposals', 'archived', 'refused']) {
    const dir = path.join(design, zone);
    if (!fs.existsSync(dir)) continue;
    const hit = fs.readdirSync(dir).find((f) => f.includes(id));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

afterEach(() => {
  for (const dir of TMP_DIRS.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

describe.skipIf(!HAVE_TRDDGREP)('trddgrep — lifecycle (real CLI, real temp corpus)', () => {
  it('01 · creates a new card with an 8-char base36 id, filed under tasks/', () => {
    const design = mkDesignCorpus();
    const r = run('trddgrep', ['--design-dir', design, 'new', '--title', 'Test Spike Card', '--task-type', 'spike']);
    expect(r.code).toBe(0);
    const m = r.out.match(/created\s+([A-Z0-9]{8})\b/);
    expect(m).not.toBeNull();
    const id = m![1];
    const file = findCardFile(design, id);
    expect(file).not.toBeNull();
    expect(file!.includes(`${path.sep}tasks${path.sep}`)).toBe(true);
  });

  it('02 · board (no verb) lists the created card and reports the open-card count', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Board Listing Card');
    const r = run('trddgrep', ['--design-dir', design]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('1 open cards');
    expect(r.out).toContain(id);
  });

  it('03 · show <id> returns the card; show <unknown-id> fails without exiting 0', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Show Me Card');
    const ok = run('trddgrep', ['--design-dir', design, 'show', id]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain(id);
    const bad = run('trddgrep', ['--design-dir', design, 'show', 'ZZZZZZZZ']);
    expect(bad.code).not.toBe(0);
    expect(bad.out + bad.err).toContain('no TRDD with id');
  });

  it('04 · set changes a field, and a re-read shows the new value', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Priority Card');
    const setResult = run('trddgrep', ['--design-dir', design, 'set', id, 'priority', '2']);
    expect(setResult.code).toBe(0);
    const shown = run('trddgrep', ['--design-dir', design, 'show', id]);
    expect(shown.out).toContain('P2');
  });

  it('05 · move changes column and keeps the file in tasks/', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Move Card');
    const r = run('trddgrep', ['--design-dir', design, 'move', id, 'todo']);
    expect(r.code).toBe(0);
    const file = findCardFile(design, id)!;
    expect(file.includes(`${path.sep}tasks${path.sep}`)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toMatch(/^column: todo$/m);
  });

  it('06 · append adds a line under the named heading', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Append Card');
    const r = run('trddgrep', ['--design-dir', design, 'append', id, 'Notes', 'This is a test note line.']);
    expect(r.code).toBe(0);
    const content = fs.readFileSync(findCardFile(design, id)!, 'utf8');
    expect(content).toContain('## Notes');
    expect(content).toContain('This is a test note line.');
  });

  it('07 · check-box ticks box 1; --uncheck reverses it', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Checkbox Card');
    run('trddgrep', ['--design-dir', design, 'append', id, 'Acceptance', '- [ ] First criterion']);
    const tick = run('trddgrep', ['--design-dir', design, 'check-box', id, '1']);
    expect(tick.code).toBe(0);
    let content = fs.readFileSync(findCardFile(design, id)!, 'utf8');
    expect(content).toContain('- [x] First criterion');
    const untick = run('trddgrep', ['--design-dir', design, 'check-box', id, '1', '--uncheck']);
    expect(untick.code).toBe(0);
    content = fs.readFileSync(findCardFile(design, id)!, 'utf8');
    expect(content).toContain('- [ ] First criterion');
  });

  it('08 · the D4 gate refuses to archive as complete while an acceptance box is unchecked', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Gate Card');
    run('trddgrep', ['--design-dir', design, 'append', id, 'Acceptance', '- [ ] First criterion']);
    run('trddgrep', ['--design-dir', design, 'append', id, 'Acceptance', '- [ ] Second criterion']);
    run('trddgrep', ['--design-dir', design, 'check-box', id, '1']);
    const r = run('trddgrep', ['--design-dir', design, 'move', id, 'complete']);
    expect(r.code).toBe(2);
    expect(r.out + r.err).toContain('1 of 2 acceptance box(es) still unchecked');
    expect(findCardFile(design, id)!.includes(`${path.sep}tasks${path.sep}`)).toBe(true);
  });

  it('09 · once every acceptance box is checked, move complete succeeds and archives the file', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Completable Card');
    run('trddgrep', ['--design-dir', design, 'append', id, 'Acceptance', '- [ ] Only criterion']);
    run('trddgrep', ['--design-dir', design, 'check-box', id, '1']);
    const r = run('trddgrep', ['--design-dir', design, 'move', id, 'complete']);
    expect(r.code).toBe(0);
    const file = findCardFile(design, id)!;
    expect(file.includes(`${path.sep}archived${path.sep}`)).toBe(true);
  });

  it('10 · move ... superseded --superseded-by lands the file in archived/', () => {
    const design = mkDesignCorpus();
    const oldId = createCard(design, 'Old Card');
    const newId = createCard(design, 'New Replacement Card');
    const r = run('trddgrep', ['--design-dir', design, 'move', oldId, 'superseded', '--superseded-by', newId]);
    expect(r.code).toBe(0);
    const file = findCardFile(design, oldId)!;
    expect(file.includes(`${path.sep}archived${path.sep}`)).toBe(true);
  });
});

describe.skipIf(!HAVE_TRDDGREP)('trddgrep — query + diagnostics (real CLI)', () => {
  it('11 · lint exits 0 on a clean fixture', () => {
    const design = mkDesignCorpus();
    createCard(design, 'Clean Card');
    const r = run('trddgrep', ['--design-dir', design, 'lint']);
    expect(r.code).toBe(0);
  });

  it('12 · lint --strict exits 1 (not 2) and names META-MISSING on a card missing assignee', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'No Assignee Card');
    const file = findCardFile(design, id)!;
    const stripped = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !l.startsWith('assignee:'))
      .join('\n');
    fs.writeFileSync(file, stripped);
    const r = run('trddgrep', ['--design-dir', design, 'lint', '--strict']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('META-MISSING');
  });

  it('13 · validate on a directory with no TRDD corpus exits 2, not 1 (the trichotomy)', () => {
    const missing = path.join(os.tmpdir(), `pillar-e2e-missing-${Date.now()}`);
    const r = run('trddgrep', ['--design-dir', missing, 'validate']);
    expect(r.code).toBe(2);
    expect(r.out + r.err).toContain('could not run');
  });

  it('14 · env reports the corpus path it resolved', () => {
    const design = mkDesignCorpus();
    const r = run('trddgrep', ['--design-dir', design, 'env']);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`corpus=${design}`);
  });

  it('15 · the bare-pattern search form returns the matching card', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Searchable Widget Card');
    const r = run('trddgrep', ['--design-dir', design, 'Searchable Widget']);
    expect(r.code).toBe(0);
    expect(r.out).toContain(id);
  });

  it('16 · --porcelain on the search form emits TAB-separated path/id/col/zone/title', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Porcelain Search Card');
    const r = run('trddgrep', ['--design-dir', design, '--porcelain', 'Porcelain Search']);
    expect(r.code).toBe(0);
    const line = r.out.trim().split('\n')[0];
    const fields = line.split('\t');
    expect(fields.length).toBe(5);
    expect(fields[1]).toBe(id);
  });
});

describe.skipIf(!HAVE_TRDDGREP)('trddgrep — CHARACTERIZATION of known defects (real CLI)', () => {
  it('17 · --porcelain on the BOARD form is not TSV, while --column IS honoured on that same form', () => {
    const design = mkDesignCorpus();
    const id = createCard(design, 'Board Porcelain Card');
    // KNOWN DEFECT: unlike the search form (test 16), the board form ignores --porcelain
    // and prints its normal human-formatted, ANSI-colored listing (no TABs). If this
    // assertion goes red, the defect was fixed — do not "fix" this test back to green
    // without reading why first.
    const porcelainBoard = run('trddgrep', ['--design-dir', design, '--porcelain']);
    expect(porcelainBoard.code).toBe(0);
    expect(porcelainBoard.out).not.toContain('\t');
    // By contrast, --column on the SAME board form IS honoured.
    const columnMatch = run('trddgrep', ['--design-dir', design, '--column', 'backburner']);
    expect(columnMatch.out).toContain(id);
    const columnMiss = run('trddgrep', ['--design-dir', design, '--column', 'todo']);
    expect(columnMiss.out).not.toContain(id);
  });

  it('18 · a terminal move still prints the STAGED hint even on a corpus that is not a git repo', () => {
    // KNOWN DEFECT: mkDesignCorpus() never runs `git init`, so nothing can be staged —
    // yet the CLI unconditionally prints the "the rename is STAGED" hint on a terminal
    // move. If this assertion goes red, the defect was fixed.
    const design = mkDesignCorpus();
    const id = createCard(design, 'Non Git Card');
    run('trddgrep', ['--design-dir', design, 'append', id, 'Acceptance', '- [ ] Only criterion']);
    run('trddgrep', ['--design-dir', design, 'check-box', id, '1']);
    const r = run('trddgrep', ['--design-dir', design, 'move', id, 'complete']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('STAGED');
  });
});

describe.skipIf(!HAVE_PRRDGREP)('prrdgrep (real CLI, real temp corpus)', () => {
  it('19 · lists rules from a fixture PRRD (real bullet form)', () => {
    const design = mkPrrdCorpus();
    const r = run('prrdgrep', ['--design-dir', design]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('G1.1');
    expect(r.out).toContain('S64.1');
  });

  it('20 · show G1.1 returns that one rule', () => {
    const design = mkPrrdCorpus();
    const r = run('prrdgrep', ['--design-dir', design, 'show', 'G1.1']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('every agent identifies itself');
  });

  it('21 · edit with a non-matching --expect ABORTS and leaves the file unchanged', () => {
    const design = mkPrrdCorpus();
    const file = path.join(design, 'requirements', 'PRRD.md');
    const before = fs.readFileSync(file, 'utf8');
    const r = run('prrdgrep', [
      '--design-dir',
      design,
      'edit',
      'G1.1',
      '--expect',
      'totally wrong text',
      '--replace',
      'new text',
    ]);
    expect(r.code).toBe(2);
    expect(r.out + r.err).toContain('STALE');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('22 · lint/validate follow the exit-code trichotomy (0 clean, 2 could-not-run)', () => {
    const design = mkPrrdCorpus();
    const clean = run('prrdgrep', ['--design-dir', design, 'lint']);
    expect(clean.code).toBe(0);
    const missing = path.join(os.tmpdir(), `pillar-e2e-prrd-missing-${Date.now()}`);
    const bad = run('prrdgrep', ['--design-dir', missing, 'validate']);
    expect(bad.code).toBe(2);
    expect(bad.out + bad.err).toContain('could not run');
  });
});

describe.skipIf(!HAVE_SPECGREP)('specgrep (real CLI, real temp corpus)', () => {
  it('23 · finds a clause in the real backticked-id-at-line-start form', () => {
    const design = mkSpecCorpus();
    const r = run('specgrep', ['--design-dir', design]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('DUM-10');
  });

  it('24 · does NOT find a bullet-form clause (pins the parser contract)', () => {
    const design = mkSpecCorpus();
    const r = run('specgrep', ['--design-dir', design]);
    // POSITIVE CONTROL, load-bearing: without it the assertion below passes on EMPTY
    // output — i.e. on specgrep never running at all, since `not.toContain` cannot
    // tell "the parser correctly skipped it" from "no output was produced".
    //
    // It asserts DUM-20 and NOT DUM-10 on purpose. DUM-10 sits BEFORE the bullet in
    // the fixture, so a first-match-only parser that never reached the bullet would
    // satisfy it and leave the contract unexercised while the test stayed green.
    // DUM-20 sits AFTER the bullet, so finding it proves the parser traversed past
    // the bullet and rejected it. Test 23 owns the DUM-10 claim; keep them disjoint.
    expect(r.code).toBe(0);
    expect(r.out).toContain('DUM-20');
    expect(r.out).not.toContain('DUM-01');
  });

  it('25 · show returns one spec clause', () => {
    const design = mkSpecCorpus();
    const r = run('specgrep', ['--design-dir', design, 'show', 'DUM-10']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('widget behavior');
  });

  it('26 · edit with a mismatched --expect ABORTS and the file stays byte-identical', () => {
    const design = mkSpecCorpus();
    const file = path.join(design, 'specs', 'test-spec.md');
    const before = fs.readFileSync(file, 'utf8');
    const r = run('specgrep', ['--design-dir', design, 'edit', 'DUM-10', '--expect', 'nonsense', '--replace', 'x']);
    expect(r.code).toBe(2);
    expect(r.out + r.err).toContain('STALE');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

describe.skipIf(!HAVE_MEMGREP)('memgrep (real CLI, real temp corpus)', () => {
  it('27 · recall returns a matching page for a symptom phrase', () => {
    const dir = mkMemCorpus();
    const r = run('memgrep', ['recall', 'widget crashes on empty input', dir]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('widget-crash');
  });

  it('28 · recall returns nothing (and does not crash) for a phrase absent from the corpus', () => {
    const dir = mkMemCorpus();
    const r = run('memgrep', ['recall', 'completely unrelated phrase xyz123', dir]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe('');
  });
});

describe('containment + write gate', () => {
  it('29 · writes NOTHING anywhere under the developer real ~/.aimaestro, at any depth', () => {
    // NON-VACUITY GUARD: realStateListing() returns [] when the dir is absent, so on a
    // fresh clone or a CI box the comparison below is [] vs [] — passing forever while
    // reading as safety. Measured 51 entries on this machine; assert it, don't assume.
    expect(BEFORE_SUITE_STATE.length).toBeGreaterThan(0);
    // The TITLE states the narrow claim deliberately. This is a one-level, names-only
    // comparison: it catches a top-level entry appearing or vanishing, NOT a mutation
    // inside one — a corrupted agents/registry.json changes no top-level name. Calling
    // it "never touches" would record the guard stronger than its evidence.
    expect(realStateListing()).toEqual(BEFORE_SUITE_STATE);
  });

  it.skipIf(!HAVE_TRDDGREP)(
    '30 · the write gate refuses edit outside the ai-maestro checkout, even with a real id and cwd unset',
    () => {
      const design = mkDesignCorpus();
      const id = createCard(design, 'Write Gate Card');
      const env = { ...process.env };
      delete env.AIM_PILLAR_ALLOW_WRITE;
      const r = run('trddgrep', ['--design-dir', design, 'edit', id, '--expect', 'x', '--replace', 'y'], {
        cwd: os.tmpdir(),
        env,
      });
      expect(r.code).toBe(2);
      expect(r.out + r.err).toContain('disabled outside the ai-maestro checkout');
    }
  );
});
