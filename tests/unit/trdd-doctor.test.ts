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
import {
  lintCorpus,
  fixCorpus,
  readyQueue,
  expectedZone,
  VALID_COLUMNS,
  AUTHORITY_RANK,
  countAcceptanceBoxes,
  frontmatterDay,
  CHECKLIST_GATE_SINCE,
} from '@/lib/trdd-doctor'
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

  // BODY-STATE-CLAIM (3P-TRDD-10). The janitor's drift detector reported three plugin cards as
  // `status='not-started' but untouched for 35d`; two greps of `^status:` / `^column:` found
  // nothing, so the finding was called an artifact — twice, in a commit message. The value was
  // on line 19 as `**Status:** Not started`, a third spelling neither grep covered. Ten of THIS
  // corpus's cards carry one and `greptrdd validate` reported 0 errors, because no rule looked.
  it('BODY-STATE-CLAIM — a body claim that CONTRADICTS `column:` is a card asserting two states at once', () => {
    // `Not started` maps (v1) to `backburner`, and the card says `column: dev`.
    write('tasks', 'TRDD-20260101_000000+0100-CCCCCCCE-x.md', `${good('CCCCCCCE')}\n**Status:** Not started — deferred\n`)
    const f = lintCorpus(tmp).findings.filter((x) => x.rule === 'BODY-STATE-CLAIM')
    expect(f.map((x) => x.id)).toContain('CCCCCCCE')
    expect(f[0].severity).toBe('error')
    // Never auto-repaired: which of the two states is true is a judgement, not a derivation.
    expect(f[0].autofixable).toBe(false)
  })

  // The WARN half. It is a SEPARATE fixture on purpose: the rule's first cut compared the whole
  // claim line against the column, and since every real claim carries a trailing explanation
  // ("Not started — deferred…"), agreement was UNREACHABLE — the WARN severity and the only
  // auto-repairable case were both dead code, and a 10-for-10 ERROR run looked like proof the
  // rule worked. This fixture is what makes that branch exist.
  it('BODY-STATE-CLAIM — a body claim that AGREES is a mere duplicate, so WARN and repairable', () => {
    // `In progress` → v1 map → `dev`, which is what `good()` sets. Exercises the map AND the
    // space→hyphen normalization, so a claim written the way humans write it still matches.
    write('tasks', 'TRDD-20260101_000000+0100-CCCCCCCF-x.md', `${good('CCCCCCCF')}\n**Status:** In progress\n`)
    const f = lintCorpus(tmp).findings.filter((x) => x.rule === 'BODY-STATE-CLAIM')
    expect(f.map((x) => x.id)).toContain('CCCCCCCF')
    expect(f[0].severity).toBe('warn')
    expect(f[0].autofixable).toBe(true)
  })

  // The frontmatter boundary is COMPUTED, never assumed. Without that, this rule would reach a
  // frontmatter `status:` and double-report what STATUS-HOLDS-COLUMN-VALUE already owns — two
  // rules, two messages, one defect each.
  it('BODY-STATE-CLAIM — a FRONTMATTER `status:` is the sibling rule\'s job, not this one\'s', () => {
    write('tasks', 'TRDD-20260101_000000+0100-CCCCCCD0-x.md', good('CCCCCCD0', { status: 'not-started' }))
    const rules = lintCorpus(tmp).findings.filter((x) => x.id === 'CCCCCCD0').map((x) => x.rule)
    expect(rules).not.toContain('BODY-STATE-CLAIM')
    // Positive control: the sibling rule DID fire, so the fixture reached the lint at all. An
    // absence assertion alone passes just as happily when nothing was ever scanned.
    expect(rules).toContain('STATUS-HOLDS-COLUMN-VALUE')
  })

  // The self-match trap. A rule that scans bodies for a pattern matches its OWN documentation:
  // TRDD-FKGMNGJB, which specifies this rule, quotes `**Status:**` three times, and the card
  // that reports the janitor's grep quotes it inside a fence. Flagging the card that defines the
  // rule is the same failure as a source scanner flagging its own pattern table.
  it('BODY-STATE-CLAIM — a FENCED or QUOTED claim is documentation, not the card\'s own claim', () => {
    const body = [
      good('CCCCCCD1'),
      '```',
      '**Status:** Not started',
      '```',
      '',
      '> **Status:** Not started   ← a relayed report, evidence not assertion',
      '',
    ].join('\n')
    write('tasks', 'TRDD-20260101_000000+0100-CCCCCCD1-x.md', body)
    const f = lintCorpus(tmp).findings.filter((x) => x.id === 'CCCCCCD1')
    expect(f.map((x) => x.rule)).not.toContain('BODY-STATE-CLAIM')
    // Positive control: the card is otherwise clean, so an empty result cannot be hiding a
    // fixture that never parsed.
    expect(f).toEqual([])
  })

  it('COLUMN-UNKNOWN — a column outside the ratified 17 is rejected', () => {
    write('tasks', 'TRDD-20260101_000000+0100-DDDDDDDD-x.md', good('DDDDDDDD', { column: 'in-progress' }))
    expect(idsOf(lintCorpus(tmp), 'COLUMN-UNKNOWN')).toContain('DDDDDDDD')
  })

  it('ZONE-MISMATCH — a terminal card left in design/tasks makes the OPEN count a lie', () => {
    write('tasks', 'TRDD-20260101_000000+0100-EEEEEEEE-x.md', good('EEEEEEEE', { column: 'complete' }))
    expect(idsOf(lintCorpus(tmp), 'ZONE-MISMATCH')).toContain('EEEEEEEE')
  })

  // The MIRROR shape of the test above, and the one TRDD-36RGLVYH asked for by name. A terminal
  // card in tasks/ inflates the OPEN count; a WORKING card in archived/ does the opposite — it
  // hides live work in the done pile, where nobody reads it. Same rule, opposite direction, and
  // only one of the two directions was pinned: `expectedZone('dev') === 'tasks'` was covered as a
  // pure mapping, which proves nothing about lintCorpus emitting on a real misplaced FILE.
  //
  // NEUTER RUN (2026-08-21 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
  //   s/if (WORKING_COLUMNS.includes(column)) return 'tasks'/… return null/
  //   → 2 red / 82 green:
  //       expectedZone routes each column to its zone
  //       ZONE-MISMATCH — a WORKING card parked in design/archived hides live work in the done pile
  // Both read the same branch, which is the point: the mapping test alone would have stayed the
  // ONLY guard, and it cannot see whether lintCorpus ever emits.
  it('ZONE-MISMATCH — a WORKING card parked in design/archived hides live work in the done pile', () => {
    write('archived', 'TRDD-20260101_000000+0100-EFEFEFEF-x.md', good('EFEFEFEF', { column: 'dev' }))
    expect(idsOf(lintCorpus(tmp), 'ZONE-MISMATCH')).toContain('EFEFEFEF')
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

  it('an AGREEING body state claim is dropped — the duplicate line goes, the card does not', () => {
    const file = 'TRDD-20260101_000000+0100-BSCAGREE-x.md'
    write('tasks', file, `${good('BSCAGREE')}\n**Status:** In progress\n\nkeep this paragraph.\n`)
    const res = fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    expect(res).toHaveLength(1)
    const out = fs.readFileSync(path.join(tmp, 'tasks', file), 'utf8')
    expect(out).not.toMatch(/\*\*Status:\*\*/)
    // Surgical: only that line. The surrounding body and the frontmatter survive intact —
    // a repair that removes a line must not reflow the document around it.
    expect(out).toContain('keep this paragraph.')
    expect(out).toContain('column: dev')
    expect(out).toContain('# TRDD-BSCAGREE — Title for BSCAGREE')
  })

  // The refusal is the load-bearing half. Four of this corpus's cards say `column: complete`
  // beside `**Status:** Not started` and EITHER could be the truth; a fixer that picks one
  // silently is how a tool loses work. So the disagreeing case must come out byte-identical —
  // not "mostly unchanged", not "the claim rewritten to match" — and the lint reports it for a
  // human instead.
  it('a DISAGREEING body state claim is REFUSED — the file is left byte-identical', () => {
    const file = 'TRDD-20260101_000000+0100-BSCFIGHT-x.md'
    const before = `${good('BSCFIGHT')}\n**Status:** Not started — deferred\n`
    write('tasks', file, before)
    fixCorpus(tmp, { now: '2026-07-13T12:00:00+0200' })
    expect(fs.readFileSync(path.join(tmp, 'tasks', file), 'utf8')).toBe(before)
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

/**
 * `updated:` moves ONLY for a repair that changed what the card ASSERTS (TRDD-R6R9XHZI).
 *
 * The board is READ in `updated:` order, so an unconditional bump made a corpus-wide
 * `yarn trdd:fix` reorder the view every human and agent consults — invisibly, since nothing
 * in the output said the sort key had moved. The rule (`trdd-design-tasks.md`, corrected
 * 2026-07-31) forbids it for a MECHANICAL repair specifically.
 *
 * EVERY mechanical test below asserts TWO things: that the repair LANDED, and that `updated:`
 * did not move. The second assertion alone is vacuous — "no `updated:` changed" is satisfied
 * just as well by a fixer that repaired nothing at all.
 */
describe('trdd-doctor — the `updated:` bump is conditional on the repair being SEMANTIC', () => {
  const NOW = '2026-07-13T12:00:00+0200'
  const ORIG = 'updated: 2026-01-01T00:00:00+0100'

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-bump-'))
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true })
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const read = (name: string) => fs.readFileSync(path.join(tmp, 'tasks', name), 'utf8')

  // ---- MECHANICAL: the card asserts exactly what it asserted before ----

  // The card's headline case. The parent's own `eht:` ALREADY asserted this derivation; the
  // child's `derived:` is a denormalized copy of it. Restoring the copy changes no fact — and
  // this is the repair a corpus-wide pass fires most often, so it is the one that reordered
  // the whole board.
  it('MECHANICAL — a derivation back-link repair leaves `updated:` byte-identical', () => {
    write('tasks', 'TRDD-20260101_000000+0100-MECHBKLN-p.md', good('MECHBKLN', { eht: '[TRDD-MECHCHLD]' }))
    write('tasks', 'TRDD-20260101_000000+0100-MECHCHLD-c.md', good('MECHCHLD', { 'parent-trdd': 'TRDD-MECHBKLN' }))
    const res = fixCorpus(tmp, { now: NOW })
    const out = read('TRDD-20260101_000000+0100-MECHCHLD-c.md')
    expect(out).toContain('derived: true')                 // the repair LANDED (non-vacuity)
    expect(out).toContain(ORIG)                            // ...and the sort key did NOT move
    expect(out).not.toContain(NOW)
    expect(res.find((r) => r.id === 'MECHCHLD')?.bumped).toBe(false)
  })

  it('MECHANICAL — uppercasing `trdd-id` leaves `updated:` untouched (an id is matched case-insensitively)', () => {
    write('tasks', 'TRDD-20260101_000000+0100-MECHCASE-x.md', good('mechcase'))
    const res = fixCorpus(tmp, { now: NOW })
    const out = read('TRDD-20260101_000000+0100-MECHCASE-x.md')
    expect(out).toContain('trdd-id: MECHCASE')
    expect(out).toContain(ORIG)
    expect(res[0].bumped).toBe(false)
  })

  it('MECHANICAL — dropping an AGREEING body state claim leaves `updated:` untouched', () => {
    const file = 'TRDD-20260101_000000+0100-MECHBODY-x.md'
    write('tasks', file, `${good('MECHBODY')}\n**Status:** In progress\n\nkeep this.\n`)
    const res = fixCorpus(tmp, { now: NOW })
    const out = read(file)
    expect(out).not.toMatch(/\*\*Status:\*\*/)
    expect(out).toContain(ORIG)
    expect(res[0].bumped).toBe(false)
  })

  // The verdict for this branch is COMPUTED, not fixed — see the disagreeing twin below.
  // `in-progress` maps to `dev`, which is exactly the column here, so the card said one
  // state twice and now says it once.
  it('MECHANICAL — dropping an AGREEING redundant `status:` leaves `updated:` untouched', () => {
    write('tasks', 'TRDD-20260101_000000+0100-MECHSTAT-x.md',
      good('MECHSTAT', { column: 'dev', status: 'in-progress' }))
    const res = fixCorpus(tmp, { now: NOW })
    const out = read('TRDD-20260101_000000+0100-MECHSTAT-x.md')
    expect(out).not.toMatch(/^status:/m)
    expect(out).toContain(ORIG)
    expect(res[0].bumped).toBe(false)
  })

  // ---- SEMANTIC: the card now claims something it did not ----

  it('SEMANTIC — inventing a missing `column: todo` MOVES `updated:` (nobody chose that state)', () => {
    write('tasks', 'TRDD-20260101_000000+0100-SEMANOCO-x.md',
      good('SEMANOCO').replace(/^column:.*$/m, ''))
    const res = fixCorpus(tmp, { now: NOW })
    const out = read('TRDD-20260101_000000+0100-SEMANOCO-x.md')
    expect(out).toContain('column: todo')
    expect(out).toContain(`updated: ${NOW}`)
    expect(out).not.toContain(ORIG)
    expect(res[0].bumped).toBe(true)
  })

  // The VALUE is unchanged here, and it is still semantic: nothing reads `status:` for a
  // pipeline position, so before the repair this card was column-less to the board. It JOINS
  // the board — a pipeline claim it was not making.
  it('SEMANTIC — migrating `status:` into `column:` MOVES `updated:` (the card joins the board)', () => {
    write('tasks', 'TRDD-20260101_000000+0100-SEMAMIGR-x.md',
      good('SEMAMIGR', { status: 'not-started' }).replace(/^column:.*$/m, ''))
    const res = fixCorpus(tmp, { now: NOW })
    const out = read('TRDD-20260101_000000+0100-SEMAMIGR-x.md')
    expect(out).toContain('column: backburner')
    expect(out).toContain(`updated: ${NOW}`)
    expect(res[0].bumped).toBe(true)
  })

  // The pair that proves the verdict is COMPUTED per sub-case rather than fixed per branch:
  // the SAME line of code produced `bumped: false` for the agreeing fixture above and `true`
  // here. A blanket verdict on this branch passes one of the two and fails the other.
  it('SEMANTIC — dropping a DISAGREEING `status:` MOVES `updated:` (one of two competing claims is gone)', () => {
    write('tasks', 'TRDD-20260101_000000+0100-SEMAFGHT-x.md',
      good('SEMAFGHT', { column: 'ai_review', status: 'in-progress' }))
    const res = fixCorpus(tmp, { now: NOW })
    const out = read('TRDD-20260101_000000+0100-SEMAFGHT-x.md')
    expect(out).not.toMatch(/^status:/m)
    expect(out).toContain('column: ai_review')
    expect(out).toContain(`updated: ${NOW}`)
    expect(res[0].bumped).toBe(true)
  })

  it('a card with BOTH kinds of repair bumps — one semantic change is enough', () => {
    write('tasks', 'TRDD-20260101_000000+0100-MIXEDCAS-x.md',
      good('mixedcas').replace(/^column:.*$/m, ''))    // lowercase id (mechanical) + no column (semantic)
    const res = fixCorpus(tmp, { now: NOW })
    const out = read('TRDD-20260101_000000+0100-MIXEDCAS-x.md')
    expect(out).toContain('trdd-id: MIXEDCAS')
    expect(out).toContain('column: todo')
    expect(out).toContain(`updated: ${NOW}`)
    expect(res[0].bumped).toBe(true)
  })

  /**
   * The acceptance proof from `Emasoft/ai-maestro#96` law 8, at corpus scale: a run in which
   * every repair is mechanical must change ZERO `updated:` lines. That is what makes a
   * migration AUDITABLE afterwards — a run that bumped dates can never be shown to have been
   * lossless, because the evidence it would need is the thing it overwrote.
   */
  it('a mechanical-only run over a whole corpus changes ZERO `updated:` lines', () => {
    write('tasks', 'TRDD-20260101_000000+0100-CORPPARN-p.md', good('CORPPARN', { npt: '[TRDD-CORPCHLD]' }))
    write('tasks', 'TRDD-20260101_000000+0100-CORPCHLD-c.md', good('CORPCHLD', { 'parent-trdd': 'TRDD-CORPPARN' }))
    write('tasks', 'TRDD-20260101_000000+0100-CORPCASE-x.md', good('corpcase'))
    write('tasks', 'TRDD-20260101_000000+0100-CORPBODY-x.md', `${good('CORPBODY')}\n**Status:** In progress\n`)
    write('tasks', 'TRDD-20260101_000000+0100-CORPSTAT-x.md', good('CORPSTAT', { column: 'dev', status: 'in-progress' }))

    const res = fixCorpus(tmp, { now: NOW })
    expect(res.length).toBe(4)                                  // four cards really were repaired
    expect(res.every((r) => r.changes.length > 0)).toBe(true)
    expect(res.filter((r) => r.bumped)).toEqual([])             // ...and not one sort key moved

    const all = fs.readdirSync(path.join(tmp, 'tasks')).map(read).join('\n')
    expect(all).not.toContain(NOW)
    expect(all.match(/^updated: 2026-01-01T00:00:00\+0100$/gm)).toHaveLength(5)
  })
})

describe('the vocabulary is the ratified one', () => {
  it('carries all 22 ratified columns', () => {
    expect(DEFAULT_STATUSES).toHaveLength(22)
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

/**
 * The terminal-column completion gate — `aimaestro-trdd-approval.md` §D4 step 5b.
 *
 * The rule shipped RATIFIED and enforced by nothing, which is the same vacuity it was itself
 * written to close: on 2026-07-31 TRDD-9QV4ZCYY fixed its TEXT (a condition stated only over
 * UNCHECKED boxes passes a card with NO boxes), and the repaired rule then had no enforcer, so
 * the corpus never changed. These tests are the enforcer's proof.
 *
 * WHY EVERY SHAPE IS SEEDED. The gate emits ZERO findings on today's live corpus (measured:
 * 165 grandfathered, 33 past the boundary, all 33 compliant). A "zero findings on the real
 * corpus" criterion therefore cannot distinguish a working rule from a blind one — it is the
 * exact instrument that reports clean either way. So each shape below is seeded on purpose,
 * and each of the four NOT-flagged cases is a real exclusion the rule makes, not an accident.
 */
describe('the terminal-column checklist gate — every shape, seeded', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-gate-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const POST = '2026-08-01T10:00:00+0200' // after CHECKLIST_GATE_SINCE
  const PRE = '2026-07-20T10:00:00+0200'  // before it — grandfathered

  /** A terminal card in the archived zone, with whatever checklist you hand it. */
  const closed = (id: string, updated: string, boxes: string, column = 'completed') =>
    `${good(id, { column, updated })}\n## Acceptance\n\n${boxes}\n`

  it('FIRES: terminal after the boundary with NO checklist — the gate that read nothing', () => {
    write('archived', 'TRDD-20260101_000000+0100-NOBOXES1-x.md', closed('NOBOXES1', POST, ''))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1) // non-vacuity: the linter saw the file
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual(['NOBOXES1'])
  })

  it('FIRES: terminal after the boundary with an UNCHECKED box — a false completion', () => {
    write('archived', 'TRDD-20260101_000000+0100-OPENBOX1-x.md',
      closed('OPENBOX1', POST, '- [x] done thing\n- [ ] undone thing'))
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'TERMINAL-WITH-OPEN-BOX')).toEqual(['OPENBOX1'])
    // The two rules are exclusive: a card with boxes is never ALSO reported as having none.
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual([])
  })

  it('SILENT: terminal after the boundary with every box checked — the positive control', () => {
    write('archived', 'TRDD-20260101_000000+0100-ALLDONE1-x.md',
      closed('ALLDONE1', POST, '- [x] one\n- [x] two'))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual([])
    expect(idsOf(r, 'TERMINAL-WITH-OPEN-BOX')).toEqual([])
  })

  it('SILENT: terminal BEFORE the boundary — grandfathered, because a frozen card cannot be repaired', () => {
    // 46 archived cards closed with no checklist. IND base step 12 FREEZES a terminal card's
    // body, so flagging them is a permanent wall of warnings about work nobody may fix —
    // which is precisely how a linter gets routed around.
    write('archived', 'TRDD-20260101_000000+0100-OLDCARD1-x.md', closed('OLDCARD1', PRE, ''))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual([])
  })

  it('SILENT: a NON-terminal card with no checklist — the gate binds the transition, not the whole life', () => {
    // 22 `planned` cards have no boxes for a good reason: they have not been designed yet.
    write('tasks', 'TRDD-20260101_000000+0100-PLANNED1-x.md',
      good('PLANNED1', { column: 'planned', updated: POST }))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual([])
  })

  it('SILENT: `cancelled` and `superseded` — open boxes are what those columns MEAN', () => {
    // Abandoned work and overtaken work are not required to be finished. Demanding a complete
    // checklist from them would make the honest closure of a dead card impossible.
    write('archived', 'TRDD-20260101_000000+0100-CANCEL01-x.md', closed('CANCEL01', POST, '', 'cancelled'))
    write('archived', 'TRDD-20260101_000000+0100-SUPERS01-x.md',
      closed('SUPERS01', POST, '- [ ] never finished', 'superseded'))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(2)
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual([])
    expect(idsOf(r, 'TERMINAL-WITH-OPEN-BOX')).toEqual([])
  })

  it('FIRES: boxes that exist ONLY inside a fenced block do not count — the self-match trap', () => {
    // TRDD-5YRLA53W, the card that SPECIFIES this gate, carries a fenced
    // `grep -cE '^- \[[ x~]\]'` in its measurement recipe. A counter that reads fenced code
    // credits the rule's own documentation as a checklist — the same trap the body-state-claim
    // scanner already had to solve one rule over.
    write('archived', 'TRDD-20260101_000000+0100-FENCED01-x.md',
      closed('FENCED01', POST, '```bash\n- [x] not a real box\n- [ ] nor this\n```'))
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual(['FENCED01'])
    expect(idsOf(r, 'TERMINAL-WITH-OPEN-BOX')).toEqual([])
  })

  it('SILENT: `[~]` counts as a decision, not an outstanding obligation', () => {
    write('archived', 'TRDD-20260101_000000+0100-STRUCK01-x.md',
      closed('STRUCK01', POST, '- [x] shipped\n- [~] dropped, with its reason'))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(idsOf(r, 'TERMINAL-WITH-OPEN-BOX')).toEqual([])
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual([])
  })

  it('the gate covers every terminal spelling that asserts completion', () => {
    for (const [i, col] of ['complete', 'completed', 'published', 'live'].entries()) {
      const id = `TERMCOL${i}`
      write('archived', `TRDD-20260101_000000+0100-${id}-x.md`, closed(id, POST, '', col))
    }
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST').sort())
      .toEqual(['TERMCOL0', 'TERMCOL1', 'TERMCOL2', 'TERMCOL3'])
  })
})

describe('the gate primitives — both date shapes, and what a box is', () => {
  // BOTH branches are pinned rather than one assumed. A YAML reader may hand back an ISO
  // string or a parsed Date depending on its timestamp settings, and `String(someDate)` is
  // "Fri Jul 31 2026 …" — whose first ten characters are not a date, so a string-only reader
  // would compare garbage and quietly grandfather every card forever.
  it('frontmatterDay reads an ISO string', () => {
    expect(frontmatterDay('2026-08-02T15:37:19+0200')).toBe('2026-08-02')
  })

  it('frontmatterDay reads a parsed Date', () => {
    expect(frontmatterDay(new Date('2026-08-02T13:37:19Z'))).toBe('2026-08-02')
  })

  it('frontmatterDay returns empty for absent, malformed, and invalid input', () => {
    expect(frontmatterDay(undefined)).toBe('')
    expect(frontmatterDay('soon')).toBe('')
    expect(frontmatterDay(new Date('nonsense'))).toBe('')
  })

  it('an empty day never satisfies the boundary — a card with no `updated:` is not swept in', () => {
    // String-compares against the boundary: '' < '2026-07-31' is true, so the guard must be
    // `day && day >= SINCE`, not `day >= SINCE`. A dateless card is UPDATED-MISSING's finding,
    // not this rule's.
    expect(frontmatterDay('') >= CHECKLIST_GATE_SINCE).toBe(false)
  })

  it('countAcceptanceBoxes separates total from open, and ignores fenced code', () => {
    const body = [
      '---', 'trdd-id: X', '---', '',
      '- [x] one', '- [ ] two', '- [~] three', '  - [ ] nested counts too',
      '```', '- [ ] fenced does not', '```',
      '- not a box at all',
    ].join('\n')
    expect(countAcceptanceBoxes(body)).toEqual({ total: 4, open: 2 })
  })

  it('an UNCLOSED fence under-counts rather than over-counts — the conservative direction', () => {
    const body = ['---', 'trdd-id: X', '---', '', '```', '- [ ] swallowed'].join('\n')
    expect(countAcceptanceBoxes(body)).toEqual({ total: 0, open: 0 })
  })
})

/**
 * APPROVAL-UNAPPROVED-IN-WORK-ZONE — the third arm of the approval invariant.
 *
 * The governance overlay states it as `approved: false ⟺ column ∈ {proposal, superseded}`. Two arms
 * were checked (`rejected` must sit in `refused`; an approval decision needs a judge) and this one
 * was not — so a card could claim `approved: false` from a WORKING column and nothing said a word.
 * The board then shows it as authorized work while the card itself asserts nobody signed off.
 *
 * Found 2026-08-05 while pulling TRDD-VLBVO0ZP, which is one of NINE such cards in `design/tasks/`;
 * four sit at a `manager`/`user` floor, i.e. awaiting an approval nobody had been told was
 * outstanding.
 */
describe('APPROVAL-UNAPPROVED-IN-WORK-ZONE — a card cannot be unapproved AND in the work zone', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-appr-'))
    fs.mkdirSync(path.join(tmp, 'tasks'), { recursive: true })
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const findingsFor = (id: string) =>
    lintCorpus(tmp).findings.filter((f) => f.rule === 'APPROVAL-UNAPPROVED-IN-WORK-ZONE' && f.id === id)

  it('FIRES on `approved: false` in a working column, and names the approver it is waiting for', () => {
    write('tasks', 'TRDD-20260101_000000+0100-APPRWAIT-x.md',
      good('APPRWAIT', { column: 'dev', approved: 'false', 'min-approval-requirement': 'manager' }))
    const f = findingsFor('APPRWAIT')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('warn')          // WARN, so a governance backlog cannot redden the gate
    expect(f[0].autofixable).toBe(false)        // moving zones is a governance act, not a format repair
    expect(f[0].message).toMatch(/manager/)     // the floor is named — that is the actionable part
    expect(f[0].message).toMatch(/design\/proposals\//)
  })

  // The two messages are not cosmetic: they prescribe OPPOSITE repairs. A floor of `none` means the
  // card is a self-mandate and the missing edit is `approved: true`; a real floor means the card
  // must go back to `proposals/` and wait. A single generic message would send half of them the
  // wrong way.
  it('a floor of `none` is diagnosed as a missing `approved: true`, NOT as a card to un-authorize', () => {
    write('tasks', 'TRDD-20260101_000000+0100-APPRSELF-x.md',
      good('APPRSELF', { column: 'dev', approved: 'false', 'min-approval-requirement': 'none' }))
    const f = findingsFor('APPRSELF')
    expect(f).toHaveLength(1)
    expect(f[0].message).toMatch(/self-mandate/)
    expect(f[0].message).toMatch(/approved: true/)
    expect(f[0].message).not.toMatch(/design\/proposals\//)
  })

  it('does NOT fire on the LEGITIMATE pending shapes — `proposal` and `superseded`', () => {
    write('tasks', 'TRDD-20260101_000000+0100-APPRPROP-x.md',
      good('APPRPROP', { column: 'proposal', approved: 'false', 'min-approval-requirement': 'manager' }))
    write('tasks', 'TRDD-20260101_000000+0100-APPRSUPD-x.md',
      good('APPRSUPD', { column: 'superseded', approved: 'false', 'min-approval-requirement': 'manager' }))
    expect(findingsFor('APPRPROP')).toEqual([])
    expect(findingsFor('APPRSUPD')).toEqual([])
  })

  it('does NOT fire on an APPROVED card in a working column — the ordinary case', () => {
    write('tasks', 'TRDD-20260101_000000+0100-APPROKAY-x.md',
      good('APPROKAY', { column: 'dev', approved: 'true', 'approval-judge': 'someone' }))
    expect(findingsFor('APPROKAY')).toEqual([])
  })
})

describe('THE GATE — the real corpus lints clean', () => {
  it('design/ has zero ERROR-level findings', () => {
    const report = lintCorpus(path.join(process.cwd(), 'design'))
    // Non-vacuity FIRST: if the corpus came back empty, the assertion below would be
    // `[] === []` and would pass while checking nothing.
    expect(report.scanned).toBeGreaterThan(100)
    const errors = report.findings.filter((f) => f.severity === 'error')

    // ONE permanently-excluded card. This was TWO until the ruling landed, and the allowance
    // shrinking rather than vanishing is the actual answer, not a half-finished repair.
    //
    // Both cards carried a body state claim that BODY-STATE-CLAIM correctly reports, in
    // design/archived/ with a terminal column, where IND §12 says without qualification: "Do not
    // edit the body of a `complete` / `failed` / `superseded` / `published` / `live` TRDD."
    // Removing the line IS a body edit, and §12 belongs to the janitor's IND base — so the
    // question was routed there (janitor#139) rather than reinterpreted here.
    //
    // RULING, janitor#139, CLOSED 2026-08-05 in `c80945ee`: a body line that VERIFIABLY
    // contradicts the terminal `column:` MAY be removed, "because deleting a false claim ABOUT
    // history is not rewriting history" — but the carve-out is "deliberately narrow", authorising
    // removal of "ONLY a machine-verifiable contradiction, never a line that merely disagrees in
    // wording, adds context, or cannot be mechanically proven false."
    //
    // That splits the two, and it is worth reading the split rather than the count:
    //
    //   C7A81642  `column: complete` + `**Status:** Not started`  → COVERED. `not-started` is in
    //             the vocabulary and maps to `backburner`, so the contradiction is one a machine
    //             proves rather than infers. The line carried nothing but the false state, so it
    //             is gone and this card now lints clean.
    //   7123D51A  `column: completed` + `**Status:** Implemented 2026-04-20 (…tests shipped in
    //             task #250). Derived tasks #241/#242/#243 unblocked.` → EXCLUDED, and by the
    //             ruling's own exclusion clause twice over: the line ADDS CONTEXT (it names the
    //             work and the unblocked cards) and it CANNOT BE MECHANICALLY PROVEN FALSE — it
    //             is in fact TRUE, and merely unparseable, because "Implemented" names an ACTION
    //             that can predate the column and a date follows the verb.
    //
    // So this entry is NOT a backlog item waiting on anyone. Removing it would require either
    // deleting a true, informative line from a frozen card, or teaching the predicate to accept
    // `implemented` — which the rule deliberately refuses (`done` is the one inflection allowed,
    // being the past participle of the terminal set itself, not a synonym guess).
    const PERMANENTLY_EXCLUDED_BY_JANITOR_139 = new Set(['7123D51A'])

    // A SECOND exclusion, on a completely different justification — kept in its own set rather
    // than appended to the one above, because merging them would let one entry's reasoning stand
    // in for the other's when someone later asks whether either is still earned.
    //
    // G6A54OYK is the LIVE REPRODUCTION for TRDD-P6MSMQ2I, which says so verbatim in its own
    // body: `POST /api/trdd/[id]/archive --state completed` archived a card with no acceptance
    // checklist, and that card was deliberately LEFT IN PLACE as the evidence. It is terminal and
    // therefore frozen (IND §12), and unlike 7123D51A it is not a false positive — the finding is
    // entirely TRUE, which is precisely why it must not be "repaired" by ticking boxes for work
    // nobody did.
    //
    // WHY EXCLUDE RATHER THAN LEAVE THE GATE RED. A permanently-red gate catches nothing: the
    // third ERROR to appear would land in a suite that was already failing and nobody would look.
    // Excluding a named, justified, self-retiring entry keeps the gate live for every finding
    // that is NOT one of these two. That is the same trade the doctor's own comment names about
    // its grandfather boundary — "a wall of red is how a linter gets routed around".
    //
    // THE BUG IT REPRODUCES IS NOW FIXED (`da7ec5e8`, TRDD-P6MSMQ2I): the archive route enforces
    // the checklist gate, so no NEW card can be created this way. The reproduction is therefore
    // historical evidence, not an open wound — but it is still the only in-corpus example of the
    // shape, so deleting it would remove the one thing that makes the fix's motivation legible.
    const PERMANENTLY_EXCLUDED_AS_P6MSMQ2I_REPRODUCTION = new Set(['G6A54OYK'])

    const unexpected = errors.filter(
      (e) =>
        !(e.rule === 'BODY-STATE-CLAIM' && PERMANENTLY_EXCLUDED_BY_JANITOR_139.has(e.id)) &&
        !(
          e.rule === 'TERMINAL-WITHOUT-CHECKLIST' &&
          PERMANENTLY_EXCLUDED_AS_P6MSMQ2I_REPRODUCTION.has(e.id)
        ),
    )
    expect(unexpected.map((e) => `${e.rule} ${e.id} — ${e.message.slice(0, 90)}`)).toEqual([])

    // Still asserted EXACTLY, not `<=`. The self-retiring property is what forced this comment to
    // be rewritten instead of quietly absorbing the repair: the day C7A81642 healed, THIS line
    // failed. It keeps doing that job for the remaining entry — if 7123D51A ever stops erroring
    // (someone edits it, or the predicate changes), the gate fails and the exclusion must be
    // re-justified rather than outliving its reason and starting to hide new findings.
    expect(errors.filter((e) => PERMANENTLY_EXCLUDED_BY_JANITOR_139.has(e.id))).toHaveLength(1)

    // Same self-retiring property for the second entry, and it matters MORE here: G6A54OYK is
    // retained by a card that is still open. If it ever stops erroring — someone edits the frozen
    // card, or P6MSMQ2I closes and the reproduction is cleaned up — this fails and forces the
    // exclusion to be re-justified rather than silently outliving its reason.
    expect(
      errors.filter((e) => PERMANENTLY_EXCLUDED_AS_P6MSMQ2I_REPRODUCTION.has(e.id)),
    ).toHaveLength(1)
  })
})

/*
 * NEUTER RECORD — the checklist gate, measured 2026-08-02. Six mutations, and every one of the
 * four SILENT tests falls to exactly ONE of them, which is what separates a deliberate exclusion
 * from an assertion that would pass whatever the code did.
 *
 *   N1  CHECKLIST_GATED = []                       → 4 red: all four FIRES tests
 *   N2  drop `day >= CHECKLIST_GATE_SINCE`         → 2 red: the grandfathered test, AND the live
 *                                                     corpus. That second red is the measurement:
 *                                                     165 real archived cards would flood the
 *                                                     report, so the boundary is load-bearing and
 *                                                     not a theoretical nicety.
 *   N3  add cancelled+superseded to the gated set  → 1 red: the exclusion test, alone
 *   N4  remove the fence toggle                    → 3 red: the fenced FIRES test + both counter units
 *   N5  count [~] as open                          → 2 red: the tilde test + a counter unit
 *   N6  gate every column (`if (true)`)            → 3 red: non-terminal, the exclusion, the live corpus
 *
 * The first attempt at N1 reported ZERO red, which reads as "the tests are vacuous". They were
 * not — the EXTRACTOR was: vitest colours its failure lines, so `grep '^\s+× '` matched nothing
 * through the ANSI escapes. A neuter that reddens nothing is a finding about the test OR about
 * the instrument, and the two are indistinguishable until you look at the raw output.
 */

/**
 * TRDD-5XJWR473 — a card whose FRONTMATTER DOES NOT PARSE must be reported, never repaired.
 *
 * The bug this pins. `lib/pillar/store.ts` used to swallow a gray-matter failure into
 * `data = {}`, so "this document has no fields" and "I could not read this document" were the
 * SAME answer, and no caller could tell them apart. `fixCorpus` keys its `column:`/`title:`
 * insertions on those fields being absent — so an unparseable card got a SECOND pair inserted
 * after `trdd-id:` while the real ones sat, unparsed, a few lines below. The insertion does not
 * make the YAML parseable, so the NEXT run inserted another pair, and the next. Unbounded
 * duplication, produced by the tool whose entire job is repairing the corpus.
 *
 * The load-bearing case is the SECOND run. A single-run assertion passes even with the bug
 * present, because one inserted pair looks exactly like a repair — it is only on re-running that
 * "repair" and "corruption" become distinguishable.
 *
 * The fixture's premise was verified before it was written: gray-matter really does throw on an
 * unclosed double-quoted scalar ("unexpected end of the stream within a double quoted scalar").
 * A fixture that merely looked malformed but parsed fine would make every assertion here vacuous.
 */
describe('unparseable frontmatter is REPORTED, not "repaired" (TRDD-5XJWR473)', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-unparseable-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const BROKEN_NAME = 'TRDD-20260101_000000+0100-DDDDDDDD-broken.md'
  /**
   * Unparseable YAML that nonetheless CONTAINS a real `column:` and `title:`. Both halves
   * matter: unparseable is what makes every field read as absent, and the fields being present
   * in the text is what makes an insertion a duplication rather than a legitimate repair.
   */
  const BROKEN = [
    '---',
    'trdd-id: DDDDDDDD',
    'title: "an unclosed quote starts here',
    'column: dev',
    'created: 2026-01-01T00:00:00+0100',
    'updated: 2026-01-01T00:00:00+0100',
    '---',
    '',
    '# TRDD-DDDDDDDD — a card whose YAML is broken',
    '',
    'body',
    '',
  ].join('\n')

  const brokenPath = () => path.join(tmp, 'tasks', BROKEN_NAME)

  it('lintCorpus reports UNPARSEABLE, names the parser reason, and refuses to call it autofixable', () => {
    write('tasks', BROKEN_NAME, BROKEN)

    const r = lintCorpus(tmp)
    const f = r.findings.filter((x) => x.rule === 'UNPARSEABLE')

    expect(r.scanned).toBe(1) // non-vacuity: the linter actually SAW the file
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('error')
    // autofixable:false is the machine-readable half of "a human must resolve this" — which of
    // two `column:` lines is the real one is a judgement, not a mechanical repair.
    expect(f[0].autofixable).toBe(false)
    // The parser's own reason, so the operator learns WHAT is malformed, not merely THAT it is.
    expect(f[0].message).toMatch(/double quoted scalar/i)
  })

  it('an unparseable card is NOT reported as merely missing its fields', () => {
    // Before the fix this card emitted COLUMN-MISSING (and friends), because every field read as
    // absent. That is the misdiagnosis that made `--fix` insert duplicates: the linter said the
    // fields were missing, and they were not.
    write('tasks', BROKEN_NAME, BROKEN)

    const rules = new Set(lintCorpus(tmp).findings.map((f) => f.rule))
    expect(rules.has('UNPARSEABLE')).toBe(true)
    expect(rules.has('COLUMN-MISSING')).toBe(false)
  })

  it('fixCorpus does not touch it — and a SECOND run does not either (the unbounded half)', () => {
    write('tasks', BROKEN_NAME, BROKEN)

    fixCorpus(tmp)
    const afterFirst = fs.readFileSync(brokenPath(), 'utf8')
    expect(afterFirst).toBe(BROKEN)

    // The assertion the single-run case cannot make. With the bug present this run appends
    // ANOTHER `column:`/`title:` pair on top of the first run's, which is what turns a
    // one-off misrepair into unbounded growth.
    fixCorpus(tmp)
    expect(fs.readFileSync(brokenPath(), 'utf8')).toBe(BROKEN)

    // Named explicitly rather than left to the byte comparison, so a future failure says WHY.
    const occurrences = (s: string, re: RegExp) => (s.match(re) ?? []).length
    expect(occurrences(fs.readFileSync(brokenPath(), 'utf8'), /^column:/gm)).toBe(1)
    expect(occurrences(fs.readFileSync(brokenPath(), 'utf8'), /^title:/gm)).toBe(1)
  })

  it('POSITIVE CONTROL — a card that genuinely LACKS a column still gets one, in the same run', () => {
    // Without this, "fixCorpus changed nothing" is satisfied by a fixer that repairs nothing at
    // all, and the skip above would look correct while having disabled the whole tool.
    write('tasks', BROKEN_NAME, BROKEN)
    const NEEDS_FIX = 'TRDD-20260101_000000+0100-EEEEEEEE-needs.md'
    write('tasks', NEEDS_FIX, good('EEEEEEEE').replace(/^column:.*$/m, ''))

    fixCorpus(tmp)

    expect(fs.readFileSync(path.join(tmp, 'tasks', NEEDS_FIX), 'utf8')).toMatch(/^column: todo$/m)
    expect(fs.readFileSync(brokenPath(), 'utf8')).toBe(BROKEN)
  })
})

describe('non-local blocked-by spellings — end-to-end through lintCorpus (TRDD-PTFPGSLV)', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-extblk-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const sevOf = (r: ReturnType<typeof lintCorpus>, rule: string) =>
    r.findings.filter((f) => f.rule === rule).map((f) => f.severity)

  it('a gh: issue blocker is GRAPH-EXTERNAL-BLOCKER at WARN — and no phantom unknown id', () => {
    write('tasks', 'TRDD-20260101_000000+0100-GHBLOCK1-x.md',
      good('GHBLOCK1', { column: 'blocked', 'blocked-by': '[gh:Emasoft/ai-maestro#145]', 'pre-block-column': 'dev' }))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(idsOf(r, 'GRAPH-EXTERNAL-BLOCKER')).toEqual(['GHBLOCK1'])
    expect(sevOf(r, 'GRAPH-EXTERNAL-BLOCKER')).toEqual(['warn'])
    // The live-corpus symptom this card fixes: the ref reached normalizeTrddRef, came out
    // `GH:EMASO`, and was reported as an unknown local id.
    expect(idsOf(r, 'GRAPH-UNKNOWN-BLOCKER')).toEqual([])
  })

  it('a <project-id>:TRDD-<id8> blocker is GRAPH-CROSS-PROJECT-BLOCKER at WARN', () => {
    write('tasks', 'TRDD-20260101_000000+0100-XPBLOCK1-x.md',
      good('XPBLOCK1', { column: 'blocked', 'blocked-by': '[amama:TRDD-LT5N2JA4]', 'pre-block-column': 'dev' }))
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'GRAPH-CROSS-PROJECT-BLOCKER')).toEqual(['XPBLOCK1'])
    expect(sevOf(r, 'GRAPH-CROSS-PROJECT-BLOCKER')).toEqual(['warn'])
    expect(idsOf(r, 'GRAPH-UNKNOWN-BLOCKER')).toEqual([])
  })

  it('a bare unknown local id is still GRAPH-UNKNOWN-BLOCKER at ERROR — unchanged', () => {
    write('tasks', 'TRDD-20260101_000000+0100-BAREUNK1-x.md',
      good('BAREUNK1', { column: 'blocked', 'blocked-by': '[ZZZZ9999]', 'pre-block-column': 'dev' }))
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'GRAPH-UNKNOWN-BLOCKER')).toEqual(['BAREUNK1'])
    expect(sevOf(r, 'GRAPH-UNKNOWN-BLOCKER')).toEqual(['error'])
  })

  it('BLOCKED-WITHOUT-BLOCKER stays silent when the only blocker is external — the entry counts', () => {
    write('tasks', 'TRDD-20260101_000000+0100-EXTONLY1-x.md',
      good('EXTONLY1', { column: 'blocked', 'blocked-by': '[gh:Emasoft/ai-maestro#9]', 'pre-block-column': 'dev' }))
    const r = lintCorpus(tmp)
    expect(idsOf(r, 'BLOCKED-WITHOUT-BLOCKER')).toEqual([])
  })
})

describe('checklist gate fails OPEN on an unparseable updated: (TRDD-PTFPGSLV)', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-gateopen-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('FIRES: terminal, no checklist, garbage updated — skipping would grandfather it forever', () => {
    write('archived', 'TRDD-20260101_000000+0100-BADDATE1-x.md',
      good('BADDATE1', { column: 'completed', updated: 'not-a-date' }))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(idsOf(r, 'TERMINAL-WITHOUT-CHECKLIST')).toEqual(['BADDATE1'])
    // The message says WHY the boundary did not exempt it, so the reader is not sent
    // hunting for a date comparison that never ran.
    const f = r.findings.find((x) => x.rule === 'TERMINAL-WITHOUT-CHECKLIST')
    expect(f?.message).toContain('failing open')
  })
})
