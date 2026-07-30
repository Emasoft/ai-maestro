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
import { lintCorpus, fixCorpus, readyQueue, expectedZone, VALID_COLUMNS, AUTHORITY_RANK } from '@/lib/trdd-doctor'
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
    // The overlay metadata the D4 watchdog reads. A "well-formed" card carries them, so a
    // fixture that omits one does it DELIBERATELY — pass `{ assignee: '' }` to drop it, which
    // is what `fmHas` already treats as absent. Without these here, every fixture in the file
    // would emit META-MISSING and the clean-corpus non-vacuity test could never be clean.
    assignee: 'someone',
    'created-by': 'someone',
    'min-approval-requirement': 'none',
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

  it('STATUS-HOLDS-COLUMN-VALUE — a COLUMN value in `status:` is a second state field, i.e. a second truth', () => {
    write('tasks', 'TRDD-20260101_000000+0100-CCCCCCCC-x.md', good('CCCCCCCC', { status: 'not-started' }))
    expect(idsOf(lintCorpus(tmp), 'STATUS-HOLDS-COLUMN-VALUE')).toContain('CCCCCCCC')
  })

  // USER ruling 2026-07-30: `status:` is NOT a retired duplicate of `column:` — it carries a
  // DIFFERENT aspect, and the pillar specs already use it that way (`status: normative`). The
  // rule keyed on the FIELD NAME and was `autofixable`, so `trdd:fix` would have DELETED a
  // legitimate field the moment one appeared. Data loss from a tool, in the one place a tool
  // must not guess. This is the guard that pins the corrected shape: value, never field name.
  it('STATUS-HOLDS-COLUMN-VALUE — a non-column `status:` is LEGITIMATE and must not be flagged at all', () => {
    write('tasks', 'TRDD-20260101_000000+0100-CCCCCCCD-x.md', good('CCCCCCCD', { status: 'normative' }))
    const findings = lintCorpus(tmp).findings.filter(f => f.id === 'CCCCCCCD')
    expect(findings.map(f => f.rule)).not.toContain('STATUS-HOLDS-COLUMN-VALUE')
    // Positive control: the card is otherwise clean, so nothing else may fire either — an
    // empty result here could otherwise mean the fixture never reached the rule at all.
    expect(findings).toEqual([])
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
    expect(idsOf(lintCorpus(tmp), 'GRAPH-FALSE-COMPLETE')).toContain('IIIIIIII')
  })

  it('DERIVED-ORPHAN — a platelet no parent claims can never gate anyone', () => {
    write('tasks', 'TRDD-20260101_000000+0100-KKKKKKKK-x.md', good('KKKKKKKK', { derived: 'true' }))
    expect(idsOf(lintCorpus(tmp), 'GRAPH-UNCLAIMED')).toContain('KKKKKKKK')
  })

  it('DERIVED-DEPTH — a derived TRDD may not have derived TRDDs of its own', () => {
    write('tasks', 'TRDD-20260101_000000+0100-LLLLLLLL-p.md', good('LLLLLLLL', { eht: '[MMMMMMMM]' }))
    write('tasks', 'TRDD-20260101_000000+0100-MMMMMMMM-c.md',
      good('MMMMMMMM', { derived: 'true', 'derived-kind': 'eht', eht: '[NNNNNNNN]' }))
    write('tasks', 'TRDD-20260101_000000+0100-NNNNNNNN-g.md', good('NNNNNNNN', { derived: 'true' }))
    expect(idsOf(lintCorpus(tmp), 'GRAPH-DEPTH1')).toContain('MMMMMMMM')
  })

  // ================== ORDER — the invariant that actually matters ==================
  // Timing is noise: a card may wait a month and nothing is wrong. Work proceeding OUT
  // OF ORDER is always wrong. These are the errors; STALE-COLUMN is only a warn.

  it('ORDER-BLOCKER-IGNORED — a live blocker MUST show as blocked, or someone starts it out of order', () => {
    write('tasks', 'TRDD-20260101_000000+0100-A1A1A1A1-b.md', good('A1A1A1A1', { column: 'dev' }))
    write('tasks', 'TRDD-20260101_000000+0100-A2A2A2A2-x.md',
      good('A2A2A2A2', { column: 'dev', 'blocked-by': '[TRDD-A1A1A1A1]' }))
    expect(idsOf(lintCorpus(tmp), 'GRAPH-BLOCKED-NOT-BLOCKED')).toContain('A2A2A2A2')
  })

  // The regression this test exists to prevent: the doctor once had its own cycle
  // walker, I deleted it as a duplicate, and the owner's `cycle` rule turned out to
  // cover only the 2-node DERIVATION case — so a blocked-by ring of length 3 passed
  // clean. A ring is the one defect time cannot heal: nothing in it can EVER start.
  it('GRAPH-ORDER-CYCLE — a blocked-by ring of ANY length is a deadlock, not a wait', () => {
    write('tasks', 'TRDD-20260101_000000+0100-C1C1C1C1-a.md',
      good('C1C1C1C1', { column: 'blocked', 'blocked-by': '[TRDD-C2C2C2C2]', 'pre-block-column': 'dev' }))
    write('tasks', 'TRDD-20260101_000000+0100-C2C2C2C2-b.md',
      good('C2C2C2C2', { column: 'blocked', 'blocked-by': '[TRDD-C3C3C3C3]', 'pre-block-column': 'dev' }))
    write('tasks', 'TRDD-20260101_000000+0100-C3C3C3C3-c.md',
      good('C3C3C3C3', { column: 'blocked', 'blocked-by': '[TRDD-C1C1C1C1]', 'pre-block-column': 'dev' }))
    const ids = idsOf(lintCorpus(tmp), 'GRAPH-ORDER-CYCLE')
    // Reported ONCE, canonicalized to the smallest id — not three times, once per entry point.
    expect(ids).toEqual(['C1C1C1C1'])
  })

  it('ORDER-STALE-BLOCK — blocked, but every blocker cleared: READY work idling unnoticed', () => {
    write('archived', 'TRDD-20260101_000000+0100-B1B1B1B1-b.md', good('B1B1B1B1', { column: 'completed' }))
    write('tasks', 'TRDD-20260101_000000+0100-B2B2B2B2-x.md', good('B2B2B2B2', {
      column: 'blocked',
      'blocked-by': '[TRDD-B1B1B1B1]',
      'pre-block-column': 'dev',
    }))
    expect(idsOf(lintCorpus(tmp), 'GRAPH-DANGLING-BLOCKER')).toContain('B2B2B2B2')
  })

  it('ORDER-NPT-VIOLATED — a card past `dev` while its prerequisite is unfinished', () => {
    write('tasks', 'TRDD-20260101_000000+0100-C1C1C1C1-n.md', good('C1C1C1C1', { column: 'dev' }))
    write('tasks', 'TRDD-20260101_000000+0100-C2C2C2C2-p.md',
      good('C2C2C2C2', { column: 'testing', npt: '[TRDD-C1C1C1C1]' }))
    // Being TESTED against a prerequisite that does not exist yet.
    expect(idsOf(lintCorpus(tmp), 'ORDER-NPT-VIOLATED')).toContain('C2C2C2C2')
  })

  it('ORDER-NPT-VIOLATED does NOT fire while the parent is still in `dev` — NPT gates PAST dev, not dev itself', () => {
    write('tasks', 'TRDD-20260101_000000+0100-D1D1D1D1-n.md', good('D1D1D1D1', { column: 'dev' }))
    write('tasks', 'TRDD-20260101_000000+0100-D2D2D2D2-p.md',
      good('D2D2D2D2', { column: 'dev', npt: '[TRDD-D1D1D1D1]' }))
    expect(idsOf(lintCorpus(tmp), 'ORDER-NPT-VIOLATED')).toEqual([])
  })

  /**
   * A bare SCALAR ref (`npt: TRDD-X`) is legal frontmatter — `refList` accepts it, the
   * pillar index stores it as an edge, and `greptrdd why` prints it as a blocker. This
   * file's `asList` was array-only, so the WRITE GATE could not see one, in all seven of
   * its call sites. That is not a missing feature but a gate reporting no finding
   * because it looked at nothing, and it survived because every card in the live corpus
   * happens to use the array form (measured: 0 of 196) — so no live run could expose it.
   *
   * Found by TRDD-C069SK9E's walk-vs-index differential, where the walk-fed ready queue
   * called a scalar-blocked card READY and the index-fed one did not. Both directions
   * are pinned below, because the ranking and the lint are different consumers of the
   * same blindness.
   */
  it('a SCALAR npt is a real edge to the LINTER too — ORDER-NPT-VIOLATED fires on it', () => {
    write('tasks', 'TRDD-20260101_000000+0100-S1S1S1S1-n.md', good('S1S1S1S1', { column: 'dev' }))
    write('tasks', 'TRDD-20260101_000000+0100-S2S2S2S2-p.md',
      good('S2S2S2S2', { column: 'testing', npt: 'TRDD-S1S1S1S1' }))
    expect(idsOf(lintCorpus(tmp), 'ORDER-NPT-VIOLATED')).toContain('S2S2S2S2')
  })

  it('a SCALAR npt keeps a card OUT of the ready queue — it used to be reported workable', () => {
    write('tasks', 'TRDD-20260101_000000+0100-S3S3S3S3-blk.md', good('S3S3S3S3', { column: 'dev' }))
    write('tasks', 'TRDD-20260101_000000+0100-S4S4S4S4-wait.md',
      good('S4S4S4S4', { column: 'dev', npt: 'TRDD-S3S3S3S3' }))
    const ids = readyQueue(tmp).map((c) => c.id)
    // POSITIVE CONTROL — the blocker itself IS ready, so "S4 absent" is a verdict about
    // the scalar edge and not about an empty queue.
    expect(ids).toContain('S3S3S3S3')
    expect(ids).not.toContain('S4S4S4S4')
  })

  // trdd-graph's `cycle` check catches a DERIVATION ring (two TRDDs each naming the
  // other as their own npt/eht child) — NOT a general `blocked-by` chain of arbitrary
  // length. The doctor's old `findCycles()` walked BOTH blocked-by and npt edges with a
  // generic DFS and could detect a ring of any size; deleting it in favor of delegation
  // narrows cycle detection to this 2-node derivation-mutual-claim shape. A long
  // `blocked-by`-only ring (no npt/eht involved) is no longer caught by this linter —
  // a real coverage gap, out of scope here since fixing it means editing trdd-graph.ts.
  it('ORDER-CYCLE — a derivation ring: two TRDDs each claim the other as their own child', () => {
    write('tasks', 'TRDD-20260101_000000+0100-E1E1E1E1-a.md',
      good('E1E1E1E1', { eht: '[TRDD-E2E2E2E2]' }))
    write('tasks', 'TRDD-20260101_000000+0100-E2E2E2E2-b.md',
      good('E2E2E2E2', { eht: '[TRDD-E1E1E1E1]' }))
    const cyc = lintCorpus(tmp).findings.filter((f) => f.rule === 'GRAPH-CYCLE')
    expect(cyc).toHaveLength(2) // trdd-graph reports it from BOTH members' perspective, not deduplicated
    expect(cyc.map((f) => f.id).sort()).toEqual(['E1E1E1E1', 'E2E2E2E2'])
  })

  it('readyQueue — returns only cards whose prerequisites are ALL satisfied, ranked by what they unblock', () => {
    // BLK is open, so DOWN1/DOWN2 wait on it. FREE waits on nobody.
    write('tasks', 'TRDD-20260101_000000+0100-F0F0F0F0-blk.md', good('F0F0F0F0', { column: 'dev' }))
    write('tasks', 'TRDD-20260101_000000+0100-F1F1F1F1-d1.md',
      good('F1F1F1F1', { column: 'blocked', 'blocked-by': '[TRDD-F0F0F0F0]' }))
    write('tasks', 'TRDD-20260101_000000+0100-F2F2F2F2-d2.md',
      good('F2F2F2F2', { column: 'blocked', 'blocked-by': '[TRDD-F0F0F0F0]' }))
    write('tasks', 'TRDD-20260101_000000+0100-F3F3F3F3-free.md', good('F3F3F3F3', { column: 'todo' }))

    const q = readyQueue(tmp)
    const ids = q.map((r) => r.id)
    expect(ids).toContain('F0F0F0F0')
    expect(ids).toContain('F3F3F3F3')
    expect(ids).not.toContain('F1F1F1F1') // blocked — not workable
    // F0 unblocks two cards, so it OUTRANKS the free-floating card. Age never enters it.
    expect(ids[0]).toBe('F0F0F0F0')
    expect(q[0].unblocks).toBe(2)
  })

  it('DANGLING-REF — an edge pointing at nothing silently never resolves', () => {
    write('tasks', 'TRDD-20260101_000000+0100-OOOOOOOO-x.md',
      good('OOOOOOOO', { column: 'blocked', 'blocked-by': '[ZZZZZZZZ]' }))
    expect(idsOf(lintCorpus(tmp), 'GRAPH-UNKNOWN-BLOCKER')).toContain('OOOOOOOO')
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

  it('`status: not-started` migrates to `column: backburner` — the canonical v1 mapping (V1_STATUS_TO_COLUMN, owned by trdd-graph) — and the retired field is gone', () => {
    write('tasks', 'TRDD-20260101_000000+0100-QQQQQQQQ-x.md',
      good('QQQQQQQQ', { status: 'not-started' }).replace(/^column:.*$/m, ''))
    fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    const out = fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-QQQQQQQQ-x.md'), 'utf8')
    expect(out).toContain('column: backburner')
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

  // USER ruling 2026-07-30, TWO halves that must BOTH hold:
  //   (1) `column: todo` for a MISSING column is a deliberate requirement — it forces the
  //       agent to evaluate the task before acting, for the extreme case of a card with no
  //       column at all.
  //   (2) it is ONLY for a missing column. It is NOT licence to repurpose another field:
  //       `status:` carries a different aspect and MUST survive the repair.
  // The old fixer keyed on the field name and rewrote `status: X` into `column: todo`,
  // satisfying (1) by violating (2) — the original value was unrecoverable and the card then
  // asserted a state nobody chose. Both assertions below, or the guard is half a guard.
  it('an UNKNOWN status falls to `todo` — the missing column is ADDED and the status SURVIVES', () => {
    write('tasks', 'TRDD-20260101_000000+0100-RRRRRRRR-x.md',
      good('RRRRRRRR', { status: 'mostly-ish-done-probably' }).replace(/^column:.*$/m, ''))
    fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    const out = fs.readFileSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-RRRRRRRR-x.md'), 'utf8')
    expect(out).toContain('column: todo')
    expect(out).toContain('status: mostly-ish-done-probably')
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
    // Ambiguous lineage (two claimants) is NOT this doctor's own DERIVED-FLAG-MISSING
    // rule any more — that rule now fires ONLY for the unambiguous, autofixable case.
    // The two-parent case is trdd-graph's own `twoParents` violation (GRAPH-TWO-PARENTS),
    // reported under the CHILD's id, exactly where the lineage bug actually lives.
    const finding = lintCorpus(tmp).findings.find((f) => f.rule === 'GRAPH-TWO-PARENTS' && f.id === 'YYYYYYYY')
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

describe('the approval requirement — one rung, one spelling (TRDD-5THSI5ZB)', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-doctor-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('ERRORs when the two approval fields name DIFFERENT approvers', () => {
    // tier 2 decodes to 'manager'; the card also declares 'orchestrator'. Whichever field a
    // reader prefers decides who must sign off — so the card binds two different approvers.
    write('tasks', 'TRDD-20260101_000000+0100-AAAAAAAA-conflict.md',
      good('AAAAAAAA', { 'approval-tier': '2', 'min-approval-requirement': 'orchestrator' }))
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'APPROVAL-FIELD-CONFLICT')).toEqual(['AAAAAAAA'])
    expect(r.findings.find((f) => f.rule === 'APPROVAL-FIELD-CONFLICT')!.severity).toBe('error')
  })

  it('does NOT error when the two agree — it is a migration chore, not a defect', () => {
    write('tasks', 'TRDD-20260101_000000+0100-BBBBBBBB-agree.md',
      good('BBBBBBBB', { 'approval-tier': '2', 'min-approval-requirement': 'manager' }))
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'APPROVAL-FIELD-CONFLICT')).toEqual([])
    // ...and it is still reported, as the deprecation it is:
    expect(idsOf(r, 'APPROVAL-TIER-DEPRECATED')).toEqual(['BBBBBBBB'])
    expect(r.errors).toBe(0)
  })

  it('IGNORES an approval field that appears only in the BODY — the false positive that shipped', () => {
    // This is the regression that matters most. Authoring this rule, I grepped the corpus and
    // "found" a card whose two approval fields disagreed — then discovered the second one was
    // inside a fenced YAML EXAMPLE in the prose, 14 lines below the frontmatter. A grep hit is
    // not a frontmatter fact. The linter reads the PARSED frontmatter and was right where I was
    // wrong; this test is what keeps it right if someone ever "improves" it into a raw scan.
    // The frontmatter carries ONLY the tier — exactly like the real card. The second field
    // exists solely in the prose below, which is what made the grep look like a conflict.
    const card = good('CCCCCCCC', { 'approval-tier': '2', 'min-approval-requirement': '' }) +
      '\nThe forgeable pattern looks like this:\n\n```yaml\nmin-approval-requirement: orchestrator\n```\n'
    write('tasks', 'TRDD-20260101_000000+0100-CCCCCCCC-body-example.md', card)
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'APPROVAL-FIELD-CONFLICT')).toEqual([])
    expect(r.errors).toBe(0)
  })
})

describe('META-MISSING is scoped to the zones the D4 watchdog actually scans (TRDD-5THSI5ZB)', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-doctor-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const fieldsFor = (r: ReturnType<typeof lintCorpus>, id: string) =>
    r.findings.filter((f) => f.rule === 'META-MISSING' && f.id === id)
      .map((f) => f.message.replace(/^no `([a-z-]+):.*/s, '$1')).sort()

  /** Drop the three overlay fields — `fmHas` reads an empty value as absent. */
  const bare = { assignee: '', 'created-by': '', 'min-approval-requirement': '' }

  it('names the missing overlay fields on an OPEN card', () => {
    write('tasks', 'TRDD-20260101_000000+0100-DDDDDDDD-open.md', good('DDDDDDDD', bare))
    expect(fieldsFor(lintCorpus(tmp), 'DDDDDDDD'))
      .toEqual(['assignee', 'created-by', 'min-approval-requirement'])
  })

  it('stays SILENT on an archived card — outside the watchdog scan set, so no consumer breaks', () => {
    // Not politeness: the §D4 watchdog scans design/tasks + design/proposals and nothing else.
    // Flagging archived work added 218 findings that named no broken reader, and a wall of
    // warnings is how a linter gets routed around — which costs every finding it would make.
    write('archived', 'TRDD-20260101_000000+0100-EEEEEEEE-done.md',
      good('EEEEEEEE', { ...bare, column: 'completed' }))
    expect(fieldsFor(lintCorpus(tmp), 'EEEEEEEE')).toEqual([])
  })

  it('does not ask a PROPOSAL for an assignee — unassigned is what a proposal IS', () => {
    write('proposals', 'TRDD-20260101_000000+0100-FFFFFFFF-prop.md',
      good('FFFFFFFF', { ...bare, column: 'proposal' }))
    const fields = fieldsFor(lintCorpus(tmp), 'FFFFFFFF')
    expect(fields).not.toContain('assignee')
    expect(fields).toContain('created-by')
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
