import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Spawns the real CLI against a temp corpus, once per case. Same reasoning as
// pillar-grep-cli: an exit code is a contract of the BINARY, and nothing that imports the
// library can observe it. Under full-suite CPU load the 5_000 default times out, and a
// timeout is not an assertion.
vi.setConfig({ testTimeout: 60_000 })
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'

/**
 * TRDD-13 (`3P-TRDD-13`) — the design body lives in the SAME card, after the exact divider
 * `<!-- @trdd:design-body -->`. `--design-body` / `--no-design-body` decide which HALF the
 * body-reading verbs read.
 *
 * THE FAILURE THESE PIN is not "the flag does nothing" — it is a card with NO divider
 * answering a design question with its ORIGINAL body. That reads as a match, confidently,
 * from a card that carries no design at all. So every `--design-body` case here asserts
 * BOTH the marker that must be present and the one that must be ABSENT: an assertion that
 * only counts matches is satisfied by a tool that never split anything.
 */

const REPO = process.cwd()
let fixDir: string
let designDir: string

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join('scripts', 'trddgrep.mjs'), '--design-dir', designDir, '--no-index', ...args],
    { cwd: REPO, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TRDD_DEBUG: '' } },
  )
  // Colour is a terminal concern; strip it so assertions are about the TEXT.
  const strip = (s: string) => (s ?? '').replace(/\x1b\[[0-9;]*m/g, '')
  return { status: r.status ?? -1, stdout: strip(r.stdout), stderr: strip(r.stderr) }
}

let seq = 0
const card = (id: string, slug: string, title: string, body: string) => ({
  // The v2 filename grammar is STRICT — a malformed timestamp is not a card, and the
  // corpus then reads as empty. `seq` is zero-padded for exactly that reason.
  name: `TRDD-20260101_0000${String(seq++).padStart(2, '0')}+0000-${id}-${slug}.md`,
  text: `---\ntrdd-id: ${id}\ntitle: ${title}\ncolumn: todo\n---\n\n${body}\n`,
})

const CARDS = [
  // WITH a divider — the ordinary case.
  card(
    'AAAA1111',
    'with-divider',
    'card with a divider',
    'ORIGINALMARK original body.\n\n<!-- @trdd:design-body -->\n\nDESIGNMARK the design body.',
  ),
  // WITHOUT a divider — the card whose whole body must NEVER answer a design question.
  card('BBBB2222', 'no-divider', 'card without a divider', 'ORIGINALMARK DESIGNMARK whole body, no divider.'),
  // TWO dividers — 3P-TRDD-13 allows at most one; the FIRST splits, and the second is a
  // lint finding rather than this reader's to adjudicate.
  card(
    'CCCC3333',
    'two-dividers',
    'card with two dividers',
    'ORIGINALMARK original body.\n\n<!-- @trdd:design-body -->\n\nDESIGNMARK first design.\n\n<!-- @trdd:design-body -->\n\nDESIGNMARK second design.',
  ),
  // A STATE block on the DESIGN side only — `show --no-design-body` must not find it, which
  // is the one case that proves the flag reaches `show`'s STATE extraction and not merely
  // its printing.
  card(
    'DDDD4444',
    'state-in-design',
    'card whose STATE sits in the design body',
    'ORIGINALMARK original body.\n\n<!-- @trdd:design-body -->\n\n## STATE — read first\n\nSTATEMARK the design-side state.',
  ),
]

beforeAll(() => {
  fixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trddgrep-design-'))
  designDir = path.join(fixDir, 'design')
  for (const zone of ['tasks', 'proposals', 'archived', 'refused']) {
    fs.mkdirSync(path.join(designDir, zone), { recursive: true })
  }
  for (const c of CARDS) fs.writeFileSync(path.join(designDir, 'tasks', c.name), c.text)
})

afterAll(() => {
  fs.rmSync(fixDir, { recursive: true, force: true })
})

describe('trddgrep --design-body / --no-design-body (3P-TRDD-13)', () => {
  it('the fixture corpus is readable — a zero below must mean "no match", never "no corpus"', () => {
    const r = run(['board'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('4 open cards')
  })

  it('with NEITHER flag the search reads the whole body — every card matches either marker', () => {
    const design = run(['DESIGNMARK'])
    expect(design.status).toBe(0)
    for (const id of ['AAAA1111', 'BBBB2222', 'CCCC3333']) expect(design.stdout).toContain(id)
    const orig = run(['ORIGINALMARK'])
    expect(orig.status).toBe(0)
    for (const id of ['AAAA1111', 'BBBB2222', 'CCCC3333']) expect(orig.stdout).toContain(id)
  })

  it('--design-body searches ONLY after the divider, and a divider-less card contributes nothing', () => {
    const r = run(['--design-body', 'DESIGNMARK'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('AAAA1111')
    expect(r.stdout).toContain('CCCC3333')
    // THE failure mode: BBBB2222 has no divider, so it has no design body — its prose
    // carries DESIGNMARK and must still not answer.
    expect(r.stdout).not.toContain('BBBB2222')
  })

  it('--design-body finds nothing that lives only BEFORE the divider (exit 1, the empty-search code)', () => {
    const r = run(['--design-body', 'ORIGINALMARK'])
    expect(r.status).toBe(1)
    expect(r.stdout).not.toContain('AAAA1111')
    expect(r.stdout).not.toContain('CCCC3333')
    // BBBB2222's whole body carries ORIGINALMARK; it is excluded because it has no design
    // body at all, not because the marker is missing.
    expect(r.stdout).not.toContain('BBBB2222')
  })

  it('--no-design-body searches ONLY before the divider, and keeps the whole body of a divider-less card', () => {
    const r = run(['--no-design-body', 'DESIGNMARK'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('BBBB2222')
    expect(r.stdout).not.toContain('AAAA1111')
    expect(r.stdout).not.toContain('CCCC3333')
    const orig = run(['--no-design-body', 'ORIGINALMARK'])
    expect(orig.status).toBe(0)
    for (const id of ['AAAA1111', 'BBBB2222', 'CCCC3333']) expect(orig.stdout).toContain(id)
  })

  it('show --design-body prints the design half and NOT the original half', () => {
    const r = run(['--design-body', 'show', 'AAAA1111'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('DESIGNMARK')
    expect(r.stdout).not.toContain('ORIGINALMARK original body')
  })

  it('show --design-body on a divider-less card refuses (exit 1) instead of printing its body', () => {
    const r = run(['--design-body', 'show', 'BBBB2222'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('no design body')
    expect(r.stdout).not.toContain('DESIGNMARK')
  })

  it('two dividers: the FIRST splits, so both design sections are in the design body', () => {
    const r = run(['--design-body', 'show', 'CCCC3333'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('DESIGNMARK first design')
    expect(r.stdout).toContain('DESIGNMARK second design')
    expect(r.stdout).not.toContain('ORIGINALMARK')
  })

  it('show --no-design-body does not see a STATE block that lives in the design body', () => {
    const scoped = run(['--no-design-body', 'show', 'DDDD4444'])
    expect(scoped.status).toBe(0)
    expect(scoped.stdout).toContain('no STATE block')
    expect(scoped.stdout).not.toContain('STATEMARK')
    // Positive control: with no flag the same card DOES print that STATE block, so the
    // assertion above is about the flag and not about a card nobody can read.
    const whole = run(['show', 'DDDD4444'])
    expect(whole.status).toBe(0)
    expect(whole.stdout).toContain('STATEMARK')
  })

  it('both flags together is a could-not-run (2), never a silent pick', () => {
    const r = run(['--design-body', '--no-design-body', 'DESIGNMARK'])
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('mutually exclusive')
  })

  it('a verb that reads no prose REFUSES the flag (2) rather than ignoring it', () => {
    for (const verb of ['board', 'next', 'roots', 'lint']) {
      const r = run(['--design-body', verb])
      expect(r.status, `${verb} must refuse`).toBe(2)
      expect(r.stderr).toContain('reads none')
    }
  })

  it('help documents both flags and the divider they key on', () => {
    const r = run(['help'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--design-body')
    expect(r.stdout).toContain('--no-design-body')
    expect(r.stdout).toContain('<!-- @trdd:design-body -->')
  })
})
