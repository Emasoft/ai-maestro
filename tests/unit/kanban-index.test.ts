/**
 * The kanban index is a CACHE over the TRDD corpus. Its three properties are the
 * whole contract, so each one is asserted rather than assumed:
 *
 *   REGENERABLE          — delete it, rebuild, get the same rows.
 *   NEVER AUTHORED       — no mutation path exists; the buffer only ever reflects.
 *   NEVER SILENTLY WRONG — an unknown column is bucketed, not dropped; a moved
 *                          corpus reports stale; a corrupt buffer reads as absent.
 *
 * Plus the non-vacuity guard the corpus-invariant suite taught: a builder that
 * returns no rows satisfies every property above.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  KANBAN_INDEX_COLUMNS,
  UNKNOWN_COLUMN,
  buildKanbanIndex,
  corpusFingerprint,
  getKanbanIndex,
  isKanbanIndexStale,
  readKanbanIndex,
  writeKanbanIndex,
} from '@/lib/kanban-index'
import { DEFAULT_STATUSES } from '@/types/task'

const ISO = '2026-07-10T05:00:00+0200'
const DESIGN_DIR = path.resolve(__dirname, '../../design')

let dir: string
let indexPath: string

function write(zone: string, id: string, frontmatter: string, body = 'body\n'): string {
  const zoneDir = path.join(dir, zone)
  fs.mkdirSync(zoneDir, { recursive: true })
  const file = path.join(zoneDir, `TRDD-20260709_102705+0200-${id}-slug.md`)
  fs.writeFileSync(file, `---\ntrdd-id: ${id}\n${frontmatter}---\n\n${body}`)
  return file
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-index-'))
  indexPath = path.join(dir, 'buffer.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('the column vocabulary', () => {
  it('imports the ratified 17 rather than restating them', () => {
    for (const s of DEFAULT_STATUSES) expect(KANBAN_INDEX_COLUMNS).toContain(s)
  })

  it('adds the five folder-lifecycle columns the board vocabulary omits', () => {
    for (const c of ['proposal', 'planned', 'completed', 'cancelled', 'refused']) {
      expect(KANBAN_INDEX_COLUMNS).toContain(c)
    }
  })

  it('contains no duplicate column', () => {
    expect(new Set(KANBAN_INDEX_COLUMNS).size).toBe(KANBAN_INDEX_COLUMNS.length)
  })
})

describe('buildKanbanIndex reads the TRDD, which IS the card', () => {
  it('takes the column and the assignee straight from the frontmatter', () => {
    write('tasks', 'AAAA0001', 'title: A card\ncolumn: dev\nassignee: cos-team\npriority: 2\n')
    const [row] = buildKanbanIndex(dir, ISO).rows
    expect(row.column).toBe('dev')
    expect(row.assignee).toBe('cos-team')
    expect(row.priority).toBe(2)
    expect(row.title).toBe('A card')
    expect(row.filePath).toContain('AAAA0001')
  })

  it('carries the edges, so a reader never has to open the file to see the flock', () => {
    write('tasks', 'PARENT01', 'title: epic\ncolumn: blocked\nnpt: [TRDD-CHILD001]\nblocked-by: [TRDD-CHILD001]\n')
    write('tasks', 'CHILD001', 'title: child\ncolumn: dev\nderived: true\nderived-kind: npt\nparent-trdd: TRDD-PARENT01\n')
    const rows = buildKanbanIndex(dir, ISO).rows
    const parent = rows.find((r) => r.id === 'PARENT01')!
    const child = rows.find((r) => r.id === 'CHILD001')!
    expect(parent.npt).toEqual(['CHILD001'])
    expect(parent.blockedBy).toEqual(['CHILD001'])
    expect(child.derived).toBe(true)
    expect(child.derivedKind).toBe('npt')
    expect(child.parent).toBe('PARENT01')
  })

  it('resolves a v1 `status:` so an old TRDD still lands on a column', () => {
    fs.mkdirSync(path.join(dir, 'archived'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'archived', 'TRDD-70a521d9-5641-4a11-975f-2ca6f5bd9b0c-old.md'),
      '---\ntrdd-id: 70a521d9-5641-4a11-975f-2ca6f5bd9b0c\ntitle: v1\nstatus: completed\n---\nbody\n',
    )
    const [row] = buildKanbanIndex(dir, ISO).rows
    expect(row.id).toBe('70A521D9')
    expect(row.column).toBe('complete')
  })

  it('resolves `status: cancelled`, which the documented v1 enum omits but the corpus uses', () => {
    // An unmapped status reads as column '' and the card lands on no board. This
    // one is real: TRDD-1d4ea74e, the migration the USER declined.
    write('tasks', 'CANC0001', 'title: declined\nstatus: cancelled\n')
    expect(buildKanbanIndex(dir, ISO).rows[0].column).toBe('cancelled')
  })

  it('skips a pre-frontmatter v0 file — a document, not a card', () => {
    fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'tasks', 'TRDD-80557822-v0.md'), '# TRDD ID: 80557822\n')
    expect(buildKanbanIndex(dir, ISO).rows).toEqual([])
  })

  it('buckets an unrecognised column instead of dropping the card', () => {
    // A vocabulary that silently discards a value it does not know is how two
    // boards drift apart. The row must still exist, and it must be visible.
    write('tasks', 'WEIRD001', 'title: odd\ncolumn: reviewing\n')
    const index = buildKanbanIndex(dir, ISO)
    expect(index.rows).toHaveLength(1)
    expect(index.byColumn[UNKNOWN_COLUMN]).toEqual(['WEIRD001'])
  })

  it('orders rows by column, then priority, then id — deterministically', () => {
    write('tasks', 'DEV00002', 'title: d2\ncolumn: dev\npriority: 5\n')
    write('tasks', 'DEV00001', 'title: d1\ncolumn: dev\npriority: 1\n')
    write('proposals', 'PROP0001', 'title: p\ncolumn: proposal\n')
    expect(buildKanbanIndex(dir, ISO).rows.map((r) => r.id)).toEqual(['PROP0001', 'DEV00001', 'DEV00002'])
  })

  it('renders every known column, even the empty ones', () => {
    write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    const { byColumn } = buildKanbanIndex(dir, ISO)
    for (const c of KANBAN_INDEX_COLUMNS) expect(byColumn[c]).toBeDefined()
    expect(byColumn.dev).toEqual(['AAAA0001'])
    expect(byColumn.todo).toEqual([])
  })
})

describe('REGENERABLE — deleting the buffer loses nothing', () => {
  it('rebuilds to identical rows after the file is removed', () => {
    write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\nassignee: x\n')
    const first = getKanbanIndex(dir, ISO, indexPath)
    expect(fs.existsSync(indexPath)).toBe(true)

    fs.rmSync(indexPath)
    const rebuilt = getKanbanIndex(dir, '2026-07-10T06:00:00+0200', indexPath)
    expect(rebuilt.rows).toEqual(first.rows)
    expect(rebuilt.byColumn).toEqual(first.byColumn)
  })

  it('reads a corrupt buffer as absent rather than throwing', () => {
    fs.writeFileSync(indexPath, '{ not json')
    expect(readKanbanIndex(indexPath)).toBeNull()
    expect(readKanbanIndex(path.join(dir, 'nope.json'))).toBeNull()
  })

  it('rejects a buffer from a future version instead of trusting its shape', () => {
    write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    const index = buildKanbanIndex(dir, ISO)
    fs.writeFileSync(indexPath, JSON.stringify({ ...index, version: 99 }))
    expect(readKanbanIndex(indexPath)).toBeNull()
  })
})

describe('NEVER SILENTLY WRONG — staleness', () => {
  it('is fresh against the corpus it was built from', () => {
    write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    expect(isKanbanIndexStale(buildKanbanIndex(dir, ISO), dir)).toBe(false)
  })

  it('goes stale when a card moves column', () => {
    const file = write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    const index = buildKanbanIndex(dir, ISO)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('column: dev', 'column: testing'))
    expect(isKanbanIndexStale(index, dir)).toBe(true)
  })

  it('goes stale when a TRDD is added or removed', () => {
    write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    const index = buildKanbanIndex(dir, ISO)
    const added = write('tasks', 'BBBB0002', 'title: b\ncolumn: dev\n')
    expect(isKanbanIndexStale(index, dir)).toBe(true)
    fs.rmSync(added)
    expect(isKanbanIndexStale(index, dir)).toBe(false)
  })

  it('goes stale when pointed at a different corpus', () => {
    write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    const index = buildKanbanIndex(dir, ISO)
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-other-'))
    try {
      expect(isKanbanIndexStale(index, other)).toBe(true)
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  })

  it('fingerprints by stat, not content — the check must be cheaper than the rebuild', () => {
    // Same bytes, new mtime: reported stale. One-directional on purpose — the
    // opposite error (fresh over a changed corpus) is the one that ruins a plan.
    const file = write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    const before = corpusFingerprint(dir)
    const t = new Date(Date.now() + 60_000)
    fs.utimesSync(file, t, t)
    expect(corpusFingerprint(dir)).not.toBe(before)
  })

  it('serves the cache while fresh and rebuilds once it is not', () => {
    const file = write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    getKanbanIndex(dir, ISO, indexPath)

    // Untouched corpus: the cached generatedAt survives, proving no rebuild.
    expect(getKanbanIndex(dir, '2026-07-10T07:00:00+0200', indexPath).generatedAt).toBe(ISO)

    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').replace('column: dev', 'column: testing'))
    const after = getKanbanIndex(dir, '2026-07-10T08:00:00+0200', indexPath)
    expect(after.generatedAt).toBe('2026-07-10T08:00:00+0200')
    expect(after.rows[0].column).toBe('testing')
  })

  it('an unwritable buffer path costs a rebuild, never a failure', () => {
    write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    const unwritable = path.join(dir, 'tasks', 'TRDD-20260709_102705+0200-AAAA0001-slug.md', 'buffer.json')
    const index = getKanbanIndex(dir, ISO, unwritable)
    expect(index.rows).toHaveLength(1)
  })

  it('writes the buffer atomically, leaving no partial file behind', () => {
    write('tasks', 'AAAA0001', 'title: a\ncolumn: dev\n')
    writeKanbanIndex(buildKanbanIndex(dir, ISO), indexPath)
    expect(fs.readdirSync(dir).filter((n) => n.includes('.tmp.'))).toEqual([])
    expect(readKanbanIndex(indexPath)!.rows).toHaveLength(1)
  })
})

describe('the real design/ corpus', () => {
  const index = buildKanbanIndex(DESIGN_DIR, ISO)

  it('indexes a non-trivial number of cards (an empty index satisfies every property above)', () => {
    expect(index.rows.length).toBeGreaterThan(100)
    expect(index.rows.some((r) => r.blockedBy.length > 0)).toBe(true)
    expect(index.rows.some((r) => r.assignee)).toBe(true)
  })

  it('uses no column outside the vocabulary — a new one must be a deliberate addition', () => {
    // The bucket is the alarm. If this fails, someone invented a column; either add
    // it to KANBAN_INDEX_COLUMNS on purpose, or fix the TRDD.
    const strays = index.byColumn[UNKNOWN_COLUMN].map((id) => {
      const row = index.rows.find((r) => r.id === id)!
      return `${id}: column=${row.column || '(empty)'} in ${row.zone}`
    })
    expect(strays).toEqual([])
  })

  it('every row points at a file that exists — the row is a pointer, not the truth', () => {
    expect(index.rows.filter((r) => !fs.existsSync(r.filePath))).toEqual([])
  })
})
