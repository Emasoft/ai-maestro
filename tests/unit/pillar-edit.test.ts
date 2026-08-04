/**
 * TRDD-D7KVF4HQ — `lib/pillar/edit.ts`, the shared pillar WRITE seam.
 *
 * Two guards live in that module and they fail in different ways, so each needs its
 * own test AND its own neuter:
 *   - the CAS (`expect` must be present at `line`) — catches a writer that never
 *     took the lock (a hand edit, a `git mv`, a symlinked peer);
 *   - the lock (`withJsonLock`) — serialises writers that DO use the tool.
 *
 * NEITHER TEST IS WRITTEN AS A RACE. Firing N concurrent writers and asserting they
 * all survive passes with the lock deleted, because whether the losing interleaving
 * occurs is the scheduler's choice. The lock test below holds the lock and asserts
 * the contender CANNOT finish, then releases and asserts it then does — and that
 * second half is a mandatory positive control, since "did not complete" is equally
 * satisfied by a contender that threw or was never called.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { replaceAtLines, StaleDocumentError, documentLockKey, documentLockKeyFor } from '@/lib/pillar/edit'
import { PRRD_KIND, SPEC_KIND, TRDD_KIND } from '@/lib/pillar/kinds'
import { withJsonLock } from '@/lib/json-io'

let dir: string
let doc: string

const ORIGINAL = ['---', 'trdd-id: ABCD1234', 'column: todo', '---', '', '# Title', ''].join('\n')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pillar-edit-'))
  doc = join(dir, 'TRDD-20260803_010101+0200-ABCD1234-x.md')
  writeFileSync(doc, ORIGINAL, 'utf-8')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('replaceAtLines — the AT LINE N REPLACE X WITH Y primitive', () => {
  it('applies the edit when the line still reads what the caller expects (POSITIVE CONTROL)', async () => {
    // Without this, every "it blocks" assertion below is satisfied by a tool that
    // blocks unconditionally — which would pass while being useless.
    const res = await replaceAtLines(doc, [{ line: 3, expect: 'todo', replace: 'dev' }])

    expect(readFileSync(doc, 'utf-8')).toContain('column: dev')
    expect(res.linesChanged).toEqual([3])
    expect(res.diff).toContain('-column: todo')
    expect(res.diff).toContain('+column: dev')
  })

  it('BLOCKS when the line changed underneath it, and leaves the file byte-identical', async () => {
    // A peer process rewrites the line the caller read. This is the symlinked-agent
    // case the whole card exists for.
    const mutated = ORIGINAL.replace('column: todo', 'column: testing')
    writeFileSync(doc, mutated, 'utf-8')

    await expect(
      replaceAtLines(doc, [{ line: 3, expect: 'column: todo', replace: 'column: dev' }]),
    ).rejects.toThrow(StaleDocumentError)

    // The refusal must not be a partial write.
    expect(readFileSync(doc, 'utf-8')).toBe(mutated)
  })

  it('carries the USER-specified message, which the CLIs gate on', async () => {
    writeFileSync(doc, ORIGINAL.replace('column: todo', 'column: dev'), 'utf-8')
    await expect(
      replaceAtLines(doc, [{ line: 3, expect: 'column: todo', replace: 'column: dev' }]),
    ).rejects.toThrow(/changed since your command was enqueued.*reread the file first/s)
  })

  it('BLOCKS when the line number is past the end of the file', async () => {
    // A truncating peer is a different failure from a rewriting one, and an
    // undefined line must not read as "no match, therefore fine".
    await expect(
      replaceAtLines(doc, [{ line: 999, expect: 'anything', replace: 'x' }]),
    ).rejects.toThrow(StaleDocumentError)
  })

  it('is ALL-OR-NOTHING: one stale edit in a batch reverts the whole batch', async () => {
    // The half-applied batch is the corruption this module exists to prevent, so
    // edit 1 being valid must NOT be enough to land it.
    await expect(
      replaceAtLines(doc, [
        { line: 2, expect: 'ABCD1234', replace: 'ZZZZ9999' }, // valid
        { line: 3, expect: 'column: WRONG', replace: 'column: dev' }, // stale
      ]),
    ).rejects.toThrow(StaleDocumentError)

    expect(readFileSync(doc, 'utf-8')).toBe(ORIGINAL)
  })

  it('refuses two edits to the same line rather than composing them in caller order', async () => {
    await expect(
      replaceAtLines(doc, [
        { line: 3, expect: 'todo', replace: 'dev' },
        { line: 3, expect: 'dev', replace: 'testing' },
      ]),
    ).rejects.toThrow(/depend on application order/)
  })

  it('is byte-deterministic: same input + same edits ⇒ same bytes, in either listed order', async () => {
    const forward = [
      { line: 2, expect: 'ABCD1234', replace: 'ZZZZ9999' },
      { line: 3, expect: 'todo', replace: 'dev' },
    ]
    await replaceAtLines(doc, forward)
    const a = readFileSync(doc, 'utf-8')

    writeFileSync(doc, ORIGINAL, 'utf-8')
    await replaceAtLines(doc, [...forward].reverse())
    expect(readFileSync(doc, 'utf-8')).toBe(a)
  })

  it('does not add a trailing newline to a file that had none', async () => {
    // A write that quietly normalises bytes fails the determinism clause.
    const noNewline = 'column: todo'
    writeFileSync(doc, noNewline, 'utf-8')
    await replaceAtLines(doc, [{ line: 1, expect: 'todo', replace: 'dev' }])
    expect(readFileSync(doc, 'utf-8')).toBe('column: dev')
  })

  it('refuses an empty batch instead of performing a no-op write', async () => {
    // A no-op write still bumps mtime, which every freshness probe in lib/pillar/ keys on.
    await expect(replaceAtLines(doc, [])).rejects.toThrow(/empty edit batch/)
  })
})

describe('replaceAtLines — the lock', () => {
  it('a contender cannot complete while the document lock is held, and completes once released', async () => {
    let done = false
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })

    // Hold the SAME lock the module takes, from a sibling async context. It must be
    // a sibling: withJsonLock is re-entrant via AsyncLocalStorage, so a contender
    // started INSIDE the holder would inherit the held set and skip the lock
    // entirely — passing no matter what the code does.
    const holder = withJsonLock(doc, async () => { await held })

    const contender = replaceAtLines(doc, [{ line: 3, expect: 'todo', replace: 'dev' }])
      .then(() => { done = true })

    // Yield generously; the contender must still be blocked.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
    expect(done).toBe(false)

    release()
    await holder
    await contender

    // POSITIVE CONTROL: `false` above is equally satisfied by a contender that threw
    // or was never called. This is what proves it was merely WAITING.
    expect(done).toBe(true)
    expect(readFileSync(doc, 'utf-8')).toContain('column: dev')
  })
})

describe('documentLockKey — the lock must survive a zone move', () => {
  it('is identical for the same id in DIFFERENT zones (the whole point)', () => {
    // A TRDD transition is `git mv proposals/X.md tasks/X.md` and THEN an edit. A
    // path-keyed lock would be taken on the old path by one writer and the new path
    // by another — two locks, zero exclusion, both looking correct.
    const root = '/corpus/design'
    expect(documentLockKey(root, 'trdd', 'ABCD1234'))
      .toBe(documentLockKey(root, 'trdd', 'ABCD1234'))
    // and it depends on NEITHER zone:
    expect(documentLockKey(root, 'trdd', 'ABCD1234')).not.toContain('proposals')
    expect(documentLockKey(root, 'trdd', 'ABCD1234')).not.toContain('tasks')
  })

  it('is distinct per document and per pillar, so unrelated work does not serialise', () => {
    const root = '/corpus/design'
    expect(documentLockKey(root, 'trdd', 'AAAA1111')).not.toBe(documentLockKey(root, 'trdd', 'BBBB2222'))
    expect(documentLockKey(root, 'trdd', 'AAAA1111')).not.toBe(documentLockKey(root, 'prrd', 'AAAA1111'))
  })

  it('lands beside the corpus root, not inside a zone a git mv would orphan', () => {
    expect(documentLockKey('/corpus/design', 'trdd', 'ABCD1234')).toBe('/corpus/design/.trdd-lock-ABCD1234')
  })

  it('is identical for TWO DIFFERENT RECORDS of the same per-line document', () => {
    // THE FINDING. `documentLockKey` takes a RECORD id, which is the right key only
    // where id↔document is 1:1 — TRDD and nothing else. PRRD is ONE file whose records
    // are bullets, so keying on the bullet id hands two writers of the SAME file two
    // DIFFERENT lockdirs: both acquire instantly, both read, both write, second wins.
    const file = '/corpus/design/requirements/PRRD.md'
    expect(documentLockKeyFor('/corpus/design/requirements', PRRD_KIND, { id: 'G1.1', filePath: file }))
      .toBe(documentLockKeyFor('/corpus/design/requirements', PRRD_KIND, { id: 'S64.134', filePath: file }))
  })

  it('is DISTINCT for records of two different SPEC documents, so unrelated specs do not serialise', () => {
    // The other half — a key that collapsed everything to one lock would be "correct"
    // by the assertion above while serialising the whole corpus. Both must hold.
    const root = '/corpus/design/specs'
    expect(documentLockKeyFor(root, SPEC_KIND, { id: '3P-KAN-06', filePath: `${root}/3-pillars-spec.md` }))
      .not.toBe(documentLockKeyFor(root, SPEC_KIND, { id: 'GOV-R6-01', filePath: `${root}/governance-spec.md` }))
  })

  it('survives a SPEC zone move — same basename in proposals/ and at the root is one document', () => {
    // SPEC's zones are ['', 'proposals', 'archived'], so a spec really can move, and
    // `governance-spec.md` is the same document either side of that move.
    const root = '/corpus/design/specs'
    expect(documentLockKeyFor(root, SPEC_KIND, { id: 'GOV-R6-01', filePath: `${root}/proposals/governance-spec.md` }))
      .toBe(documentLockKeyFor(root, SPEC_KIND, { id: 'GOV-R6-01', filePath: `${root}/governance-spec.md` }))
  })

  it('still keys a TRDD on its ID, not its file — the per-document case is unchanged', () => {
    // A per-document pillar must NOT switch to basename-keying: a TRDD's filename moves
    // between zones, which is the very case `documentLockKey`'s own doc-comment exists
    // for. So the dispatch has to differ per kind, and this pins the other branch.
    const root = '/corpus/design'
    expect(documentLockKeyFor(root, TRDD_KIND, { id: 'ABCD1234', filePath: `${root}/proposals/TRDD-x-ABCD1234-a.md` }))
      .toBe(documentLockKeyFor(root, TRDD_KIND, { id: 'ABCD1234', filePath: `${root}/tasks/TRDD-x-ABCD1234-a.md` }))
    expect(documentLockKeyFor(root, TRDD_KIND, { id: 'AAAA1111', filePath: `${root}/tasks/a.md` }))
      .not.toBe(documentLockKeyFor(root, TRDD_KIND, { id: 'BBBB2222', filePath: `${root}/tasks/a.md` }))
  })

  it('BEHAVIOURAL: two writers on different BULLETS of one PRRD file exclude each other', async () => {
    // The assertions above compare strings; this proves the string is actually used as
    // a lock. Under record-id keying both writers hold different keys, the contender
    // completes immediately, and `secondDone` is true before the release.
    const prrd = join(dir, 'PRRD.md')
    writeFileSync(prrd, ['---', 'x: 1', '---', '', '- **G1.1** — one', '- **S2.1** — two', ''].join('\n'), 'utf-8')

    const keyA = documentLockKeyFor(dir, PRRD_KIND, { id: 'G1.1', filePath: prrd })
    const keyB = documentLockKeyFor(dir, PRRD_KIND, { id: 'S2.1', filePath: prrd })

    let secondDone = false
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const holder = withJsonLock(keyA, async () => { await held })

    const contender = replaceAtLines(prrd, [{ line: 6, expect: 'two', replace: 'TWO' }], { lockKey: keyB })
      .then(() => { secondDone = true })

    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
    expect(secondDone).toBe(false)

    release(); await holder; await contender
    expect(secondDone).toBe(true)   // positive control: it was waiting, not dead
  })

  it('two writers on the SAME id via DIFFERENT paths still exclude each other', async () => {
    // The behavioural form of the first test: same id, two paths (as before and
    // after a zone move), one shared lockKey. Path-keying would let both through.
    const key = documentLockKey(dir, 'trdd', 'ABCD1234')
    const other = join(dir, 'moved-copy.md')
    writeFileSync(other, ORIGINAL, 'utf-8')

    let secondDone = false
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const holder = withJsonLock(key, async () => { await held })

    const contender = replaceAtLines(other, [{ line: 3, expect: 'todo', replace: 'dev' }], { lockKey: key })
      .then(() => { secondDone = true })

    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
    expect(secondDone).toBe(false)   // blocked by a lock taken on the OTHER path's document

    release(); await holder; await contender
    expect(secondDone).toBe(true)    // positive control: it was waiting, not dead
  })
})
