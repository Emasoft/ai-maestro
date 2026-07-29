import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { openIndex, validate, validateAt, SCHEMA_VERSION, IndexFaultError } from '@/lib/pillar/index-db'
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

  it('a deleted card is evicted from records and edges', () => {
    const a = write('tasks', 'AAAAAAAA', {}, 'findmeplease')
    write('tasks', 'BBBBBBBB')
    const db = openIndex(dbFile)
    syncIndex(db, corpus, TRDD_KIND)

    fs.rmSync(a)
    const s = syncIndex(db, corpus, TRDD_KIND)
    expect(s.removed).toBe(1)
    expect((db.prepare(`SELECT COUNT(*) n FROM records WHERE id='AAAAAAAA'`).get() as { n: number }).n).toBe(0)
    expect((db.prepare(`SELECT COUNT(*) n FROM edges WHERE src_id='AAAAAAAA'`).get() as { n: number }).n).toBe(0)
    // The surviving sibling must still be there — otherwise "evicted" would also be
    // satisfied by a sync that wiped everything, and the assertions above would pass
    // for the wrong reason.
    expect((db.prepare(`SELECT COUNT(*) n FROM records WHERE id='BBBBBBBB'`).get() as { n: number }).n).toBe(1)
    expect(validate(db)).toEqual({ ok: true })
    db.close()
  })

  it('the build does NOT populate records_fts — the readerless-FTS decision, pinned', () => {
    // TRDD-7CHUK1AZ: `body` was the only large field on the retained `pending` array,
    // and its sole consumer was an FTS nothing ever queried (search takes a REGEX, which
    // FTS5 cannot serve). At 10^5 that combination did not merely run slowly — the cold
    // build was KILLED at 1h32m with the WAL rate still decaying. The write is gone; the
    // table, its migrations and its shape check stay, so restoring it is one statement.
    //
    // This test is what makes that a DECISION rather than a drift: re-adding the INSERT
    // turns it red, which is the moment to also restore the parity check retired in
    // index-db.ts — the two are one decision and must not come back separately.
    write('tasks', 'AAAAAAAA', {}, 'findmeplease')
    const db = openIndex(dbFile)
    const s = syncIndex(db, corpus, TRDD_KIND)

    // POSITIVE CONTROL first: the sync really ran and really indexed the card. Without
    // this, "the FTS is empty" would also be true of a sync that did nothing at all.
    expect(s.records).toBeGreaterThan(0)
    expect((db.prepare(`SELECT COUNT(*) n FROM records WHERE id='AAAAAAAA'`).get() as { n: number }).n).toBe(1)

    expect((db.prepare(`SELECT COUNT(*) n FROM records_fts`).get() as { n: number }).n).toBe(0)
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

describe('N agents on one host — a second writer (TRDD-YN8EQWYP)', () => {
  /**
   * Hold the write lock exactly as a second PROCESS would.
   *
   * SQLite's write lock is per-DATABASE, not per-process, so two connections inside one
   * test reproduce precisely the contention two agents produce — and deterministically,
   * which two spawned processes racing each other would not be. The holder gets its own
   * short busy_timeout so that if the TEST is ever the blocked party it fails fast
   * instead of hanging the suite.
   */
  function holdWriteLock(file: string): Database.Database {
    const holder = new Database(file)
    holder.pragma('busy_timeout = 200')
    holder.exec('BEGIN IMMEDIATE')
    return holder
  }

  it('takes the lock BEFORE the first corpus read, not merely around the writes', () => {
    write('tasks', 'AAAAAAAA')
    const db = openIndex(dbFile, { busyTimeoutMs: 150 })
    syncIndex(db, corpus, TRDD_KIND)

    // Make the FIRST corpus read fail: a zone that is a FILE raises ENOTDIR, which the
    // fail-loud reader must propagate (only ENOENT is a legally absent zone). ENOTDIR
    // rather than chmod on purpose — a permissions fixture passes VACUOUSLY as root.
    const zone = path.join(corpus, 'refused')
    fs.rmSync(zone, { recursive: true, force: true })
    fs.writeFileSync(zone, 'not a directory')

    // POSITIVE CONTROL, and it is the load-bearing half of the pair: it proves the
    // broken zone really does throw WHEN THE READ IS REACHED. Without it the `busy`
    // below is satisfied whether or not the lock precedes the read — which is exactly
    // the vacuous shape this test exists to rule out.
    expect(() => syncIndex(db, corpus, TRDD_KIND)).toThrow(/cannot read TRDD zone/i)

    const holder = holdWriteLock(dbFile)
    try {
      let caught: unknown
      try {
        syncIndex(db, corpus, TRDD_KIND)
      } catch (e) {
        caught = e
      }
      // `busy` INSTEAD OF the control's error IS the ordering assertion: the lock was
      // demanded before `listDocuments` ran. With the transaction around the writes
      // only, this same call reaches the read first and throws the control's error.
      expect(caught).toBeInstanceOf(IndexFaultError)
      expect((caught as IndexFaultError).fault.code).toBe('busy')
      // The operator-facing text, because this string is what `greptrdd` prints as it
      // degrades: it has to say contention, or a routine race reads as a broken cache.
      expect((caught as Error).message).toMatch(/NOT damage/)
    } finally {
      holder.exec('ROLLBACK')
      holder.close()
      db.close()
    }
  })

  it("a SEPARATE connection sees the first writer's COMMITTED state — an empty delta", () => {
    write('tasks', 'AAAAAAAA', { 'blocked-by': '[BBBBBBBB]' })
    write('tasks', 'BBBBBBBB')

    const first = openIndex(dbFile)
    const a = syncIndex(first, corpus, TRDD_KIND)
    first.close()

    // A genuinely separate connection, as a second agent's process would open.
    const second = openIndex(dbFile)
    const b = syncIndex(second, corpus, TRDD_KIND)
    try {
      expect(a.added).toBe(2)
      expect(a.records).toBe(2)
      // The delta is computed INSIDE the lock, so the second writer reads the first's
      // committed identities and re-parses nothing. Computed outside it — the shape
      // this replaced — both writers derive the same delta from the same pre-state and
      // both do the entire job, which at 10^5 is two concurrent multi-GB builds.
      expect(b.added).toBe(0)
      expect(b.changed).toBe(0)
      expect(b.records).toBe(0)
      expect(b.edges).toBe(0)
      expect(validate(second)).toEqual({ ok: true })
    } finally {
      second.close()
    }
  })
})
