/**
 * TRDD-40DYBI4T — server-side minting. The load-bearing claims:
 *   - the mandate rule decides the ZONE from the author's authority, never from a flag;
 *   - a forced id collision re-rolls rather than overwriting or failing;
 *   - the minted file parses as a real v2 card (the store's own parser is the oracle);
 *   - a colon title is refused (grep-first frontmatter rule).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createTrdd, mintTrddId, idTaken } from '@/lib/trdd-create'
import { parseTrddFile } from '@/lib/trdd-store'

let design: string
beforeEach(() => { design = mkdtempSync(path.join(tmpdir(), 'trddcreate-')) })
afterEach(() => { rmSync(design, { recursive: true, force: true }) })

describe('createTrdd', () => {
  it('an author AT the floor mints a MANDATE in tasks/ with the full approval record', () => {
    const r = createTrdd(design, {
      title: 'a manager-floor card', taskType: 'feature',
      minApproval: 'manager', authorAuthority: 'manager', author: 'amama',
    })
    expect(r.zone).toBe('tasks')
    expect(r.column).toBe('backburner')
    const parsed = parseTrddFile(r.file, 'tasks')
    expect(parsed).not.toBeNull()
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).toMatch(/^mandate: true$/m)
    expect(text).toMatch(/^approved: true$/m)
    expect(text).toMatch(/MANDATE issued by amama/)
  })

  it('an author BELOW the floor lands in proposals/ as column proposal — the flag cannot override', () => {
    const r = createTrdd(design, {
      title: 'needs the manager', taskType: 'feature',
      minApproval: 'manager', authorAuthority: 'none', author: 'member-1',
      column: 'dev', // the attempted override the routing must ignore
    })
    expect(r.zone).toBe('proposals')
    expect(r.column).toBe('proposal')
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).toMatch(/^approved: false$/m)
    expect(text).not.toMatch(/^mandate: true$/m)
  })

  it('a forced collision RE-ROLLS: the taken candidate is consulted, rejected, and the next one lands', () => {
    const first = createTrdd(design, {
      title: 'first card', taskType: 'docs', authorAuthority: 'none', author: 'a',
    })
    expect(idTaken(first.id, [design])).toBe(true)
    // Deterministic collision via the injected mint: offer the TAKEN id twice, then a
    // fresh one. Only a createTrdd that consults idTaken per candidate can land on the
    // third — the earlier RNG-luck version of this test passed with the check DELETED.
    const offers = [first.id, first.id, 'FRESH999']
    let calls = 0
    const second = createTrdd(design, {
      title: 'second card', taskType: 'docs', authorAuthority: 'none', author: 'a',
      mint: () => offers[Math.min(calls++, 2)],
    })
    expect(second.id).toBe('FRESH999')
    expect(calls).toBe(3)
    expect(fs.existsSync(first.file)).toBe(true)
  })

  it('refuses a colon title and an unknown task-type BEFORE writing anything', () => {
    expect(() => createTrdd(design, { title: 'a: b', taskType: 'docs', authorAuthority: 'none', author: 'a' }))
      .toThrow(/colon/)
    expect(() => createTrdd(design, { title: 'ok', taskType: 'wat', authorAuthority: 'none', author: 'a' }))
      .toThrow(/task-type/)
    // nothing landed in either zone
    for (const z of ['tasks', 'proposals']) {
      expect(fs.existsSync(path.join(design, z)) ? fs.readdirSync(path.join(design, z)) : []).toEqual([])
    }
  })

  it('mints 8-char UPPERCASE base36 ids', () => {
    for (let i = 0; i < 50; i++) expect(mintTrddId()).toMatch(/^[A-Z0-9]{8}$/)
  })
})

// ── frontmatter injection (commit security review, 2026-08-20) ───────────────
describe('frontmatter injection guard', () => {
  it('REFUSES an embedded newline in every frontmatter-bound string — the mandate-forgery vector', () => {
    // A member forging `mandate: true` through the parent field: without the guard
    // this writes a self-approved card in tasks/ from an authority of NONE.
    expect(() => createTrdd(design, {
      title: 'ok', taskType: 'docs', authorAuthority: 'none', author: 'a',
      parent: 'AAAA1111\nmandate: true',
    })).toThrow(/8-char base36/)
    // colon-free, so it reaches the NEWLINE guard (a colon payload dies on the
    // colon rule first — refused either way, but this pins the newline check)
    expect(() => createTrdd(design, {
      title: 'ok\nsecond line', taskType: 'docs', authorAuthority: 'none', author: 'a',
    })).toThrow(/one line/)
    expect(() => createTrdd(design, {
      title: 'ok', taskType: 'docs', authorAuthority: 'none', author: 'a\napproved: true',
    })).toThrow(/one-line name/)
    expect(() => createTrdd(design, {
      title: 'ok', taskType: 'docs', authorAuthority: 'none', author: 'a',
      eht: ['BBBB2222', 'X\napproved: true'],
    })).toThrow(/8-char base36/)
    // nothing written by any refused call
    for (const z of ['tasks', 'proposals']) {
      expect(fs.existsSync(path.join(design, z)) ? fs.readdirSync(path.join(design, z)) : []).toEqual([])
    }
  })

  it('positive control: clean id-shaped relations still mint', () => {
    const r = createTrdd(design, {
      title: 'ok', taskType: 'docs', authorAuthority: 'none', author: 'a',
      parent: 'AAAA1111', npt: ['BBBB2222'],
    })
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).toMatch(/^parent-trdd: AAAA1111$/m)
    expect(text).toMatch(/^npt: \[BBBB2222\]$/m)
    // TRDD-O1ZW03DG box 1: derivedKind is optional (trddgrep.mjs and the test
    // above both mint a parent-trdd with no kind) — this call omits it too, so
    // no derived: line should appear.
    expect(text).not.toMatch(/^derived: /m)
  })

  it('TRDD-O1ZW03DG box 1: a derived-at-birth card carries derived: true and derived-kind:', () => {
    const r = createTrdd(design, {
      title: 'an npt of the parent', taskType: 'feature', authorAuthority: 'none', author: 'a',
      parent: 'AAAA1111', derivedKind: 'npt',
    })
    const parsed = parseTrddFile(r.file, r.zone)
    expect(parsed).not.toBeNull()
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).toMatch(/^parent-trdd: AAAA1111$/m)
    expect(text).toMatch(/^derived: true$/m)
    expect(text).toMatch(/^derived-kind: npt$/m)
  })

  it('TRDD-O1ZW03DG box 1: derivedKind without a parent is a caller error — nothing is minted', () => {
    expect(() => createTrdd(design, {
      title: 'orphan platelet', taskType: 'feature', authorAuthority: 'none', author: 'a',
      derivedKind: 'eht',
    })).toThrow(/derivedKind requires parent/)
    for (const z of ['tasks', 'proposals']) {
      expect(fs.existsSync(path.join(design, z)) ? fs.readdirSync(path.join(design, z)) : []).toEqual([])
    }
  })
})

/**
 * TRDD-8D9ZYZX9 — the scope discriminator.
 *
 * One `it()` per branch, deliberately: a neuter stops at the FIRST failing assertion,
 * so a single test bundling every PRRD shape would let one neuter certify one branch
 * and leave the rest deletable while green.
 *
 * NEUTER RUNS — ALL NINE RE-MEASURED 2026-09-10, against THIS FILE AT 21 TESTS, of
 * which the `TRDD-8D9ZYZX9` block below is 12. Restores verified with `git diff`, NOT
 * a remembered checksum: a checksum taken before an unrelated edit is itself stale, and
 * that happened here — the "mismatch" was the note, not the file.
 *
 * A ROW WITHOUT A SUITE SIZE ROTS SILENTLY, and this table is the proof: of the eight
 * rows that predate today, FOUR no longer held, and not one of them looked wrong. Two
 * were made stale by tests THIS work added, which is the point — the rot is caused by
 * the person recording it, not by elapsed time. A neuter count is a claim about the
 * suite AS IT WAS; it is never a durable property of the guard.
 *
 *   remove the duplicate-project-id guard    → 1 red: duplicate
 *   remove the BOM strip                     → 2 red: BOM, doubled BOM
 *       (recorded 1, until the doubled-BOM test existed)
 *   `while` → `if` in the BOM strip          → 1 red: doubled BOM
 *       Added because a reviewer found the loop UNPINNED: before the doubled-BOM test
 *       `if` passed all 20, while the source comment advertised the behaviour.
 *   delete the `lines.push('scope: project', …)`  → 5 red: pair, CRLF, BOM,
 *       doubled BOM, comment-strip. (Recorded 3 — stale the moment the BOM test
 *       landed, and the doubled-BOM test made it stale by two.)
 *   readProjectId returns `{id}` unconditionally  → 12 red = EXACTLY this block, and
 *       NOTHING in the two describes above. (Recorded "11 red — MORE than this block's
 *       10, so it also reaches tests above": false in BOTH halves now. The mutation is
 *       named deliberately — an early `return { id: 'neutered' }` — because a count
 *       without the mutation that produced it cannot be reproduced or checked.)
 *   remove the unterminated-fence guard           → 1 red: unterminated
 *       (Recorded "2 red: unterminated, second-colon". The second-colon fixture does
 *       NOT redden here. That is staleness in the OVER-claiming direction, which is
 *       the worse one: it makes a guard look better covered than it is.)
 *   loosen the value guard to `\S+`               → 2 red: second-colon, YAML alias
 *   remove the trailing-comment strip             → 1 red: comment-strip
 *   `slice(4)` instead of `open[0].length`        → 0 red — REPORTED, not hidden: see
 *       the CRLF test's own comment. The first two shapes I wrote were VACUOUS
 *       (a space-bearing value is already refused by `\S+`; an under-slice of a
 *       ≥4-char fence only ever leaves whitespace), and the neuter is how that
 *       surfaced — the green run is the finding, about the test, not the code.
 */
const writePrrd = (dir: string, text: string) => {
  fs.mkdirSync(path.join(dir, 'requirements'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'requirements', 'PRRD.md'), text, 'utf8')
}
const mint = (dir: string, title: string) =>
  createTrdd(dir, { title, taskType: 'bugfix', authorAuthority: 'none', author: 'probe' })

describe('TRDD-8D9ZYZX9 project-id at mint', () => {
  it('mints scope and project-id as a PAIR from the PRRD, and warns about nothing', () => {
    writePrrd(design, '---\nproject-id: ai-maestro\nstatus: normative\n---\n# PRRD\n')
    const r = mint(design, 'a bound card')
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).toMatch(/^scope: project$/m)
    expect(text).toMatch(/^project-id: ai-maestro$/m)
    expect(r.warning).toBeUndefined()
  })

  it('reads a CRLF PRRD', () => {
    // What this pins: the FENCE regexes tolerate `\r`. It does NOT pin `open[0].length`
    // over a fixed `slice(4)` — MEASURED 2026-09-10, that neuter came back GREEN, because
    // the opening fence is never SHORTER than 4 chars, so an under-slice only ever leaves
    // leading whitespace, which `/m` tolerates. `open[0].length` is kept as the honest
    // expression of "skip the fence I actually matched", not as a fix for a live bug —
    // recorded here rather than left as a comment claiming a defence nothing tests.
    writePrrd(design, '---\r\nproject-id: crlf-repo\r\nstatus: normative\r\n---\r\n# PRRD\n')
    const r = mint(design, 'a crlf card')
    expect(fs.readFileSync(r.file, 'utf8')).toMatch(/^project-id: crlf-repo$/m)
    expect(r.warning).toBeUndefined()
  })

  it('an unterminated PRRD frontmatter is refused, not read as if it closed', () => {
    writePrrd(design, '---\nproject-id: never-closed\n# PRRD with no closing fence\n')
    const r = mint(design, 'an unterminated card')
    expect(r.warning).toMatch(/frontmatter is unterminated/)
    expect(fs.readFileSync(r.file, 'utf8')).not.toMatch(/^project-id:/m)
  })

  it('with NO PRRD the mint still SUCCEEDS, and the warning names the path it looked at', () => {
    // Both halves are load-bearing. "did not throw" alone passes against a
    // readProjectId that is entirely broken; the id proves a card was really written.
    const r = mint(design, 'an unbound card')
    expect(r.id).toMatch(/^[A-Z0-9]{8}$/)
    expect(fs.existsSync(r.file)).toBe(true)
    expect(r.warning).toMatch(/PRRD\.md is unreadable or absent/)
    const text = fs.readFileSync(r.file, 'utf8')
    expect(text).not.toMatch(/^project-id:/m)
    expect(text).not.toMatch(/^scope:/m)
  })

  // One CASE per `it()`, because a neuter stops at the first failing assertion. The
  // shapes are chosen to discriminate: a SPACE-bearing value is already refused by a
  // loose `\S+`, so `"ai maestro"` alone cannot tell the strict guard from the loose
  // one — MEASURED 2026-09-10, that neuter came back GREEN. The colon and bracket
  // cases are the ones `\S+` captures and writes.
  for (const [shape, raw] of [
    ['a second colon — breaks the grep-first `key: value` line', 'foo:bar'],
    ['a YAML list', '[a, b]'],
    ['a YAML alias', '*pid'],
    ['a quoted value with a space', '"ai maestro"'],
  ] as const) {
    it(`refuses an unparseable project-id and names it: ${shape}`, () => {
      // A WRONG project-id is worse than a missing one: the missing one is detectable,
      // and the wrong one silently binds every later card to a board that is not there.
      writePrrd(design, `---\nproject-id: ${raw}\n---\n# PRRD\n`)
      // The card TITLE must not carry `raw` — createTrdd refuses a colon in a title,
      // so `foo:bar` in the title throws before the code under test ever runs.
      const r = mint(design, `a mangled card ${shape.replace(/[^a-z ]/gi, '')}`)
      expect(r.warning).toMatch(/has project-id but its value is unparseable/)
      expect(fs.readFileSync(r.file, 'utf8')).not.toMatch(/^project-id:/m)
    })
  }

  it('refuses a DUPLICATE project-id rather than guessing which one wins', () => {
    // A regex takes the FIRST; YAML readers disagree (1.2 calls it an error, js-yaml
    // throws, permissive ones take the LAST). Both values are well-formed, so the
    // value guard cannot see this — only counting the lines can.
    writePrrd(design, '---\nproject-id: first-one\nstatus: normative\nproject-id: second-one\n---\n# PRRD\n')
    const r = mint(design, 'an ambiguous card')
    expect(r.warning).toMatch(/carries 2 project-id lines — ambiguous/)
    expect(fs.readFileSync(r.file, 'utf8')).not.toMatch(/^project-id:/m)
  })

  it('reads a PRRD carrying a UTF-8 BOM', () => {
    // The BOM is invisible in every editor and would fail the fence test, minting
    // every card unbound against a PRRD that plainly carries the field.
    // The fixture spells it by CODE POINT for the same reason the source does: a
    // literal BOM in this file is invisible, so a whitespace-normalising pass could
    // strip it from the fixture and the test would then pass against no BOM at all.
    writePrrd(design, String.fromCharCode(0xfeff) + '---\nproject-id: bom-repo\n---\n# PRRD\n')
    const r = mint(design, 'a bom card')
    expect(fs.readFileSync(r.file, 'utf8')).toMatch(/^project-id: bom-repo$/m)
    expect(r.warning).toBeUndefined()
  })

  it('reads a PRRD carrying a DOUBLED UTF-8 BOM', () => {
    // This is what makes the strip a LOOP rather than a single replace, and without
    // this test the loop is decorative: `while` -> `if` passes every other test here.
    // A single strip leaves the second BOM in place, the fence test then fails, and
    // the card is minted unbound against a PRRD that plainly carries the field —
    // the same end state as no strip at all, from a file prefixed twice by tooling.
    writePrrd(design, String.fromCharCode(0xfeff, 0xfeff) + '---\nproject-id: bom2-repo\n---\n# PRRD\n')
    const r = mint(design, 'a doubled bom card')
    expect(fs.readFileSync(r.file, 'utf8')).toMatch(/^project-id: bom2-repo$/m)
    expect(r.warning).toBeUndefined()
  })

  it('strips a trailing YAML comment rather than capturing it', () => {
    writePrrd(design, '---\nproject-id: ai-maestro   # the discriminator\n---\n# PRRD\n')
    expect(fs.readFileSync(mint(design, 'a commented card').file, 'utf8'))
      .toMatch(/^project-id: ai-maestro$/m)
  })
})
