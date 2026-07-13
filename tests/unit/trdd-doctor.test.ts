/**
 * The TRDD corpus lints clean — enforced, not merely detectable.
 *
 * WHY A TEST AND NOT JUST A SCRIPT. A linter nobody runs is a linter that does not
 * exist. Ten TRDDs sat in the OPEN-work zone with no `column:` for three months, and
 * every board query silently omitted them — the failure mode of a missing field is a
 * SILENCE, and silence reads as "there is nothing there". A script would have caught
 * it *if someone had thought to run it*. This test means the corpus cannot rot without
 * turning CI red.
 *
 * The suite has two halves, deliberately:
 *   1. UNIT — synthetic fixtures prove each rule FIRES. A rule that cannot be made to
 *      fail is not a check (a green assertion over an empty finding list is `[] === []`).
 *   2. CORPUS — the real design/ tree must have zero ERRORs. This is the gate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { lintCorpus, fixCorpus, expectedZone, VALID_COLUMNS, AUTHORITY_RANK } from '@/lib/trdd-doctor'
import { DEFAULT_STATUSES } from '@/types/task'

let tmp: string

function write(zone: string, name: string, content: string) {
  const dir = path.join(tmp, zone)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), content, 'utf8')
}

/** A well-formed v2 TRDD. Every fixture below is this, minus exactly one thing. */
function good(id: string, over: Record<string, string> = {}): string {
  const fm: Record<string, string> = {
    'trdd-id': id,
    title: `Title for ${id}`,
    column: 'dev',
    created: '2026-01-01T00:00:00+0100',
    updated: '2026-01-01T00:00:00+0100',
    'npt': '[]',
    'eht': '[]',
    'blocked-by': '[]',
    ...over,
  }
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n# TRDD-${id} — Title for ${id}\n\nbody\n`
}

const idsOf = (r: ReturnType<typeof lintCorpus>, rule: string) =>
  r.findings.filter((f) => f.rule === rule).map((f) => f.id)

describe('trdd-doctor — each rule can be made to FIRE', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-doctor-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('a clean corpus produces no findings — and is NOT vacuous', () => {
    write('tasks', 'TRDD-20260101_000000+0100-AAAAAAAA-ok.md', good('AAAAAAAA'))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1) // non-vacuity: the linter actually SAW the file
    expect(r.findings).toEqual([])
  })

  it('COLUMN-MISSING — the exact bug that hid 10 TRDDs for three months', () => {
    const noCol = good('BBBBBBBB').replace(/^column:.*$/m, '')
    write('tasks', 'TRDD-20260101_000000+0100-BBBBBBBB-x.md', noCol)
    expect(idsOf(lintCorpus(tmp), 'COLUMN-MISSING')).toContain('BBBBBBBB')
  })

  it('RETIRED-STATUS-FIELD — v1 `status:` is a second state field, i.e. a second truth', () => {
    write('tasks', 'TRDD-20260101_000000+0100-CCCCCCCC-x.md', good('CCCCCCCC', { status: 'not-started' }))
    expect(idsOf(lintCorpus(tmp), 'RETIRED-STATUS-FIELD')).toContain('CCCCCCCC')
  })

  it('COLUMN-UNKNOWN — a column outside the ratified 17 is rejected', () => {
    write('tasks', 'TRDD-20260101_000000+0100-DDDDDDDD-x.md', good('DDDDDDDD', { column: 'in-progress' }))
    expect(idsOf(lintCorpus(tmp), 'COLUMN-UNKNOWN')).toContain('DDDDDDDD')
  })

  it('ZONE-MISMATCH — a terminal card left in design/tasks makes the OPEN count a lie', () => {
    write('tasks', 'TRDD-20260101_000000+0100-EEEEEEEE-x.md', good('EEEEEEEE', { column: 'complete' }))
    expect(idsOf(lintCorpus(tmp), 'ZONE-MISMATCH')).toContain('EEEEEEEE')
  })

  it('ZONE-MISMATCH does NOT fire for `complete` with release-via — it still has stages ahead', () => {
    write('tasks', 'TRDD-20260101_000000+0100-FFFFFFFF-x.md',
      good('FFFFFFFF', { column: 'complete', 'release-via': 'publish' }))
    expect(idsOf(lintCorpus(tmp), 'ZONE-MISMATCH')).not.toContain('FFFFFFFF')
  })

  it('MANDATE-FORGED — a self-issued mandate above your rank is not an approval', () => {
    write('tasks', 'TRDD-20260101_000000+0100-GGGGGGGG-x.md', good('GGGGGGGG', {
      mandate: 'true',
      'mandated-by': 'orchestrator',
      'min-approval-requirement': 'manager',
    }))
    expect(idsOf(lintCorpus(tmp), 'MANDATE-FORGED')).toContain('GGGGGGGG')
  })

  it('MANDATE-FORGED does NOT fire when the issuer outranks the floor', () => {
    write('tasks', 'TRDD-20260101_000000+0100-HHHHHHHH-x.md', good('HHHHHHHH', {
      mandate: 'true',
      'mandated-by': 'manager',
      'min-approval-requirement': 'chief-of-staff',
    }))
    expect(idsOf(lintCorpus(tmp), 'MANDATE-FORGED')).toEqual([])
  })

  it('FALSE-COMPLETION — a parent is not complete while its flock is open', () => {
    write('archived', 'TRDD-20260101_000000+0100-IIIIIIII-p.md',
      good('IIIIIIII', { column: 'completed', eht: '[JJJJJJJJ]' }))
    write('tasks', 'TRDD-20260101_000000+0100-JJJJJJJJ-c.md',
      good('JJJJJJJJ', { column: 'dev', derived: 'true', 'parent-trdd': 'IIIIIIII' }))
    expect(idsOf(lintCorpus(tmp), 'FALSE-COMPLETION')).toContain('IIIIIIII')
  })

  it('DERIVED-ORPHAN — a platelet no parent claims can never gate anyone', () => {
    write('tasks', 'TRDD-20260101_000000+0100-KKKKKKKK-x.md', good('KKKKKKKK', { derived: 'true' }))
    expect(idsOf(lintCorpus(tmp), 'DERIVED-ORPHAN')).toContain('KKKKKKKK')
  })

  it('DERIVED-DEPTH — a derived TRDD may not have derived TRDDs of its own', () => {
    write('tasks', 'TRDD-20260101_000000+0100-LLLLLLLL-p.md', good('LLLLLLLL', { eht: '[MMMMMMMM]' }))
    write('tasks', 'TRDD-20260101_000000+0100-MMMMMMMM-c.md',
      good('MMMMMMMM', { derived: 'true', 'derived-kind': 'eht', eht: '[NNNNNNNN]' }))
    write('tasks', 'TRDD-20260101_000000+0100-NNNNNNNN-g.md', good('NNNNNNNN', { derived: 'true' }))
    expect(idsOf(lintCorpus(tmp), 'DERIVED-DEPTH')).toContain('MMMMMMMM')
  })

  it('DANGLING-REF — an edge pointing at nothing silently never resolves', () => {
    write('tasks', 'TRDD-20260101_000000+0100-OOOOOOOO-x.md',
      good('OOOOOOOO', { column: 'blocked', 'blocked-by': '[ZZZZZZZZ]' }))
    expect(idsOf(lintCorpus(tmp), 'DANGLING-REF')).toContain('OOOOOOOO')
  })

  it('ID-DUPLICATE — a citation by id must identify exactly one TRDD', () => {
    write('tasks', 'TRDD-20260101_000000+0100-PPPPPPPP-a.md', good('PPPPPPPP'))
    write('archived', 'TRDD-20260101_000000+0100-PPPPPPPP-b.md', good('PPPPPPPP', { column: 'completed' }))
    expect(idsOf(lintCorpus(tmp), 'ID-DUPLICATE')).toContain('PPPPPPPP')
  })
})

describe('trdd-doctor — fixCorpus repairs only what is DERIVABLE', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-fix-'))
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true })
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('a file with NO frontmatter gets one built from its H1 — and lands in `todo`, never `complete`', () => {
    write('tasks', 'TRDD-abc12345-thing.md', '# TRDD-abc12345 — A thing that was never given frontmatter\n\nbody\n')
    const res = fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    expect(res).toHaveLength(1)
    const out = fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-abc12345-thing.md'), 'utf8')
    expect(out).toMatch(/^---\n/)
    expect(out).toContain('trdd-id: ABC12345')            // uppercased
    expect(out).toContain('column: todo')                  // the uncertainty law
    expect(out).toContain('title: A thing that was never given frontmatter')
    expect(out).not.toContain('column: complete')          // NEVER guessed
  })

  it('`status: not-started` migrates to `column: todo`, and the retired field is gone', () => {
    write('tasks', 'TRDD-20260101_000000+0100-QQQQQQQQ-x.md',
      good('QQQQQQQQ', { status: 'not-started' }).replace(/^column:.*$/m, ''))
    fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    const out = fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-QQQQQQQQ-x.md'), 'utf8')
    expect(out).toContain('column: todo')
    expect(out).not.toMatch(/^status:/m)
  })

  it('a redundant `status:` beside an existing `column:` is DELETED — the dead field never overwrites the live one', () => {
    // The real corpus had six of these. If the repairer treated `status:` as the source
    // of truth it would work here by luck (they agree) — and silently CORRUPT the day
    // they disagree, making the retired v1 field authoritative over the v2 state machine.
    write('tasks', 'TRDD-20260101_000000+0100-TTTTTTTT-x.md',
      good('TTTTTTTT', { column: 'ai_review', status: 'in-progress' }))
    fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    const out = fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-TTTTTTTT-x.md'), 'utf8')
    expect(out).not.toMatch(/^status:/m)      // the dead field is gone
    expect(out).toContain('column: ai_review') // the live one is UNTOUCHED (not 'dev' from the status map)
  })

  it('an UNKNOWN status falls to `todo` — it does not invent a column', () => {
    write('tasks', 'TRDD-20260101_000000+0100-RRRRRRRR-x.md',
      good('RRRRRRRR', { status: 'mostly-ish-done-probably' }).replace(/^column:.*$/m, ''))
    fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    const out = fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-RRRRRRRR-x.md'), 'utf8')
    expect(out).toContain('column: todo')
  })

  it('a missing derivation back-link is repaired from the PARENT — but only when unambiguous', () => {
    // The parent's own eht: is the evidence. One claimant + a matching parent-trdd
    // makes `derived: true` a DERIVATION, not a guess.
    write('tasks', 'TRDD-20260101_000000+0100-UUUUUUUU-p.md', good('UUUUUUUU', { eht: '[TRDD-VVVVVVVV]' }))
    write('tasks', 'TRDD-20260101_000000+0100-VVVVVVVV-c.md',
      good('VVVVVVVV', { 'parent-trdd': 'TRDD-UUUUUUUU' }))
    fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    const out = fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-VVVVVVVV-c.md'), 'utf8')
    expect(out).toContain('derived: true')
    expect(out).toContain('derived-kind: eht')
    expect(lintCorpus(tmp).findings.filter((f) => f.rule === 'DERIVED-FLAG-MISSING')).toEqual([])
  })

  it('does NOT write a back-link when TWO parents claim the same child — that is a real lineage bug', () => {
    write('tasks', 'TRDD-20260101_000000+0100-WWWWWWWW-a.md', good('WWWWWWWW', { eht: '[TRDD-YYYYYYYY]' }))
    write('tasks', 'TRDD-20260101_000000+0100-XXXXXXXX-b.md', good('XXXXXXXX', { npt: '[TRDD-YYYYYYYY]' }))
    write('tasks', 'TRDD-20260101_000000+0100-YYYYYYYY-c.md',
      good('YYYYYYYY', { 'parent-trdd': 'TRDD-WWWWWWWW' }))
    fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    const out = fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-YYYYYYYY-c.md'), 'utf8')
    expect(out).not.toContain('derived: true')  // papering over it would hide the two-parent bug
    const finding = lintCorpus(tmp).findings.find((f) => f.rule === 'DERIVED-FLAG-MISSING' && f.id === 'YYYYYYYY')
    expect(finding?.autofixable).toBe(false)
  })

  it('--dry-run writes nothing', () => {
    const before = good('SSSSSSSS', { status: 'not-started' })
    write('tasks', 'TRDD-20260101_000000+0100-SSSSSSSS-x.md', before)
    const res = fixCorpus(tmp, { dryRun: true })
    expect(res.length).toBeGreaterThan(0)
    expect(fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-SSSSSSSS-x.md'), 'utf8')).toBe(before)
  })
})

describe('the vocabulary is the ratified one', () => {
  it('carries all 17 ratified columns', () => {
    expect(DEFAULT_STATUSES).toHaveLength(17)
    for (const c of DEFAULT_STATUSES) expect(VALID_COLUMNS).toContain(c)
  })

  it('the authority ladder is strictly ordered — the mandate check depends on it', () => {
    expect(AUTHORITY_RANK['none']).toBeLessThan(AUTHORITY_RANK['orchestrator'])
    expect(AUTHORITY_RANK['orchestrator']).toBeLessThan(AUTHORITY_RANK['chief-of-staff'])
    expect(AUTHORITY_RANK['chief-of-staff']).toBeLessThan(AUTHORITY_RANK['manager'])
    expect(AUTHORITY_RANK['manager']).toBeLessThan(AUTHORITY_RANK['user'])
  })

  it('expectedZone routes each column to its zone', () => {
    expect(expectedZone('proposal', {})).toBe('proposals')
    expect(expectedZone('refused', {})).toBe('refused')
    expect(expectedZone('completed', {})).toBe('archived')
    expect(expectedZone('dev', {})).toBe('tasks')
    expect(expectedZone('failed', {})).toBe('tasks')   // failed is OPEN — retryable, never archived
    expect(expectedZone('blocked', {})).toBe('tasks')
  })
})

describe('THE GATE — the real corpus lints clean', () => {
  it('design/ has zero ERROR-level findings', () => {
    const report = lintCorpus(path.join(process.cwd(), 'design'))
    // Non-vacuity FIRST: if the corpus came back empty, the assertion below would be
    // `[] === []` and would pass while checking nothing.
    expect(report.scanned).toBeGreaterThan(100)
    const errors = report.findings.filter((f) => f.severity === 'error')
    expect(errors.map((e) => `${e.rule} ${e.id} — ${e.message.slice(0, 90)}`)).toEqual([])
  })
})
