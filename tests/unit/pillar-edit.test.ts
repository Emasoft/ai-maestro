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
import { replaceAtLines, StaleDocumentError } from '@/lib/pillar/edit'
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
