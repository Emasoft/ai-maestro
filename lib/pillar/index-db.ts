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
import Database from 'better-sqlite3'

/**
 * A SHIPPED version is IMMUTABLE. Adding a column always takes a NEW number and a
 * new ladder step — editing an existing step means two machines that both report
 * the same `user_version` disagree about their shape, which no validate can detect.
 */
export const SCHEMA_VERSION = 1

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
]

/** Tables every shipped version must have, with the version that introduced them. */
const REQUIRED_TABLES: ReadonlyArray<{ name: string; since: number; cols: readonly string[] }> = [
  { name: 'files', since: 1, cols: ['path', 'kind', 'zone', 'identity', 'indexed_at'] },
  { name: 'records', since: 1, cols: ['kind', 'id', 'path', 'line', 'col', 'title'] },
  { name: 'edges', since: 1, cols: ['src_kind', 'src_id', 'field', 'dst_kind', 'dst_id', 'path'] },
]

const FTS_COLUMNS: readonly string[] = ['id', 'title', 'body']

// ── open ─────────────────────────────────────────────────────────────────────

export function indexPath(stateDir: string, corpusKey: string): string {
  return path.join(stateDir, `${corpusKey}.sqlite`)
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

  // 3. Shape — PAIRED with the version stamp. This is janitor#123's bug: a missing
  //    column on a BEHIND DB is not damage, it is a pending migration, and calling
  //    it damage is how a healthy index gets nuked.
  for (const t of REQUIRED_TABLES) {
    if (t.since > ver) continue
    const cols = tableColumns(db, t.name)
    if (!cols) {
      faults.push({
        code: ver < expectVersion ? 'behind' : 'shape',
        detail: `table ${t.name} is missing (user_version ${ver}, expected ${expectVersion})`,
      })
      continue
    }
    const missing = t.cols.filter((c) => !cols.includes(c))
    if (missing.length) {
      faults.push({
        code: ver < expectVersion ? 'behind' : 'shape',
        detail: `table ${t.name} is missing column(s) ${missing.join(', ')} (user_version ${ver}, expected ${expectVersion})`,
      })
    }
  }
  if (ver < expectVersion && faults.length === 0) {
    faults.push({ code: 'behind', detail: `user_version ${ver} < ${expectVersion} — migrate` })
  }
  if (faults.length) return { ok: false, faults }

  // 4. FTS column set, then 5. FTS content parity.
  const ftsCols = tableColumns(db, 'records_fts')
  if (!ftsCols) {
    return { ok: false, faults: [{ code: 'shape', detail: 'records_fts is missing' }] }
  }
  const ftsMissing = FTS_COLUMNS.filter((c) => !ftsCols.includes(c))
  if (ftsMissing.length) {
    return {
      ok: false,
      faults: [{ code: 'shape', detail: `records_fts missing column(s) ${ftsMissing.join(', ')}` }],
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

  // 6. Orphans — rows pointing at a file no longer indexed.
  for (const t of ['records', 'edges'] as const) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE path NOT IN (SELECT path FROM files)`)
      .get() as { n: number }
    if (row.n > 0) {
      faults.push({ code: 'orphan', detail: `${row.n} row(s) in ${t} reference an unindexed file` })
    }
  }

  // 7. The version stamp itself, last — by here everything else agrees with it.
  if (ver !== expectVersion) {
    faults.push({ code: 'behind', detail: `user_version ${ver} != ${expectVersion}` })
  }

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
