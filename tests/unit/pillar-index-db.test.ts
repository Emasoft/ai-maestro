import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import {
  SCHEMA_VERSION,
  openIndex,
  validate,
  validateStructural,
  validateAt,
  checkShape,
  migrate,
  recordHeal,
  readHealLedger,
  corpusKeyFor,
  indexPath,
  IndexFaultError,
} from '@/lib/pillar/index-db'

/**
 * TRDD-L55IYKL4 — the pillar index's safety core.
 *
 * The USER asked for "stronger safety mechanisms for the indexer db". These tests
 * are what makes that claim checkable rather than asserted, and they are weighted
 * toward the ONE mistake the file exists to not repeat (janitor#123):
 *
 *   a missing column means TWO different things, and the version stamp is the only
 *   discriminator. `user_version < SCHEMA_VERSION` = behind the ladder, migrate.
 *   `user_version == SCHEMA_VERSION` = a migration lied, genuinely damaged.
 *
 * Reporting the first as damage is how a HEALTHY index gets nuked, so a test that
 * only proved "damage is detected" would pass while the real bug shipped.
 */

let tmp: string
let db1: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-idx-'))
  db1 = path.join(tmp, 'idx.sqlite')
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('a freshly opened index', () => {
  it('is created, migrated to SCHEMA_VERSION, and valid', () => {
    const db = openIndex(db1)
    expect((db.pragma('user_version') as Array<{ user_version: number }>)[0].user_version).toBe(
      SCHEMA_VERSION,
    )
    expect(validate(db)).toEqual({ ok: true })
    db.close()
  })

  it('carries the edges table — the reason the index exists at all', () => {
    // An index of documents alone would leave the O(N x refs x lookup) join
    // untouched, which is the thing the USER's second correction was about.
    const db = openIndex(db1)
    const cols = (db.pragma('table_info(edges)') as Array<{ name: string }>).map((r) => r.name)
    expect(cols).toEqual(
      expect.arrayContaining(['src_kind', 'src_id', 'field', 'dst_kind', 'dst_id', 'path']),
    )
    db.close()
  })

  it('applies WAL — and busy_timeout is set FIRST, without which WAL silently does not take', () => {
    const db = openIndex(db1)
    expect(String((db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode))
      .toBe('wal')
    db.close()
  })

  it('is idempotent: reopening an already-migrated index neither migrates nor heals', () => {
    openIndex(db1).close()
    const ledger = `${db1}.heal.json`
    const db = openIndex(db1)
    expect(validate(db)).toEqual({ ok: true })
    db.close()
    expect(readHealLedger(ledger)).toEqual([])
  })
})

describe('janitor#123 — a missing column means TWO different things', () => {
  // The bug is COLUMN-granular: memgrep's `atoms` was missing `status`, added in v6,
  // on a DB still at v5 — healthy, merely behind, and reported as damaged. The
  // reachable ladder here has one step, so the skew is exercised through an injected
  // spec. An untested guard for a bug the ecosystem already shipped once is not a
  // guard, and my first attempt at these tests passed with the guard DELETED —
  // it asserted through the table-level skip and never reached the branch it named.

  const specWithV2Column = [
    {
      name: 'files',
      since: 1,
      cols: [
        { name: 'path', since: 1 },
        { name: 'kind', since: 1 },
        { name: 'zone', since: 1 },
        { name: 'identity', since: 1 },
        { name: 'indexed_at', since: 1 },
        { name: 'added_in_v2', since: 2 },
      ],
    },
  ]

  it('a column introduced at v2 is legitimately ABSENT from a v1 index — no fault', () => {
    const db = openIndex(db1) // real v1 schema: no `added_in_v2`
    expect(checkShape(db, 1, specWithV2Column)).toEqual([])
    db.close()
  })

  it('the SAME missing column IS damage once the index claims to be v2', () => {
    // Identical database, identical spec — only the version stamp differs, which is
    // exactly the discriminator the fix is built on.
    const db = openIndex(db1)
    const faults = checkShape(db, 2, specWithV2Column)
    db.close()
    expect(faults).toHaveLength(1)
    expect(faults[0].code).toBe('shape')
    expect(faults[0].detail).toMatch(/added_in_v2/)
  })

  it('a TABLE introduced later is skipped too, at the same granularity', () => {
    const db = openIndex(db1)
    expect(checkShape(db, 1, [{ name: 'future', since: 2, cols: [{ name: 'x', since: 2 }] }]))
      .toEqual([])
    expect(checkShape(db, 2, [{ name: 'future', since: 2, cols: [{ name: 'x', since: 2 }] }]))
      .toHaveLength(1)
    db.close()
  })

  it('a v0 index validated against v1 reports `behind`, never damage', () => {
    const raw = new Database(db1)
    raw.pragma('user_version = 0')
    const r = validateAt(raw, 1)
    raw.close()
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.faults.map((f) => f.code)).toEqual(['behind'])
  })

  it('a CURRENT index missing a table reports damage, never `behind`', () => {
    const db = openIndex(db1)
    db.exec('DROP TABLE edges')
    const r = validate(db)
    db.close()
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.faults.some((f) => f.code === 'shape')).toBe(true)
    expect(r.faults.some((f) => f.code === 'behind')).toBe(false)
  })

  it('damage on a BEHIND index is still reported as damage — the two are orthogonal', () => {
    // The case the earlier ternary could not express at all, because it made
    // "behind" and "damaged" alternatives rather than independent facts.
    const db = openIndex(db1)
    db.exec('DROP TABLE files')
    db.pragma('user_version = 1')
    const r = validateAt(db, 2)
    db.close()
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.faults.some((f) => f.code === 'shape')).toBe(true)
  })
})

describe('downgrade — a DB newer than the binary is NOT damaged', () => {
  it('throws with its own code rather than healing', () => {
    const raw = new Database(db1)
    raw.pragma(`user_version = ${SCHEMA_VERSION + 5}`)
    raw.close()
    let caught: unknown
    try {
      openIndex(db1)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IndexFaultError)
    expect((caught as IndexFaultError).fault.code).toBe('downgrade')
  })

  it('LEAVES THE FILE ON DISK — deleting it would destroy a good index to satisfy old code', () => {
    const raw = new Database(db1)
    raw.pragma(`user_version = ${SCHEMA_VERSION + 5}`)
    raw.exec('CREATE TABLE precious(x)')
    raw.close()
    try {
      openIndex(db1)
    } catch {
      /* expected */
    }
    expect(fs.existsSync(db1)).toBe(true)
    const after = new Database(db1)
    const t = after
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='precious'`)
      .get()
    after.close()
    expect(t).toBeTruthy()
  })
})

describe('self-heal, and the ledger that keeps it from being invisible', () => {
  it('rebuilds a corrupt file and RECORDS the event', () => {
    fs.writeFileSync(db1, 'this is not a sqlite database at all')
    const ledger = path.join(tmp, 'heal.json')
    const db = openIndex(db1, { ledgerFile: ledger, now: () => '2026-07-28T00:00:00Z' })
    expect(validate(db)).toEqual({ ok: true })
    db.close()
    const events = readHealLedger(ledger)
    expect(events).toHaveLength(1)
    expect(events[0].at).toBe('2026-07-28T00:00:00Z')
  })

  it('rebuilds a structurally-damaged index and records the FAULT, not just "it healed"', () => {
    openIndex(db1).close()
    const raw = new Database(db1)
    raw.exec('DROP TABLE records')
    raw.close()
    const ledger = path.join(tmp, 'heal.json')
    const db = openIndex(db1, { ledgerFile: ledger, now: () => '2026-07-28T00:00:01Z' })
    expect(validate(db)).toEqual({ ok: true })
    db.close()
    const events = readHealLedger(ledger)
    expect(events).toHaveLength(1)
    expect(events[0].faults.join(' ')).toMatch(/shape/)
  })

  it('noHeal THROWS instead of healing — an observer must not repair what it measures', () => {
    openIndex(db1).close()
    const raw = new Database(db1)
    raw.exec('DROP TABLE records')
    raw.close()
    const ledger = path.join(tmp, 'heal.json')
    expect(() => openIndex(db1, { noHeal: true, ledgerFile: ledger })).toThrow(IndexFaultError)
    // Nothing repaired, nothing logged: a daily-recurring corruption stays visible
    // to whoever is asking whether it recurs.
    expect(readHealLedger(ledger)).toEqual([])
    const still = new Database(db1)
    const t = still
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='records'`)
      .get()
    still.close()
    expect(t).toBeFalsy()
  })

  it('takes -wal and -shm with it, so SQLite cannot rebuild from a dead database log', () => {
    const db = openIndex(db1)
    db.prepare(`INSERT INTO files VALUES ('a','trdd','tasks','git:x',0)`).run()
    db.close()
    fs.writeFileSync(`${db1}-wal`, 'stale wal')
    fs.writeFileSync(db1, 'corrupt')
    const fresh = openIndex(db1, { ledgerFile: path.join(tmp, 'h.json') })
    expect(validate(fresh)).toEqual({ ok: true })
    expect((fresh.prepare('SELECT COUNT(*) n FROM files').get() as { n: number }).n).toBe(0)
    fresh.close()
  })
})

describe('the heal ledger is bounded and atomically rewritten', () => {
  it('keeps only the most recent N events', () => {
    const ledger = path.join(tmp, 'h.json')
    for (let i = 0; i < 10; i++) {
      recordHeal(ledger, { at: `t${i}`, reason: 'x', faults: [] }, 4)
    }
    const events = readHealLedger(ledger)
    expect(events).toHaveLength(4)
    expect(events.map((e) => e.at)).toEqual(['t6', 't7', 't8', 't9'])
  })

  it('survives an unreadable ledger rather than failing the heal it is auditing', () => {
    const ledger = path.join(tmp, 'h.json')
    fs.writeFileSync(ledger, '{ not json')
    recordHeal(ledger, { at: 't', reason: 'x', faults: [] })
    expect(readHealLedger(ledger)).toHaveLength(1)
  })

  it('leaves no .tmp behind — the rename is what makes it atomic', () => {
    const ledger = path.join(tmp, 'h.json')
    recordHeal(ledger, { at: 't', reason: 'x', faults: [] })
    expect(fs.existsSync(`${ledger}.tmp`)).toBe(false)
  })
})

describe('FTS parity and orphans', () => {
  it('accepts a consistent FTS index', () => {
    const db = openIndex(db1)
    db.prepare(`INSERT INTO records_fts(id,title,body) VALUES ('A','t','hello world')`).run()
    expect(validate(db)).toEqual({ ok: true })
    db.close()
  })

  it('reports rows that reference a file no longer indexed', () => {
    const db = openIndex(db1)
    // Columns NAMED, not positional. A bare `VALUES (...)` is coupled to the column
    // COUNT, so v3's `priority` broke every one of these at once — loudly, which is
    // the good case, but it will happen again on v4. Naming the columns makes these
    // fixtures survive any future additive migration.
    db.prepare(`INSERT INTO records (kind,id,path,line,col,title) VALUES ('trdd','A','/gone.md',NULL,'dev','t')`).run()
    const r = validate(db)
    db.close()
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.faults.some((f) => f.code === 'orphan')).toBe(true)
  })

  it('a record whose file IS indexed is not an orphan (positive control)', () => {
    const db = openIndex(db1)
    db.prepare(`INSERT INTO files VALUES ('/a.md','trdd','tasks','git:x',0)`).run()
    db.prepare(`INSERT INTO records (kind,id,path,line,col,title) VALUES ('trdd','A','/a.md',NULL,'dev','t')`).run()
    expect(validate(db)).toEqual({ ok: true })
    db.close()
  })
})

describe('the schema stores what a linter must be able to REPORT', () => {
  it('accepts the same id in two files — a duplicate is a finding, not a constraint violation', () => {
    // If the schema rejected this, the index would refuse to describe a corpus the
    // linter exists to describe, and the duplicate would become invisible.
    const db = openIndex(db1)
    db.prepare(`INSERT INTO files VALUES ('/a.md','trdd','tasks','i',0)`).run()
    db.prepare(`INSERT INTO files VALUES ('/b.md','trdd','archived','i',0)`).run()
    db.prepare(`INSERT INTO records (kind,id,path,line,col,title) VALUES ('trdd','DUP','/a.md',NULL,'dev','one')`).run()
    db.prepare(`INSERT INTO records (kind,id,path,line,col,title) VALUES ('trdd','DUP','/b.md',NULL,'completed','two')`).run()
    const n = db.prepare(`SELECT COUNT(*) n FROM records WHERE id='DUP'`).get() as { n: number }
    expect(n.n).toBe(2)
    expect(validate(db)).toEqual({ ok: true })
    db.close()
  })

  it('resolves a dangling reference with ONE join, which is the whole point of edges', () => {
    const db = openIndex(db1)
    db.prepare(`INSERT INTO files VALUES ('/a.md','trdd','tasks','i',0)`).run()
    db.prepare(`INSERT INTO records (kind,id,path,line,col,title) VALUES ('trdd','AAA','/a.md',NULL,'dev','a')`).run()
    db.prepare(`INSERT INTO edges VALUES ('trdd','AAA','blocked-by','trdd','MISSING','/a.md')`).run()
    db.prepare(`INSERT INTO edges VALUES ('trdd','AAA','npt','trdd','AAA','/a.md')`).run()
    const dangling = db
      .prepare(
        `SELECT e.dst_id FROM edges e
           LEFT JOIN records r ON r.kind = e.dst_kind AND r.id = e.dst_id
          WHERE r.id IS NULL`,
      )
      .all() as Array<{ dst_id: string }>
    db.close()
    expect(dangling.map((d) => d.dst_id)).toEqual(['MISSING'])
  })
})

describe('corpusKeyFor — one index per corpus, and never inside it', () => {
  it('is stable for the same corpus', () => {
    expect(corpusKeyFor(tmp)).toBe(corpusKeyFor(tmp))
  })

  it('DIFFERS for two corpora that share the basename `design`', () => {
    // The collision that matters: every agent workdir and every LOCAL corpus has a
    // directory called `design`, so a slug-only key would silently make N corpora
    // share one index — each sync wiping the last one's rows.
    const a = path.join(tmp, 'projA', 'design')
    const b = path.join(tmp, 'projB', 'design')
    fs.mkdirSync(a, { recursive: true })
    fs.mkdirSync(b, { recursive: true })
    expect(corpusKeyFor(a)).not.toBe(corpusKeyFor(b))
    // …and each still names its project, so the file is identifiable by eye.
    expect(corpusKeyFor(a)).toMatch(/^proja-/)
    expect(corpusKeyFor(b)).toMatch(/^projb-/)
  })

  it('gives the symlinked and canonical forms of ONE corpus the SAME key', () => {
    // Same trap that killed the git fast path in freshness.ts: two spellings of one
    // path would otherwise get two indexes, each permanently half-stale.
    const real = path.join(tmp, 'realproj', 'design')
    fs.mkdirSync(real, { recursive: true })
    const link = path.join(tmp, 'linkproj')
    fs.symlinkSync(path.join(tmp, 'realproj'), link)
    expect(corpusKeyFor(path.join(link, 'design'))).toBe(corpusKeyFor(real))
  })

  it('resolves to a path OUTSIDE the corpus it indexes', () => {
    const corpus = path.join(tmp, 'proj', 'design')
    fs.mkdirSync(corpus, { recursive: true })
    const file = indexPath(path.join(tmp, 'state'), corpusKeyFor(corpus))
    expect(file.startsWith(corpus)).toBe(false)
    expect(file.endsWith('.sqlite')).toBe(true)
  })
})

describe('migrate', () => {
  it('refuses to run backwards', () => {
    const raw = new Database(db1)
    raw.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => migrate(raw)).toThrow(/downgrade/)
    raw.close()
  })

  it('brings a v0 database up to SCHEMA_VERSION and validates it at that version', () => {
    const raw = new Database(db1)
    raw.pragma('busy_timeout = 5000')
    migrate(raw)
    expect((raw.pragma('user_version') as Array<{ user_version: number }>)[0].user_version).toBe(
      SCHEMA_VERSION,
    )
    expect(validate(raw)).toEqual({ ok: true })
    raw.close()
  })
})

describe('v3 — the first migration the REAL shape spec can exercise (TRDD-L55IYKL4)', () => {
  /**
   * Every column in `REQUIRED_TABLES` was `since: 1` until v3, so the column-granular
   * skew this whole guard exists for (janitor#123: `atoms` missing `status`, added at
   * v6, on a DB legitimately still at v5) could only ever be shown with an INJECTED
   * spec — the tests above pass `specWithV2Column`. `records.priority` is the first
   * real `since > 1` column, so these two assertions are about the SHIPPED ladder.
   */
  it('a genuinely v2-shaped index is HEALTHY at v2 and DAMAGED at v3 — against the real spec', () => {
    const db = openIndex(db1)
    // Reproduce the v2 shape exactly: drop the column v3 added, restamp the version.
    db.exec(`ALTER TABLE records DROP COLUMN priority`)
    db.pragma('user_version = 2')

    // No injected spec — this is REQUIRED_TABLES.
    expect(checkShape(db, 2)).toEqual([])
    const faults = checkShape(db, 3)
    expect(faults.length).toBe(1)
    expect(faults[0].detail).toMatch(/priority/)
    db.close()
  })

  it('the v2 index is reported `behind`, NOT damaged — the distinction the ladder exists for', () => {
    const db = openIndex(db1)
    db.exec(`ALTER TABLE records DROP COLUMN priority`)
    db.pragma('user_version = 2')
    const r = validate(db)
    db.close()
    expect(r.ok).toBe(false)
    if (r.ok) return
    // Behind, and ONLY behind: a v2 index missing a v3 column is a migration away
    // from correct. Calling it `shape` here is what nukes a healthy index.
    expect(r.faults.map((f) => f.code)).toEqual(['behind'])
  })

  it('migrating v2 → v3 clears records, edges, FTS and files TOGETHER, leaving no phantoms', () => {
    // THE TRAP: the delta in `freshness.ts` computes `removed` from the INDEXED set,
    // so clearing `files` alone empties `removed` — and rows in records/edges/fts
    // belonging to files DELETED from the corpus while the index sat at v2 would
    // never be evicted, surviving forever as records for cards that no longer exist.
    const db = openIndex(db1)
    db.exec(`ALTER TABLE records DROP COLUMN priority`)
    db.pragma('user_version = 2')
    db.prepare(`INSERT INTO files VALUES ('/stale.md','trdd','tasks','i',0)`).run()
    db.prepare(`INSERT INTO records (kind,id,path,line,col,title) VALUES ('trdd','GONE','/stale.md',NULL,'dev','t')`).run()
    db.prepare(`INSERT INTO edges VALUES ('trdd','GONE','npt','trdd','X','/stale.md')`).run()
    db.prepare(`INSERT INTO records_fts(id,title,body,path) VALUES ('GONE','t','b','/stale.md')`).run()
    db.close()

    const fresh = openIndex(db1)
    const count = (t: string) =>
      (fresh.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    expect(count('files')).toBe(0)
    expect(count('records')).toBe(0)
    expect(count('edges')).toBe(0)
    expect(count('records_fts')).toBe(0)
    expect(validate(fresh)).toEqual({ ok: true })
    fresh.close()
  })
})

describe('validate depth — a SCHEDULE change, not a weakening (TRDD-4VCXRHAY)', () => {
  /**
   * The full pass ran on EVERY open, and two of its checks scan the whole index:
   * `integrity_check` (367 ms at 10 000 cards) and the FTS parity form (304 ms).
   * A graph query over the same corpus costs 11 ms — so the safety mechanism was
   * the scaling wall, and the index was SLOWER than the walk it replaced at every
   * size measured. Splitting the pass by depth made it 3x faster than the walk at
   * 10 000 while keeping every check in existence.
   *
   * These tests pin the two halves of "not a weakening": structural still catches
   * STRUCTURE, and full still catches what only full can see.
   */
  it('STRUCTURAL still catches a missing table — the fault a read path must never miss', () => {
    const db = openIndex(db1)
    db.exec('DROP TABLE edges')
    const r = validateStructural(db)
    db.close()
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.faults.some((f) => f.code === 'shape')).toBe(true)
  })

  it('STRUCTURAL still catches an orphan row, and still refuses a downgraded index', () => {
    const db = openIndex(db1)
    db.prepare(`INSERT INTO records (kind,id,path,line,col,title) VALUES ('trdd','A','/gone.md',NULL,'dev','t')`).run()
    const r = validateStructural(db)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.faults.some((f) => f.code === 'orphan')).toBe(true)

    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    const d = validateStructural(db)
    db.close()
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.faults[0].code).toBe('downgrade')
  })

  /**
   * Populate enough pages that a mid-file byte smash lands in table data rather than
   * the header or the schema page, then corrupt it on disk.
   *
   * THE VECTOR IS `integrity_check`, NOT FTS PARITY, and that is a limitation worth
   * naming: SQLite refuses to let anything write an fts5 shadow table — `PRAGMA
   * writable_schema=ON` and `defensive=OFF` both still answer "table
   * records_fts_content may not be modified" on this build — so index-vs-content
   * divergence cannot be SEEDED from a test. `integrity_check` is the other
   * full-only check and it discriminates the same boundary.
   */
  function corruptOnDisk(file: string): void {
    const db = openIndex(file)
    // ONLY the FTS is populated. `records` and `edges` stay EMPTY on purpose: the
    // structural pass's orphan scan reads those two tables, and reading them touches
    // their data pages — so corrupting them would surface through the cheap pass too
    // (it did, on the first attempt at this test) and discriminate nothing. The FTS
    // pages are read by `integrity_check` and by nothing the cheap pass runs.
    const ins = db.prepare(`INSERT INTO records_fts(id,title,body,path) VALUES (?,?,?,?)`)
    db.transaction(() => {
      for (let i = 0; i < 800; i++) ins.run(`ID${i}`, `t${i}`, `word${i} `.repeat(200), `/f${i}.md`)
    })()
    db.close() // WAL checkpoints on last close, so the pages land in the main file

    const buf = fs.readFileSync(file)
    // Deep into the file, well past page 1 and past anything the empty tables own.
    buf.fill(0x5a, 200_000, 400_000)
    fs.writeFileSync(file, buf)
  }

  it('THE DISCRIMINATOR — an on-disk corruption passes STRUCTURAL and fails FULL', () => {
    // Without this the split would be untestable: every OTHER fault is caught by
    // both depths, so a suite that checked only those would go green even if
    // `depth` were ignored entirely and the two passes were identical.
    corruptOnDisk(db1)

    const db = new Database(db1)
    // Metadata is intact, so the cheap pass has nothing to report — which is the
    // whole claim: it does not look at the pages.
    expect(validateStructural(db)).toEqual({ ok: true })
    const full = validate(db)
    db.close()
    expect(full.ok).toBe(false)
    if (full.ok) return
    expect(full.faults[0].code).toBe('corrupt')
  })

  it('openIndex runs the CHEAP pass by default and the FULL pass when asked', () => {
    corruptOnDisk(db1)
    const ledger = `${db1}.heal.json`

    // Measured by FILE SIZE, not by a row count: querying the damaged table would
    // itself throw, so the assertion has to be about whether the file was REBUILT.
    const damagedSize = fs.statSync(db1).size

    // Default: does not look, so it must NOT heal. The damaged file survives intact.
    openIndex(db1, { ledgerFile: ledger }).close()
    expect(fs.statSync(db1).size).toBe(damagedSize)
    expect(readHealLedger(ledger)).toEqual([])

    // `verify: 'full'` looks, finds it, and rebuilds — with the fault RECORDED, so a
    // corruption that recurs stays visible to whoever asks whether it recurs.
    openIndex(db1, { ledgerFile: ledger, verify: 'full' }).close()
    expect(fs.statSync(db1).size).toBeLessThan(damagedSize)
    expect(readHealLedger(ledger)).toHaveLength(1)
  })
})
