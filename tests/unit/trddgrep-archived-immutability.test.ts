import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Spawns the real CLI (one process per case); at vitest's 5_000 default this times out under
// full-suite CPU load, the same reason its sibling pillar-grep-cli.test.ts raises the limit.
vi.setConfig({ testTimeout: 60_000 })
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

/**
 * TRDD-MQE5D28T D8 (owner ruling 2026-09-24: archived cards "are like corpses: you cannot
 * change them anymore"), through the REAL `trddgrep` binary: every write verb an agent can run
 * — check-box, append, set, raw edit — is refused on an archived card, the file stays
 * byte-identical, and it stays in archived/. Each refusal is paired with the SAME verb on a
 * tasks/ card succeeding, so a refusal cannot pass by being an earlier, unrelated failure.
 *
 * Also the #168 field protections as the CLI sees them: `set` may not rewrite a write-once
 * identity field or write an approval-record field.
 */

const REPO = process.cwd()
let fakeHome: string
let fix: string
const designDir = () => path.join(fix, 'design')

function runCli(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join('scripts', 'trddgrep.mjs'), '--design-dir', designDir(), ...args], {
    cwd: REPO,
    encoding: 'utf-8',
    env: { ...process.env, TRDD_DEBUG: '', NO_COLOR: '1', HOME: fakeHome, ...env },
  })
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function card(zone: 'archived' | 'tasks', id: string, column: string): string {
  const dir = path.join(designDir(), zone)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `TRDD-20260101_000000+0100-${id}-x.md`)
  fs.writeFileSync(
    file,
    [
      '---',
      `trdd-id: ${id}`,
      'title: an immutability fixture',
      `column: ${column}`,
      `status: ${zone === 'archived' ? 'archived' : 'tasked'}`,
      'created: 2026-01-01T00:00:00+0100',
      'updated: 2026-01-01T00:00:00+0100',
      'created-by: main-agent@fixture',
      'current-owner: t',
      'task-type: bugfix',
      '---',
      '',
      '# an immutability fixture',
      '',
      '## Acceptance',
      '- [ ] the one promise',
      '',
      '## Approval log',
      '',
    ].join('\n'),
    'utf-8',
  )
  return file
}

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-imm-home-'))
  fix = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-imm-fix-'))
})
afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true })
  fs.rmSync(fix, { recursive: true, force: true })
})

const ALLOW = { AIM_PILLAR_ALLOW_WRITE: '1' }

describe('trddgrep write verbs refuse an ARCHIVED card (D8, step 5 G1/G2/G3/G5)', () => {
  const verbs: Array<[string, (id: string) => string[], Record<string, string>]> = [
    ['check-box (G1)', (id) => ['check-box', id, '1'], {}],
    ['append to the Approval log (G2)', (id) => ['append', id, 'Approval log', 'late note'], {}],
    ['set (G3)', (id) => ['set', id, 'severity', 'high'], {}],
    // Line 13 of the fixture is `# an immutability fixture`. AIM_PILLAR_ALLOW_WRITE lifts the
    // tool's write gate, never the archived-card guard.
    ['raw edit, even with AIM_PILLAR_ALLOW_WRITE=1 (G5)', (id) => ['edit', id, '--at-line', '13', '--expect', '# an immutability fixture', '--replace', '# rewritten'], ALLOW],
  ]

  it.each(verbs)('%s is refused, file byte-identical and still archived', (_label, args, env) => {
    const file = card('archived', 'ARCHIVD1', 'complete')
    const before = fs.readFileSync(file, 'utf-8')
    const r = runCli(args('ARCHIVD1'), env)
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toMatch(/archived cards are immutable/)
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })

  it.each(verbs)('%s succeeds on a tasks/ card (positive control)', (_label, args, env) => {
    const file = card('tasks', 'LIVECRD1', 'dev')
    const before = fs.readFileSync(file, 'utf-8')
    const r = runCli(args('LIVECRD1'), env)
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(fs.readFileSync(file, 'utf-8')).not.toBe(before)
  })
})

// `move` does not fit the shared `verbs` table above: its two archived-card refusals come
// from TWO DIFFERENT guards with two different messages, and its "succeeds on tasks/" shape
// differs per target column (advancing within tasks/ keeps the file path; archiving moves it),
// so each gets its own it.each with its own positive control (step 5 measured-fact items 5/6).
describe('trddgrep move ARCHIVE1 <live-column> is refused by the zone gate (advanceColumn)', () => {
  it.each([['dev'], ['testing']])('move to %s is refused, file byte-identical and still archived', (targetColumn) => {
    const file = card('archived', 'ARCHIVE1', 'complete')
    const before = fs.readFileSync(file, 'utf-8')
    const r = runCli(['move', 'ARCHIVE1', targetColumn])
    expect(r.status).not.toBe(0)
    // lib/trdd-store.ts advanceColumn's zone gate (~871-874), distinct from the
    // `archivedWriteRefusal` text the other write verbs share.
    expect(r.stdout + r.stderr).toMatch(/Only an open \(tasks\/\) TRDD can be advanced/)
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })

  it.each([['dev'], ['testing']])('move to %s succeeds on a tasks/ card (positive control)', (targetColumn) => {
    const file = card('tasks', 'LIVEMOV1', 'todo')
    const before = fs.readFileSync(file, 'utf-8')
    const r = runCli(['move', 'LIVEMOV1', targetColumn])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    // advancing within tasks/ never moves the file — same path, new column line.
    expect(fs.readFileSync(file, 'utf-8')).not.toBe(before)
  })
})

describe('trddgrep move ARCHIVE2 superseded is refused by the already-archived gate (archiveTrdd)', () => {
  it('is refused, file byte-identical and still archived', () => {
    const file = card('archived', 'ARCHIVE2', 'complete')
    const before = fs.readFileSync(file, 'utf-8')
    const r = runCli(['move', 'ARCHIVE2', 'superseded', '--approver', 'user'])
    expect(r.status).not.toBe(0)
    // lib/trdd-store.ts archiveTrdd's `trdd.zone === 'archived'` refusal (~1244-1251) —
    // "no exception (D8, G9)", never an in-place rewrite of an already-photographed card.
    expect(r.stdout + r.stderr).toMatch(/already archived — refusing a second archive/)
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })

  it('succeeds on a tasks/ card (positive control) — moves the file into archived/', () => {
    const file = card('tasks', 'LIVEMOV2', 'dev')
    const r = runCli(['move', 'LIVEMOV2', 'superseded', '--approver', 'user'])
    expect(r.status, r.stdout + r.stderr).toBe(0)
    // archiving DOES move the file — unlike the advanceColumn positive control above,
    // the old tasks/ path is gone and the content now lives under archived/.
    expect(fs.existsSync(file)).toBe(false)
    const archivedFile = path.join(designDir(), 'archived', path.basename(file))
    expect(fs.existsSync(archivedFile)).toBe(true)
    expect(fs.readFileSync(archivedFile, 'utf-8')).toMatch(/^column: superseded$/m)
  })
})

describe('trddgrep set refuses the #168 protected fields', () => {
  it.each([
    // Values must satisfy the #168 identity grammar (`user` | `main-agent@<project-id>` |
    // `<agent-name>#<agent-uuid>`) so the case reaches the write-once/create-approve gate
    // under test, rather than being refused earlier by the identity-shape check. Using the
    // `<agent-name>#<agent-uuid>` form (not the generic `user` value) also rules out `user`
    // ever being treated as a default/no-op identity somewhere in the guard.
    ['created-by', 'bob#00000000-0000-0000-0000-000000000000', /write-once/],
    ['created', '2026-02-02T00:00:00+0100', /write-once/],
    ['approval-judge', 'bob#00000000-0000-0000-0000-000000000000', /create\/approve/],
    ['mandated-by', 'manager', /create\/approve/],
  ])('set %s is refused, file byte-identical', (field, value, message) => {
    const file = card('tasks', 'LIVECRD2', 'dev')
    const before = fs.readFileSync(file, 'utf-8')
    const r = runCli(['set', 'LIVECRD2', field, value])
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toMatch(message)
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })
})
