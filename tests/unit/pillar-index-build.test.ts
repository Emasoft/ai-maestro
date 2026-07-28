import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { openIndex, validate, validateAt, SCHEMA_VERSION } from '@/lib/pillar/index-db'
import { syncIndex, danglingRefs } from '@/lib/pillar/index-build'
import { TRDD_KIND } from '@/lib/pillar/kinds'
import { loadTrddGraph } from '@/lib/trdd-graph'

/**
 * TRDD-L55IYKL4 — the index BUILD path.
 *
 * Two properties carry the design, and both have a test that fails without them:
 *
 *  - INCREMENTAL. A full walk at 10⁵ costs ~6.5 GB and crashes, so "rebuild
 *    everything" is the outage, not the fallback. A sync where nothing changed must
 *    read nothing.
 *  - THE ANSWER MUST NOT CHANGE. An index is an accelerator, never an authority, so
 *    the differential test is the acceptance criterion: index-backed and walk-backed
 *    answers agree on the LIVE corpus, not on a fixture I designed to agree.
 */

let tmp: string
let corpus: string
let dbFile: string

const card = (id: string, fm: Record<string, string> = {}, body = 'prose') =>
  [
    '---',
    `trdd-id: ${id}`,
    `title: card ${id}`,
    'column: dev',
    ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`),
    '---',
    '',
    body,
    '',
  ].join('\n')

function write(zone: string, id: string, fm?: Record<string, string>, body?: string): string {
  const dir = path.join(corpus, zone)
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, `TRDD-20260101_000000+0100-${id}-x.md`)
  fs.writeFileSync(p, card(id, fm, body))
  return p
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-build-'))
  corpus = path.join(tmp, 'design')
  for (const z of TRDD_KIND.zones) fs.mkdirSync(path.join(corpus, z), { recursive: true })
  dbFile = path.join(tmp, 'idx.sqlite')
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('a first sync', () => {
  it('indexes every document, its records and its edges', () => {
    write('tasks', 'AAAAAAAA', { 'blocked-by': '[BBBBBBBB]', 'npt': '[CCCCCCCC]' })
    write('tasks', 'BBBBBBBB')
    write('archived', 'CCCCCCCC', { 'parent-trdd': 'AAAAAAAA' })
    const db = openIndex(dbFile)
    const s = syncIndex(db, corpus, TRDD_KIND)

    expect(s.scanned).toBe(3)
    expect(s.added).toBe(3)
    expect(s.records).toBe(3)
    // AAAAAAAA: blocked-by + npt = 2; CCCCCCCC: parent-trdd = 1.
    expect(s.edges).toBe(3)
    expect(validate(db)).toEqual({ ok: true })
    db.close()
  })

  it('records the zone, so archived and open cards stay distinguishable', () => {
    write('tasks', 'AAAAAAAA')
    write('archived', 'BBBBBBBB')
    const db = openIndex(dbFile)
    syncIndex(db, corpus, TRDD_KIND)
    const zones = db
      .prepare(`SELECT id, zone FROM records JOIN files USING(path) ORDER BY id`)
      .all() as Array<{ id: string; zone: string }>
    db.close()
    expect(zones).toEqual([
      { id: 'AAAAAAAA', zone: 'tasks' },
      { id: 'BBBBBBBB', zone: 'archived' },
    ])
  })
})

describe('incremental — the property the 10^5 measurement forces', () => {
  it('a second sync with nothing changed reads NOTHING', () => {
    write('tasks', 'AAAAAAAA')
    write('tasks', 'BBBBBBBB')
    const db = openIndex(dbFile)
    syncIndex(db, corpus, TRDD_KIND)
    const s = syncIndex(db, corpus, TRDD_KIND)
    db.close()
    expect(s.added).toBe(0)
    expect(s.changed).toBe(0)
    expect(s.removed).toBe(0)
    // No re-read means no rows re-written; a "no-op" that rewrote everything would
    // be exactly the full rebuild this design exists to avoid.
    expect(s.records).toBe(0)
    expect(s.edges).toBe(0)
  })

  it('an edited card re-indexes ONLY itself', () => {
    const a = write('tasks', 'AAAAAAAA')
    write('tasks', 'BBBBBBBB')
    const db = openIndex(dbFile)
    syncIndex(db, corpus, TRDD_KIND)
    fs.writeFileSync(a, card('AAAAAAAA', { 'npt': '[BBBBBBBB]' }, 'edited'))
    const s = syncIndex(db, corpus, TRDD_KIND)
    db.close()
    expect(s.changed).toBe(1)
    expect(s.added).toBe(0)
    expect(s.records).toBe(1)
    expect(s.edges).toBe(1)
  })

  it('a deleted card is evicted from records, edges AND the FTS', () => {
    // The FTS row is the easy one to forget, and forgetting it leaves a deleted card
    // still answering searches. This is the whole reason schema v2 added
    // `path UNINDEXED` to records_fts.
    const a = write('tasks', 'AAAAAAAA', {}, 'findmeplease')
    write('tasks', 'BBBBBBBB')
    const db = openIndex(dbFile)
    syncIndex(db, corpus, TRDD_KIND)
    expect(
      (db.prepare(`SELECT COUNT(*) n FROM records_fts WHERE records_fts MATCH 'findmeplease'`).get() as { n: number })
        .n,
    ).toBe(1)

    fs.rmSync(a)
    const s = syncIndex(db, corpus, TRDD_KIND)
    expect(s.removed).toBe(1)
    expect((db.prepare(`SELECT COUNT(*) n FROM records WHERE id='AAAAAAAA'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) n FROM edges WHERE src_id='AAAAAAAA'`).get() as { n: number }).n).toBe(0)
    expect(
      (db.prepare(`SELECT COUNT(*) n FROM records_fts WHERE records_fts MATCH 'findmeplease'`).get() as { n: number })
        .n,
    ).toBe(0)
    expect(validate(db)).toEqual({ ok: true })
    db.close()
  })

  it('re-indexing a card does not duplicate its rows', () => {
    const a = write('tasks', 'AAAAAAAA', { 'npt': '[BBBBBBBB]' })
    const db = openIndex(dbFile)
    syncIndex(db, corpus, TRDD_KIND)
    fs.writeFileSync(a, card('AAAAAAAA', { 'npt': '[BBBBBBBB]' }, 'different body'))
    syncIndex(db, corpus, TRDD_KIND)
    const n = db.prepare(`SELECT COUNT(*) n FROM edges WHERE src_id='AAAAAAAA'`).get() as { n: number }
    db.close()
    expect(n.n).toBe(1)
  })
})

describe('danglingRefs — the query the index exists for', () => {
  it('finds a reference whose target is not in the corpus', () => {
    write('tasks', 'AAAAAAAA', { 'blocked-by': '[NOSUCHID]' })
    write('tasks', 'BBBBBBBB', { 'npt': '[AAAAAAAA]' })
    const db = openIndex(dbFile)
    syncIndex(db, corpus, TRDD_KIND)
    const d = danglingRefs(db, 'trdd')
    db.close()
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ srcId: 'AAAAAAAA', field: 'blocked-by', dstId: 'NOSUCHID' })
  })

  it('a fully-resolved corpus yields none (positive control)', () => {
    write('tasks', 'AAAAAAAA', { 'npt': '[BBBBBBBB]' })
    write('tasks', 'BBBBBBBB')
    const db = openIndex(dbFile)
    syncIndex(db, corpus, TRDD_KIND)
    const d = danglingRefs(db, 'trdd')
    db.close()
    expect(d).toEqual([])
  })
})

describe('DIFFERENTIAL — index-backed answers must equal walk-backed ones, on the LIVE corpus', () => {
  it('the indexed id set equals the graph\'s node set', () => {
    // A fixture I designed would prove the two agree where I made them agree. The
    // real corpus is the only input neither side was written against.
    const liveDesign = path.join(process.cwd(), 'design')
    const db = openIndex(dbFile)
    syncIndex(db, liveDesign, TRDD_KIND)
    const indexed = (db.prepare(`SELECT DISTINCT id FROM records ORDER BY id`).all() as Array<{ id: string }>).map(
      (r) => r.id,
    )
    db.close()

    const graph = loadTrddGraph(liveDesign)
    const walked = [...new Set(graph.map((n) => n.id))].sort()

    expect(indexed.length).toBeGreaterThan(100)
    expect(indexed).toEqual(walked)
  })
})

describe('the v2 ladder step, with a REAL version skew', () => {
  it('a v1 index is BEHIND, not damaged, even though records_fts lacks `path`', () => {
    // Until v2 existed this could only be exercised through an injected spec. Now the
    // shipped ladder produces the exact janitor#123 shape: a column that legitimately
    // does not exist yet on an index that is merely behind.
    const raw = new Database(dbFile)
    raw.pragma('busy_timeout = 5000')
    raw.exec(`
      CREATE TABLE files (path TEXT PRIMARY KEY, kind TEXT, zone TEXT, identity TEXT, indexed_at INTEGER);
      CREATE TABLE records (kind TEXT, id TEXT, path TEXT, line INTEGER, col TEXT, title TEXT);
      CREATE TABLE edges (src_kind TEXT, src_id TEXT, field TEXT, dst_kind TEXT, dst_id TEXT, path TEXT);
      CREATE VIRTUAL TABLE records_fts USING fts5(id, title, body);
    `)
    raw.pragma('user_version = 1')
    const r = validateAt(raw, SCHEMA_VERSION)
    raw.close()
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.faults.map((f) => f.code)).toEqual(['behind'])
  })

  it('migrating that v1 index forward yields a valid v2 index', () => {
    const raw = new Database(dbFile)
    raw.pragma('busy_timeout = 5000')
    raw.exec(`
      CREATE TABLE files (path TEXT PRIMARY KEY, kind TEXT, zone TEXT, identity TEXT, indexed_at INTEGER);
      CREATE TABLE records (kind TEXT, id TEXT, path TEXT, line INTEGER, col TEXT, title TEXT);
      CREATE TABLE edges (src_kind TEXT, src_id TEXT, field TEXT, dst_kind TEXT, dst_id TEXT, path TEXT);
      CREATE VIRTUAL TABLE records_fts USING fts5(id, title, body);
    `)
    raw.pragma('user_version = 1')
    raw.close()

    const db = openIndex(dbFile)
    expect(validate(db)).toEqual({ ok: true })
    const cols = (db.pragma('table_info(records_fts)') as Array<{ name: string }>).map((c) => c.name)
    db.close()
    expect(cols).toContain('path')
  })
})
