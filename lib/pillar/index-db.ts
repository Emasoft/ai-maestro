/**
 * TRDD-L55IYKL4 — the pillar index: schema, migration ladder, and the safety core.
 *
 * This is the "stronger safety mechanisms for the indexer db" the USER asked for,
 * ported from memgrep's hard-won contract — with the two deviations the 10⁵ target
 * forces (see `freshness.ts`) and one addition the reference join forces (edges).
 *
 * THE INDEX IS DERIVED, THEREFORE DISPOSABLE. Every row here is reconstructible from
 * markdown on disk, and that is precisely what earns the right to self-heal by
 * deleting the file. An index is an ACCELERATOR, NEVER AN AUTHORITY: no answer may
 * exist only here, because anything that did would make a rebuild lossy and the
 * self-heal a data-loss bug.
 *
 * THE ONE MISTAKE THIS FILE EXISTS TO NOT REPEAT (janitor#123): a missing column
 * means two different things. If `user_version < SCHEMA_VERSION` the DB is merely
 * BEHIND THE LADDER and the repair is to migrate — rebuilding is destructive and
 * wrong. If `user_version == SCHEMA_VERSION` and the column is still missing, a
 * migration LIED and the DB is genuinely damaged. Reporting the first as damage is
 * how a healthy index gets nuked; every shape check below is therefore PAIRED with
 * the version stamp before it is allowed to name anything damage.
 */
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import Database from 'better-sqlite3'

/**
 * A SHIPPED version is IMMUTABLE. Adding a column always takes a NEW number and a
 * new ladder step — editing an existing step means two machines that both report
 * the same `user_version` disagree about their shape, which no validate can detect.
 */
export const SCHEMA_VERSION = 3

export type IndexFaultCode =
  /** DB newer than this binary. The repair is the OPPOSITE one: upgrade the code. */
  | 'downgrade'
  /** SQLite says the file is corrupt. */
  | 'corrupt'
  /** Shape is wrong AND the version stamp says it should not be. */
  | 'shape'
  /** FTS content disagrees with its index. */
  | 'fts-parity'
  /** Rows referencing a file that is no longer in `files`. */
  | 'orphan'
  /** Behind the ladder — NOT damage. Migrate, do not rebuild. */
  | 'behind'

export interface IndexFault {
  code: IndexFaultCode
  detail: string
}

export type ValidateResult = { ok: true } | { ok: false; faults: IndexFault[] }

// ── schema ───────────────────────────────────────────────────────────────────

interface Migration {
  to: number
  name: string
  run: (db: Database.Database) => void
}

/**
 * APPEND-ONLY. Never edit a step that has shipped; add the next number instead.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    to: 1,
    name: 'initial: files, records, edges, fts',
    run: (db) => {
      db.exec(`
        CREATE TABLE files (
          path       TEXT PRIMARY KEY,
          kind       TEXT NOT NULL,
          zone       TEXT NOT NULL,
          identity   TEXT NOT NULL,
          indexed_at INTEGER NOT NULL
        );

        -- A record is what a document YIELDS: one for a TRDD, N for a PRRD/SPEC.
        -- The primary key includes path on purpose. A duplicate id across two files
        -- is a LINT FINDING the corpus must be able to report, so the schema must
        -- store it rather than reject it — a constraint violation here would make
        -- the index refuse to describe a corpus the linter exists to describe.
        CREATE TABLE records (
          kind  TEXT NOT NULL,
          id    TEXT NOT NULL,
          path  TEXT NOT NULL,
          line  INTEGER,
          col   TEXT,
          title TEXT,
          PRIMARY KEY (kind, id, path)
        );
        CREATE INDEX records_by_id ON records(kind, id);
        CREATE INDEX records_by_path ON records(path);

        -- THE REASON THIS INDEX EXISTS AT ALL (TRDD-CTEQX0ZA F1). Validating a
        -- corpus is a JOIN, not a scan: every blocked-by / npt / eht / parent-trdd /
        -- superseded-by must resolve. Storing documents alone would leave that cost
        -- untouched — O(N x refs x lookup), and with an uncached lookup, quadratic.
        -- Pre-resolved edges turn it into one indexed join.
        CREATE TABLE edges (
          src_kind TEXT NOT NULL,
          src_id   TEXT NOT NULL,
          field    TEXT NOT NULL,
          dst_kind TEXT NOT NULL,
          dst_id   TEXT NOT NULL,
          path     TEXT NOT NULL
        );
        CREATE INDEX edges_by_src ON edges(src_kind, src_id);
        CREATE INDEX edges_by_dst ON edges(dst_kind, dst_id);
        CREATE INDEX edges_by_path ON edges(path);

        CREATE VIRTUAL TABLE records_fts USING fts5(id, title, body);
      `)
    },
  },
  {
    to: 2,
    name: 'records_fts carries path UNINDEXED so a changed file can be evicted',
    run: (db) => {
      // v1's FTS had no way to say "drop the rows belonging to this file", so an
      // incremental sync could delete a record and leave its text searchable
      // forever — a deleted card still answering queries. UNINDEXED keeps `path`
      // out of the match vocabulary while making it a usable DELETE predicate.
      db.exec(`
        DROP TABLE IF EXISTS records_fts;
        CREATE VIRTUAL TABLE records_fts USING fts5(id, title, body, path UNINDEXED);
        DELETE FROM files;
      `)
      // Dropping the FTS discards derived content, so the FRESHNESS record must go
      // with it. Leaving `files` populated would make the next sync see no delta and
      // never repopulate the index it just emptied — a migration that silently
      // installs permanent staleness, which is worse than the gap it closed.
    },
  },
  {
    to: 3,
    name: 'records carries priority, so the board can sort without reading the corpus',
    run: (db) => {
      // ALTER, not DROP+CREATE: `records_by_id` and `records_by_path` hang off this
      // table, and recreating it would silently take both indexes with it — turning
      // the join this whole file exists for back into a scan, with nothing failing.
      //
      // Then clear ALL FOUR TABLES TOGETHER. Clearing `files` alone is the trap: the
      // delta in `freshness.ts` computes `removed` from the INDEXED set, so an empty
      // `files` means an empty `removed`, and every live file re-enters as `added`
      // (evict+reinsert — correct). But rows in records/edges/records_fts belonging
      // to files DELETED from the corpus while the index sat at v2 are never evicted
      // and survive forever as phantom records answering queries for cards that no
      // longer exist. v2's own comment warns about the mirror image of this; same
      // class, one level down.
      db.exec(`
        ALTER TABLE records ADD COLUMN priority TEXT;
        DELETE FROM records;
        DELETE FROM edges;
        DELETE FROM records_fts;
        DELETE FROM files;
      `)
    },
  },
]

export interface ColumnSpec {
  name: string
  /** Ladder version that introduced this COLUMN. */
  since: number
}
export interface TableSpec {
  name: string
  /** Ladder version that introduced this TABLE. */
  since: number
  cols: readonly ColumnSpec[]
}

const at = (since: number, ...names: string[]): ColumnSpec[] => names.map((name) => ({ name, since }))

/**
 * The shape every version is required to have — versioned PER COLUMN, not per table.
 *
 * Per-column is not pedantry: janitor#123's actual bug was a column-granular skew
 * (`atoms` missing `status`, added in v6, on a DB still at v5). A per-TABLE `since`
 * cannot express that at all — the table exists, so the check would demand every
 * column of the newest version from a DB that legitimately predates them, and report
 * a healthy behind-DB as damaged. That is the exact bug, one level down.
 */
export const REQUIRED_TABLES: readonly TableSpec[] = [
  { name: 'files', since: 1, cols: at(1, 'path', 'kind', 'zone', 'identity', 'indexed_at') },
  {
    name: 'records',
    since: 1,
    cols: [...at(1, 'kind', 'id', 'path', 'line', 'col', 'title'), { name: 'priority', since: 3 }],
  },
  { name: 'edges', since: 1, cols: at(1, 'src_kind', 'src_id', 'field', 'dst_kind', 'dst_id', 'path') },
]

/**
 * Shape faults ONLY — never a verdict about the version stamp.
 *
 * Anything introduced AFTER `ver` is legitimately absent and is skipped, so whatever
 * this returns is real damage even on a behind DB. Keeping "damaged" and "behind"
 * orthogonal is what the earlier ternary got wrong: it made them alternatives, when
 * a DB can be behind without damage (the common case), damaged without being behind,
 * or both.
 *
 * The spec stays injectable for the tests that need a shape this corpus does not
 * have — but as of v3 the REAL spec exercises this too: `records.priority` is the
 * first column with `since > 1`, so "a genuine v2 index is healthy, and the same
 * index at v3 without that column is damaged" is now a statement about the shipped
 * ladder rather than about a synthetic fixture. Until v3 there was no such column,
 * and a guard exercised only by an injected spec is a guard for a bug we already
 * shipped once, verified against something other than the thing that shipped.
 */
export function checkShape(
  db: Database.Database,
  ver: number,
  tables: readonly TableSpec[] = REQUIRED_TABLES,
): IndexFault[] {
  const faults: IndexFault[] = []
  for (const t of tables) {
    if (t.since > ver) continue
    const cols = tableColumns(db, t.name)
    if (!cols) {
      faults.push({
        code: 'shape',
        detail: `table ${t.name} (introduced at v${t.since}) is missing from a v${ver} index`,
      })
      continue
    }
    const missing = t.cols.filter((c) => c.since <= ver && !cols.includes(c.name))
    if (missing.length) {
      faults.push({
        code: 'shape',
        detail: `table ${t.name} is missing column(s) ${missing.map((c) => c.name).join(', ')} introduced at or before v${ver}`,
      })
    }
  }
  return faults
}

/** Column-granular for the same reason as REQUIRED_TABLES: `path` arrived at v2. */
const FTS_COLUMNS: readonly ColumnSpec[] = [
  { name: 'id', since: 1 },
  { name: 'title', since: 1 },
  { name: 'body', since: 1 },
  { name: 'path', since: 2 },
]

// ── open ─────────────────────────────────────────────────────────────────────

export function indexPath(stateDir: string, corpusKey: string): string {
  return path.join(stateDir, `${corpusKey}.sqlite`)
}

/**
 * Where THIS host keeps the index for a given corpus.
 *
 * Outside the corpus, always. The index is derived, gitignored server state; writing
 * it under `design/` would put a binary that self-heals by deleting itself inside the
 * git-tracked tree it indexes — and `greptrdd validate` would then lint its own cache.
 * Precedent: `lib/kanban-index.ts` writes to `statePath('kanban-index', …)`.
 *
 * The key is a readable slug PLUS a hash of the resolved path, because slugs collide
 * where it matters most: every agent workdir and every LOCAL corpus is called
 * `design`, so a slug alone would silently make N corpora share one index. The path
 * is realpath-resolved first so the symlinked and canonical forms of one corpus do
 * not get two indexes (the same trap that killed the git fast path in freshness.ts).
 */
export function corpusKeyFor(corpusRoot: string): string {
  const abs = path.resolve(corpusRoot)
  let real = abs
  try {
    real = fs.realpathSync(abs)
  } catch {
    // Not yet on disk — the caller will fail on its own terms; keying off the
    // unresolved path is still deterministic.
  }
  const slug =
    path
      .basename(path.dirname(real))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'corpus'
  const hash = createHash('sha256').update(real).digest('hex').slice(0, 12)
  return `${slug}-${hash}`
}

function applyPragmas(db: Database.Database): void {
  // busy_timeout FIRST: without it `journal_mode = WAL` silently fails to take when
  // another process holds the lock, and the DB quietly stays in rollback-journal
  // mode — the setting looks applied and is not.
  db.pragma('busy_timeout = 5000')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
}

function currentVersion(db: Database.Database): number {
  const rows = db.pragma('user_version') as Array<{ user_version: number }>
  return rows[0]?.user_version ?? 0
}

/**
 * Run the ladder from whatever version the DB is at, up to SCHEMA_VERSION.
 *
 * Each step is its own transaction, the stamp is written INSIDE that transaction,
 * and the result is re-validated AT THAT VERSION before commit. A step that half-
 * applies and still stamps is precisely the state that makes `validate` report
 * "damage" on a DB nothing damaged — so the stamp and the shape must land or fail
 * together.
 */
export function migrate(db: Database.Database): void {
  const from = currentVersion(db)
  if (from > SCHEMA_VERSION) {
    throw new IndexFaultError({
      code: 'downgrade',
      detail: `index is at user_version ${from} but this binary knows ${SCHEMA_VERSION} — upgrade the code; do NOT rebuild, a newer index is not a broken one`,
    })
  }
  for (const m of MIGRATIONS.filter((x) => x.to > from)) {
    const tx = db.transaction(() => {
      m.run(db)
      // `pragma` is not parameterizable; `m.to` comes from the literal ladder above,
      // never from input.
      db.pragma(`user_version = ${m.to}`)
      const v = validateAt(db, m.to)
      if (!v.ok) {
        throw new Error(
          `migration ${m.to} (${m.name}) left the index invalid: ${v.faults.map((f) => `${f.code}: ${f.detail}`).join('; ')}`,
        )
      }
    })
    try {
      // BEGIN IMMEDIATE, not the default deferred BEGIN: take the write lock up
      // front rather than discovering the conflict halfway through a schema change,
      // when the partial work has to be unwound under contention.
      tx.immediate()
    } catch (err) {
      throw new Error(`pillar index migration to v${m.to} failed: ${(err as Error).message}`)
    }
  }
}

export class IndexFaultError extends Error {
  readonly fault: IndexFault
  constructor(fault: IndexFault) {
    super(`${fault.code}: ${fault.detail}`)
    this.name = 'IndexFaultError'
    this.fault = fault
  }
}

// ── validate ─────────────────────────────────────────────────────────────────

function tableColumns(db: Database.Database, table: string): string[] | null {
  const rows = db.pragma(`table_info(${table})`) as Array<{ name: string }>
  return rows.length ? rows.map((r) => r.name) : null
}

/**
 * Validate the index AS IF it were at `expectVersion`, cheapest check first.
 *
 * NON-HEALING BY CONSTRUCTION. An observer must not repair what it measures: a
 * validate that silently fixed things would make a recurring corruption invisible
 * to the very tool asking whether corruption recurs.
 */
export function validateAt(db: Database.Database, expectVersion: number): ValidateResult {
  const faults: IndexFault[] = []
  const ver = currentVersion(db)

  // 1. Downgrade — cheapest, and the one whose repair is the opposite of every other.
  if (ver > expectVersion) {
    return {
      ok: false,
      faults: [{ code: 'downgrade', detail: `user_version ${ver} > expected ${expectVersion}` }],
    }
  }

  // 2. Integrity — if SQLite says the file is corrupt, nothing below is meaningful.
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>
  if (integrity[0]?.integrity_check !== 'ok') {
    return {
      ok: false,
      faults: [{ code: 'corrupt', detail: integrity.map((r) => r.integrity_check).join('; ') }],
    }
  }

  // 3. Shape — DAMAGE ONLY. Everything introduced after `ver` is skipped, so a fault
  //    here is real damage even on a behind DB, and behind-ness is judged separately
  //    in step 4. Making the two ORTHOGONAL is the janitor#123 fix: as alternatives
  //    they cannot express "behind AND damaged", and the cheap reading — treat a
  //    missing column as damage — deletes a healthy index.
  const shape = checkShape(db, ver)
  if (shape.length) return { ok: false, faults: shape }

  // 4. Behind the ladder. NOT damage: the repair is to migrate, never to rebuild.
  if (ver < expectVersion) {
    return {
      ok: false,
      faults: [
        {
          code: 'behind',
          detail: `user_version ${ver} < ${expectVersion} — migrate; this is NOT damage`,
        },
      ],
    }
  }

  // 5. FTS column set, then 6. FTS content parity.
  const ftsCols = tableColumns(db, 'records_fts')
  if (!ftsCols) {
    return { ok: false, faults: [{ code: 'shape', detail: 'records_fts is missing' }] }
  }
  const ftsMissing = FTS_COLUMNS.filter((c) => c.since <= ver && !ftsCols.includes(c.name))
  if (ftsMissing.length) {
    return {
      ok: false,
      faults: [
        {
          code: 'shape',
          detail: `records_fts missing column(s) ${ftsMissing.map((c) => c.name).join(', ')}`,
        },
      ],
    }
  }
  try {
    // The PARITY form. The bare `('integrity-check')` passes on an emptied index —
    // it verifies the b-tree, not that the index agrees with the content — so it
    // would certify exactly the corruption worth catching.
    db.prepare(`INSERT INTO records_fts(records_fts, rank) VALUES ('integrity-check', 1)`).run()
  } catch (err) {
    return { ok: false, faults: [{ code: 'fts-parity', detail: (err as Error).message }] }
  }

  // 7. Orphans — rows pointing at a file no longer indexed. Last because it is the
  //    only check that scans rows rather than metadata.
  for (const t of ['records', 'edges'] as const) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE path NOT IN (SELECT path FROM files)`)
      .get() as { n: number }
    if (row.n > 0) {
      faults.push({ code: 'orphan', detail: `${row.n} row(s) in ${t} reference an unindexed file` })
    }
  }

  // The stamp needs no check of its own here: `ver > expectVersion` returned at
  // step 1 and `ver < expectVersion` at step 4, so by this line they are equal.
  return faults.length ? { ok: false, faults } : { ok: true }
}

export function validate(db: Database.Database): ValidateResult {
  return validateAt(db, SCHEMA_VERSION)
}

// ── heal ledger ──────────────────────────────────────────────────────────────

export interface HealEvent {
  at: string
  reason: string
  faults: string[]
}

const HEAL_LEDGER_MAX = 50

/**
 * Append a heal event, bounded and atomically rewritten.
 *
 * A self-heal that leaves no trace is worse than no self-heal: it RACES THE OBSERVER
 * AND WINS, so a corruption that recurs daily looks like a healthy index to anything
 * that inspects only current state. The ledger is what makes "it healed again" a
 * fact somebody can find.
 */
export function recordHeal(ledgerFile: string, ev: HealEvent, max = HEAL_LEDGER_MAX): void {
  let events: HealEvent[] = []
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'))
    if (Array.isArray(parsed)) events = parsed as HealEvent[]
  } catch {
    // Absent or unreadable ledger — a heal must never fail because its own audit
    // trail could not be read. Start a fresh one and keep going.
  }
  events.push(ev)
  if (events.length > max) events = events.slice(events.length - max)
  const tmp = `${ledgerFile}.tmp`
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(events, null, 2))
  fs.renameSync(tmp, ledgerFile)
}

export function readHealLedger(ledgerFile: string): HealEvent[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'))
    return Array.isArray(parsed) ? (parsed as HealEvent[]) : []
  } catch {
    return []
  }
}

// ── open + self-heal ─────────────────────────────────────────────────────────

export interface OpenOptions {
  /** Never delete; throw instead. The observer path. */
  readonly noHeal?: boolean
  /** Where heal events are appended. Defaults to `<db>.heal.json`. */
  readonly ledgerFile?: string
  /** Injectable for tests. Defaults to `new Date().toISOString()`. */
  readonly now?: () => string
}

function nuke(file: string): void {
  // -wal and -shm carry committed pages. Deleting only the main file leaves SQLite
  // to reconstruct from a WAL belonging to a database that no longer exists.
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      fs.rmSync(f, { force: true })
    } catch {
      /* a file that is already gone is the desired state */
    }
  }
}

/**
 * Open the index, migrating and — unless `noHeal` — rebuilding on damage.
 *
 * The self-heal deletes and recreates. That is only defensible because every row is
 * DERIVED from markdown on disk; it would be a data-loss bug in a store that owned
 * anything. A `downgrade` fault is deliberately NOT healed: a DB newer than the
 * binary is not damaged, and deleting it would destroy a good index to satisfy old
 * code.
 */
export function openIndex(file: string, opts: OpenOptions = {}): Database.Database {
  const ledger = opts.ledgerFile ?? `${file}.heal.json`
  const now = opts.now ?? (() => new Date().toISOString())
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const attempt = (): { db: Database.Database; result: ValidateResult } => {
    const db = new Database(file)
    applyPragmas(db)
    migrate(db)
    return { db, result: validate(db) }
  }

  let db: Database.Database
  let result: ValidateResult
  try {
    ;({ db, result } = attempt())
  } catch (err) {
    if (err instanceof IndexFaultError && err.fault.code === 'downgrade') throw err
    if (opts.noHeal) throw err
    recordHeal(ledger, { at: now(), reason: 'open failed', faults: [(err as Error).message] })
    nuke(file)
    ;({ db, result } = attempt())
    return db
  }

  if (result.ok) return db

  const downgrade = result.faults.find((f) => f.code === 'downgrade')
  if (downgrade) {
    db.close()
    throw new IndexFaultError(downgrade)
  }
  if (opts.noHeal) {
    db.close()
    throw new IndexFaultError(result.faults[0])
  }

  db.close()
  recordHeal(ledger, {
    at: now(),
    reason: 'validate failed on open',
    faults: result.faults.map((f) => `${f.code}: ${f.detail}`),
  })
  nuke(file)
  const fresh = attempt()
  if (!fresh.result.ok) {
    fresh.db.close()
    throw new IndexFaultError(fresh.result.faults[0])
  }
  return fresh.db
}
