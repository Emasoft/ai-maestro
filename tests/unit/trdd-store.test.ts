import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  parseTrddFile,
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

function writeProposal(id: string, slug: string, column = 'proposal', extra = ''): string {
  const dir = path.join(designDir, 'proposals')
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

function writeTask(id: string, slug: string, column = 'dev'): string {
  const dir = path.join(designDir, 'tasks')
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
})

describe('trdd-store lifecycle transitions', () => {
  it('editTrdd edits a field in place and bumps updated (no folder move)', () => {
    const id = 'EDIT0001'
    writeTask(id, 'edit-me', 'dev')
    const r = editTrdd(designDir, id, { severity: 'HIGH' }, ISO)
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.zone).toBe('tasks') // unmoved
    expect(t.frontmatter.severity).toBe('HIGH')
    // gray-matter re-parses the ISO `updated:` value into a Date, so verify the
    // writer emitted the exact line rather than comparing the parsed Date to a string.
    expect(fs.readFileSync(t.filePath, 'utf-8')).toContain(`updated: ${ISO}`)
    expect(new Date(t.frontmatter.updated as Date).toISOString()).toBe(ISO)
  })

  it('promote moves a proposal → tasks/, sets column=planned, logs APPROVED', () => {
    const id = 'PROM0001'
    writeProposal(id, 'promote-me')
    const r = promoteTrdd(designDir, id, { approver: 'manager', tier: 2, rationale: 'looks good', iso: ISO })
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
    expect(raw).toContain('APPROVED by manager (tier 2)')
    expect(fs.existsSync(path.join(designDir, 'proposals', path.basename(t.filePath)))).toBe(false)
  })

  it('promote refuses a non-proposal (409)', () => {
    const id = 'PROM0002'
    writeTask(id, 'already-open', 'dev')
    const r = promoteTrdd(designDir, id, { approver: 'm', iso: ISO })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })

  it('refuse moves a proposal → refused/ with column=refused', () => {
    const id = 'REFU0001'
    writeProposal(id, 'refuse-me')
    const r = refuseTrdd(designDir, id, { approver: 'manager', reason: 'out of scope', iso: ISO })
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.zone).toBe('refused')
    expect(t.column).toBe('refused')
    expect(fs.readFileSync(t.filePath, 'utf-8')).toContain('REFUSED by manager')
  })

  it('advanceColumn advances an open task in place (no move)', () => {
    const id = 'ADVN0001'
    writeTask(id, 'advance-me', 'dev')
    const r = advanceColumn(designDir, id, 'testing', { iso: ISO, approver: 'orch' })
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.zone).toBe('tasks')
    expect(t.column).toBe('testing')
  })

  it('archive moves a task → archived/ with the terminal state + superseded-by', () => {
    const id = 'ARCH0001'
    writeTask(id, 'archive-me', 'complete')
    const r = archiveTrdd(designDir, id, {
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

  it('archive refuses an already-terminal (refused) TRDD (409)', () => {
    const id = 'ARCH0002'
    const f = writeProposal(id, 'refused-already')
    // simulate it already living in refused/
    const refusedDir = path.join(designDir, 'refused')
    fs.mkdirSync(refusedDir, { recursive: true })
    fs.renameSync(f, path.join(refusedDir, path.basename(f)))
    const r = archiveTrdd(designDir, id, { approver: 'm', state: 'completed', iso: ISO })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
  })
})
