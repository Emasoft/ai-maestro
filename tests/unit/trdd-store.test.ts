import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import {
  parseTrddFile,
  listTrddFiles,
  assertDesignDir,
  findTrdd,
  searchTrdds,
  editTrdd,
  promoteTrdd,
  refuseTrdd,
  advanceColumn,
  archiveTrdd,
  setFrontmatterField,
  appendApprovalLog,
} from '@/lib/trdd-store'

let designDir: string
const ISO = '2026-07-09T13:00:00.000Z'

function writeProposal(
  id: string,
  slug: string,
  column = 'proposal',
  extra = '',
  root = designDir,
): string {
  const dir = path.join(root, 'proposals')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `TRDD-20260709_102705+0200-${id}-${slug}.md`)
  fs.writeFileSync(
    file,
    `---
trdd-id: ${id}
title: ${slug} title
column: ${column}
approval-tier: 2
created: 2026-07-09T10:27:08+0200
updated: 2026-07-09T10:27:08+0200
${extra}---

# ${id} — body

Some searchable content about widgets.

## Approval log
`,
  )
  return file
}

function writeTask(id: string, slug: string, column = 'dev', root = designDir): string {
  const dir = path.join(root, 'tasks')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `TRDD-20260709_102705+0200-${id}-${slug}.md`)
  fs.writeFileSync(
    file,
    `---
trdd-id: ${id}
title: ${slug} title
column: ${column}
created: 2026-07-09T10:27:08+0200
updated: 2026-07-09T10:27:08+0200
---

# ${id} — body

## Approval log
`,
  )
  return file
}

beforeEach(() => {
  designDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-store-'))
})
afterEach(() => {
  fs.rmSync(designDir, { recursive: true, force: true })
})

describe('trdd-store parse + search', () => {
  it('parses a TRDD file and extracts the 8-char id from the filename', () => {
    const f = writeProposal('ABCD1234', 'sample-slug')
    const t = parseTrddFile(f, 'proposals')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('ABCD1234')
    expect(t!.zone).toBe('proposals')
    expect(t!.column).toBe('proposal')
    expect(t!.title).toBe('sample-slug title')
    expect(t!.frontmatter['approval-tier']).toBe(2)
  })

  it('searches by column, by id, and by free-text keyword', () => {
    writeProposal('AAAA0001', 'widgets-one')
    writeTask('BBBB0002', 'other-two', 'dev')

    expect(searchTrdds(designDir, { column: 'proposal' }).map((t) => t.id)).toEqual(['AAAA0001'])
    expect(searchTrdds(designDir, { id: 'bbbb0002' }).map((t) => t.id)).toEqual(['BBBB0002']) // case-insensitive
    // keyword hits the body of the proposal fixture ("widgets") but not the task fixture.
    expect(searchTrdds(designDir, { keyword: 'widgets' }).map((t) => t.id)).toEqual(['AAAA0001'])
    expect(searchTrdds(designDir, { zone: 'tasks' }).map((t) => t.id)).toEqual(['BBBB0002'])
  })

  // v1 filenames carry no timestamp segment. Matching only the v2 shape made ten
  // real TRDDs unreachable — `readTrdd('70a521d9')` 404'd on a file CLAUDE.md
  // cites by name, and `searchTrdds` under-reported the corpus without saying so.
  it('finds a v1 filename with a full-UUID tail', () => {
    const dir = path.join(designDir, 'tasks')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'TRDD-70a521d9-5641-4a11-975f-2ca6f5bd9b0c-remove-rag-memory.md'),
      '---\ntrdd-id: 70a521d9-5641-4a11-975f-2ca6f5bd9b0c\ntitle: v1 uuid\ncolumn: complete\n---\nbody\n',
    )
    expect(findTrdd(designDir, '70a521d9')!.id).toBe('70A521D9')
  })

  it('finds a v1 filename with a bare 8-hex id and no uuid tail', () => {
    const dir = path.join(designDir, 'tasks')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'TRDD-80557822-comm-graph-downstream-sync.md'), '# no frontmatter\n')
    expect(findTrdd(designDir, '80557822')!.id).toBe('80557822')
  })

  it('does not mistake a v2 timestamp for a v1 hex id', () => {
    // `20260709` is eight valid hex chars. The v2 shape must win, or every v2
    // TRDD would be filed under the id `20260709`.
    writeTask('CCCC0003', 'timestamp-vs-hex', 'dev')
    expect(searchTrdds(designDir, { zone: 'tasks' }).map((t) => t.id)).toEqual(['CCCC0003'])
  })
})

describe('trdd-store pure writers preserve the grep-first format', () => {
  it('setFrontmatterField replaces an existing line and inserts a missing one', () => {
    const src = '---\ntrdd-id: X\ncolumn: proposal\n---\nbody\n'
    const replaced = setFrontmatterField(src, 'column', 'planned')
    expect(replaced).toContain('column: planned')
    expect(replaced).not.toContain('column: proposal')
    const inserted = setFrontmatterField(src, 'superseded-by', '[Y]')
    expect(inserted).toContain('superseded-by: [Y]')
    // inserted just before the closing fence, still one-field-per-line
    expect(inserted.split('\n').filter((l) => l === '---')).toHaveLength(2)
  })

  it('appendApprovalLog appends under an existing section, or creates it', () => {
    const withSection = 'body\n\n## Approval log\n'
    expect(appendApprovalLog(withSection, '- line one')).toContain('## Approval log\n- line one')
    const without = 'body only\n'
    const created = appendApprovalLog(without, '- line one')
    expect(created).toContain('## Approval log')
    expect(created).toContain('- line one')
  })

  it('appendApprovalLog keeps the entry INSIDE its section when the log is not last', () => {
    // The log is the last section "by convention" — but at least one TRDD in the
    // real corpus carries `## Notes and lessons learned` after it. Appending at
    // end-of-file would file an approval entry under the notes, silently, since
    // both sections are prose. Every lifecycle verb (promote/refuse/advance/
    // archive) routes through here, so the mistake would be corpus-wide.
    const content = [
      'body',
      '',
      '## Approval log',
      '',
      '- 2026-01-01 — OLD ENTRY.',
      '',
      '## Notes and lessons learned',
      '',
      '[^1]: the why',
      '',
    ].join('\n')

    const out = appendApprovalLog(content, '- 2026-07-10 — NEW ENTRY.')

    // Presence before order — `indexOf(a) < indexOf(b)` passes when a is absent (-1 < n).
    expect(out).toContain('- 2026-07-10 — NEW ENTRY.')
    expect(out).toContain('## Notes and lessons learned')
    expect(out).toContain('- 2026-01-01 — OLD ENTRY.')

    expect(out.indexOf('- 2026-01-01 — OLD ENTRY.')).toBeLessThan(out.indexOf('- 2026-07-10 — NEW ENTRY.'))
    expect(out.indexOf('- 2026-07-10 — NEW ENTRY.')).toBeLessThan(out.indexOf('## Notes and lessons learned'))

    // the notes section is carried through untouched, footnote and all
    expect(out).toContain('[^1]: the why')
    // and the blank separator before the next heading survives
    expect(out).toContain('- 2026-07-10 — NEW ENTRY.\n\n## Notes and lessons learned')
  })

  it('appendApprovalLog handles a header with no entries yet, followed by another section', () => {
    const content = 'body\n\n## Approval log\n\n## Notes and lessons learned\n\nnote\n'
    const out = appendApprovalLog(content, '- first')
    expect(out).toContain('## Approval log\n- first')
    expect(out.indexOf('- first')).toBeLessThan(out.indexOf('## Notes and lessons learned'))
    expect(out).toContain('note')
  })
})

describe('trdd-store lifecycle transitions', () => {
  it('editTrdd edits a field in place and bumps updated (no folder move)', async () => {
    const id = 'EDIT0001'
    writeTask(id, 'edit-me', 'dev')
    const r = await editTrdd(designDir, id, { severity: 'HIGH' }, ISO)
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.zone).toBe('tasks') // unmoved
    expect(t.frontmatter.severity).toBe('HIGH')
    // gray-matter re-parses the ISO `updated:` value into a Date, so verify the
    // writer emitted the exact line rather than comparing the parsed Date to a string.
    expect(fs.readFileSync(t.filePath, 'utf-8')).toContain(`updated: ${ISO}`)
    expect(new Date(t.frontmatter.updated as Date).toISOString()).toBe(ISO)
  })

  it('promote moves a proposal → tasks/, sets column=planned, logs APPROVED', async () => {
    const id = 'PROM0001'
    writeProposal(id, 'promote-me')
    const r = await promoteTrdd(designDir, id, { approver: 'manager', rationale: 'looks good', iso: ISO })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.from).toBe('proposals')
      expect(r.to).toBe('tasks')
    }
    // old location empty, new location holds it with column=planned + log line
    const t = findTrdd(designDir, id)!
    expect(t.zone).toBe('tasks')
    expect(t.column).toBe('planned')
    const raw = fs.readFileSync(t.filePath, 'utf-8')
    // The fixture carries legacy `approval-tier: 2`, which the write side decodes to
    // the TITLE vocabulary (ai-maestro#66 Q9) — never the retired `(tier 2)`.
    expect(raw).toContain('APPROVED by manager (min-approval-requirement: manager)')
    expect(fs.existsSync(path.join(designDir, 'proposals', path.basename(t.filePath)))).toBe(false)
  })

  it('promote refuses a non-proposal (409)', async () => {
    const id = 'PROM0002'
    writeTask(id, 'already-open', 'dev')
    const r = await promoteTrdd(designDir, id, { approver: 'm', iso: ISO })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })

  it('refuse moves a proposal → refused/ with column=refused', async () => {
    const id = 'REFU0001'
    writeProposal(id, 'refuse-me')
    const r = await refuseTrdd(designDir, id, { approver: 'manager', reason: 'out of scope', iso: ISO })
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.zone).toBe('refused')
    expect(t.column).toBe('refused')
    expect(fs.readFileSync(t.filePath, 'utf-8')).toContain('REFUSED by manager')
  })

  it('advanceColumn advances an open task in place (no move)', async () => {
    const id = 'ADVN0001'
    writeTask(id, 'advance-me', 'dev')
    const r = await advanceColumn(designDir, id, 'testing', { iso: ISO, approver: 'orch' })
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.zone).toBe('tasks')
    expect(t.column).toBe('testing')
  })

  it('archive moves a task → archived/ with the terminal state + superseded-by', async () => {
    const id = 'ARCH0001'
    writeTask(id, 'archive-me', 'complete')
    const r = await archiveTrdd(designDir, id, {
      approver: 'manager',
      state: 'superseded',
      supersededBy: 'TRDD-NEWONE01',
      iso: ISO,
    })
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.zone).toBe('archived')
    expect(t.column).toBe('superseded')
    expect(t.frontmatter['superseded-by']).toEqual(['TRDD-NEWONE01'])
    expect(fs.readFileSync(t.filePath, 'utf-8')).toContain('SUPERSEDED by manager')
  })

  it('archive refuses an already-terminal (refused) TRDD (409)', async () => {
    const id = 'ARCH0002'
    const f = writeProposal(id, 'refused-already')
    // simulate it already living in refused/
    const refusedDir = path.join(designDir, 'refused')
    fs.mkdirSync(refusedDir, { recursive: true })
    fs.renameSync(f, path.join(refusedDir, path.basename(f)))
    const r = await archiveTrdd(designDir, id, { approver: 'm', state: 'completed', iso: ISO })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })
})

/**
 * The suites above run in a plain tmpdir, where `git mv` fails and `moveZone`
 * falls back to `renameSync` — so the mv-then-edit staging bug is UNREACHABLE
 * there and no assertion in them could ever have caught it. It needs a real repo.
 *
 * The bug: `git mv` stages the rename by carrying over the blob already indexed
 * for the old path; `editAt` rewrites the file afterwards, leaving the content
 * change unstaged. A caller committing the index then records `rename (100%)`
 * with none of the edit — which is exactly what happened to the bulk archival
 * sweep (124b4e26, repaired by 4d523f4b).
 */
describe('trdd-store lifecycle transitions stage the file they moved (real git repo)', () => {
  let repoRoot: string
  let repoDesign: string

  // realpath: on macOS os.tmpdir() is a symlink (/var → /private/var) and git
  // rejects a path that resolves outside the repo it was told to work in.
  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8', stdio: 'pipe' })
  }

  beforeEach(() => {
    repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-git-')))
    repoDesign = path.join(repoRoot, 'design')
    git('init', '-q')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'trdd-store test')
    git('config', 'commit.gpgsign', 'false')
    // This machine sets a GLOBAL core.hooksPath; a fresh repo inherits it and the
    // fixture's commits would run the user's real hooks. Point it at nothing.
    git('config', 'core.hooksPath', path.join(repoRoot, '.no-such-hooks'))
  })
  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true })
  })

  /** Everything the verbs changed is in the index; nothing is left behind. */
  function expectFullyStaged(expectedColumn: string) {
    // The porcelain line for a moved-and-edited file is `RM` — R for the staged
    // rename, M for the unstaged modification. `R ` alone means the edit landed.
    expect(git('status', '--porcelain', '--', 'design')).not.toMatch(/^RM/m)
    expect(git('diff', '--cached', '--', 'design')).toContain(`+column: ${expectedColumn}`)
    expect(git('diff', '--', 'design')).toBe('') // working tree == index
  }

  function seedAndCommit(write: () => void) {
    write()
    git('add', '--', 'design')
    git('commit', '-q', '-m', 'seed')
  }

  it('promoteTrdd stages the column edit, not just the rename', async () => {
    seedAndCommit(() => writeProposal('AAAA1111', 'promote-me', 'proposal', '', repoDesign))
    const r = await promoteTrdd(repoDesign, 'AAAA1111', { approver: 'MANAGER', iso: ISO })
    expect(r.ok).toBe(true)
    expectFullyStaged('planned')
    expect(git('diff', '--cached', '--', 'design')).toContain('APPROVED by MANAGER')
  })

  it('refuseTrdd stages the column edit, not just the rename', async () => {
    seedAndCommit(() => writeProposal('BBBB2222', 'refuse-me', 'proposal', '', repoDesign))
    const r = await refuseTrdd(repoDesign, 'BBBB2222', { approver: 'MANAGER', iso: ISO })
    expect(r.ok).toBe(true)
    expectFullyStaged('refused')
  })

  it('archiveTrdd stages the column edit, not just the rename', async () => {
    seedAndCommit(() => writeTask('CCCC3333', 'archive-me', 'complete', repoDesign))
    const r = await archiveTrdd(repoDesign, 'CCCC3333', { approver: 'm', state: 'completed', iso: ISO })
    expect(r.ok).toBe(true)
    expectFullyStaged('completed')
  })

  it('does not begin tracking a TRDD that git was not already following', async () => {
    // No `git add` — the file is untracked, so `git mv` fails and moveZone falls
    // back to renameSync. Staging it here would sneak an untracked file into
    // whatever the caller commits next. The move must still succeed.
    writeProposal('DDDD4444', 'untracked', 'proposal', '', repoDesign)
    const r = await promoteTrdd(repoDesign, 'DDDD4444', { approver: 'MANAGER', iso: ISO })
    expect(r.ok).toBe(true)
    expect(git('ls-files', '--', 'design')).toBe('')
    expect(git('diff', '--cached', '--', 'design')).toBe('')
    expect(fs.existsSync(path.join(repoDesign, 'tasks', 'TRDD-20260709_102705+0200-DDDD4444-untracked.md'))).toBe(true)
  })
})

/**
 * TRDD-7JK3NCV4 — an empty result must be PROVABLY empty, never merely unread.
 *
 * `listTrddFiles` used to be `catch { return [] }`, which made an unreadable zone
 * and an empty one the same answer — so a permissions fault, a broken mount, or
 * simply the wrong working directory all read as "there is nothing here", and the
 * write gate built on top exited 0 having scanned nothing.
 *
 * The unreadable cases below are provoked with ENOTDIR / EISDIR rather than
 * chmod, deliberately: those reproduce identically for every user INCLUDING root,
 * whereas a permissions fixture passes vacuously when the suite runs as root.
 */
describe('trdd-store fails loud instead of reporting an empty corpus', () => {
  it('assertDesignDir throws when the corpus root does not exist, and says what to do', () => {
    const missing = path.join(designDir, 'no-such-corpus')
    expect(() => assertDesignDir(missing)).toThrow(/no TRDD corpus at .*no-such-corpus/)
    expect(() => assertDesignDir(missing)).toThrow(/--design-dir/)
  })

  it('assertDesignDir throws when the corpus path is a file rather than a directory', () => {
    const notADir = path.join(designDir, 'design-is-a-file')
    fs.writeFileSync(notADir, 'not a directory')
    expect(() => assertDesignDir(notADir)).toThrow(/not a directory/)
  })

  it('assertDesignDir accepts a real directory (positive control — the guard is not always-throw)', () => {
    expect(() => assertDesignDir(designDir)).not.toThrow()
  })

  it('listTrddFiles returns [] for a MISSING zone — a fresh project has no refused/', () => {
    expect(listTrddFiles(designDir, 'refused')).toEqual([])
  })

  it('listTrddFiles THROWS when the zone cannot be read, naming the zone and the errno', () => {
    // A file where the zone directory belongs → ENOTDIR, not ENOENT.
    fs.writeFileSync(path.join(designDir, 'tasks'), 'this is not a directory')
    expect(() => listTrddFiles(designDir, 'tasks')).toThrow(/cannot read TRDD zone/)
    expect(() => listTrddFiles(designDir, 'tasks')).toThrow(/ENOTDIR/)
  })

  it('listTrddFiles still lists a readable zone (positive control)', () => {
    const file = writeProposal('EEEE5555', 'readable')
    expect(listTrddFiles(designDir, 'proposals')).toEqual([file])
  })

  it('parseTrddFile returns null when the file vanished mid-scan — a git mv race is benign', () => {
    const gone = path.join(designDir, 'tasks', 'TRDD-20260709_102705+0200-FFFF6666-gone.md')
    expect(parseTrddFile(gone, 'tasks')).toBeNull()
  })

  it('parseTrddFile THROWS on a read fault that is not ENOENT', () => {
    // The name passes idFromFilename, so this IS a TRDD by every check the store
    // makes — dropping it silently would delete a real card from every count.
    const dir = path.join(designDir, 'tasks', 'TRDD-20260709_102705+0200-AAAA7777-isdir.md')
    fs.mkdirSync(dir, { recursive: true })
    expect(() => parseTrddFile(dir, 'tasks')).toThrow(/cannot read TRDD/)
    expect(() => parseTrddFile(dir, 'tasks')).toThrow(/EISDIR/)
  })
})
