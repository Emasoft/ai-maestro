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

describe('trddgrep set refuses the #168 protected fields', () => {
  it.each([
    ['created-by', 'someone-else', /write-once/],
    ['created', '2026-02-02T00:00:00+0100', /write-once/],
    ['approval-judge', 'manager', /create\/approve/],
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
