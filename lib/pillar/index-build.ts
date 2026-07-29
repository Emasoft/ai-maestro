/**
 * TRDD-L55IYKL4 — populate the pillar index, incrementally.
 *
 * The measured constraint (TRDD-CTEQX0ZA): a full walk of 10⁵ documents costs ~6.5 GB
 * and crashes before it finishes, so "rebuild everything" is not a fallback here — it
 * is the outage. `syncIndex` therefore re-reads only the files whose identity moved,
 * and a corpus where nothing changed costs two git calls and zero document reads.
 *
 * EDGES ARE DERIVED WITH THE GRAPH'S OWN HELPERS (`refList` / `optionalRef` /
 * `normalizeTrddRef` from `lib/trdd-graph.ts`), never with a private notion of "what
 * counts as a reference". The index exists to answer the graph's question faster; a
 * reader with its own join key would return confidently different answers, which is
 * strictly worse than having no index at all.
 */
import type Database from 'better-sqlite3'
import { normalizeTrddRef, refList, optionalRef, normalizePriority } from '../trdd-graph'
import type { PillarKind } from './kinds'
import { listDocuments, readDocument, recordsOf } from './store'
import { IndexFaultError, isBusyError } from './index-db'
import { identifyFiles, diffIdentities, type FileIdentity } from './freshness'

/** The frontmatter fields that ARE the TRDD dependency graph. */
const LIST_EDGE_FIELDS = ['blocked-by', 'npt', 'eht', 'superseded-by'] as const
const SCALAR_EDGE_FIELDS = ['parent-trdd'] as const

export interface SyncStats {
  scanned: number
  added: number
  changed: number
  removed: number
  records: number
  edges: number
}

interface PendingRow {
  path: string
  zone: string
  identity: string
  records: Array<{
    id: string
    line: number | null
    col: string
    title: string
    priority: string | null
  }>
  edges: Array<{ srcId: string; field: string; dstId: string }>
}

function edgesFor(recordId: string, fm: Record<string, unknown>): PendingRow['edges'] {
  const out: PendingRow['edges'] = []
  for (const field of LIST_EDGE_FIELDS) {
    for (const dst of refList(fm[field])) out.push({ srcId: recordId, field, dstId: dst })
  }
  for (const field of SCALAR_EDGE_FIELDS) {
    const dst = optionalRef(fm[field])
    if (dst) out.push({ srcId: recordId, field, dstId: dst })
  }
  return out
}

/**
 * Bring the index in line with the corpus, touching only what moved.
 *
 * ONE transaction: an index that is half-updated is worse than one that is stale,
 * because staleness is DETECTABLE (the identities disagree) while a partial write
 * looks exactly like a complete one.
 *
 * IMMEDIATE, and it SPANS THE CORPUS READ — which is what makes N agents on one host
 * safe (TRDD-YN8EQWYP). Three things follow from that one choice:
 *
 *  1. **The wait happens at BEGIN, where `busy_timeout` actually applies.** A deferred
 *     BEGIN that reads before it writes can fail with `SQLITE_BUSY_SNAPSHOT`, which
 *     `busy_timeout` does NOT retry — so the old shape was safe only by the accident
 *     that no SELECT preceded its first DELETE, and the first `SELECT` anyone added
 *     inside it would have reintroduced an unretryable failure silently.
 *  2. **The delta is computed under the lock, so a second writer that gets in sees the
 *     first's COMMITTED state** — an empty delta, zero parses, zero redundant writes.
 *     Reading `files` outside the lock instead had both writers derive the same delta
 *     from the same pre-state and both do the whole job.
 *  3. **SQLite's own write lock IS the build lock**, so there is no lockfile, no stale-
 *     lock heuristic, and no orphaned lock after a crash: the OS releases it when the
 *     process dies. `lib/server-lockfile.ts` was the alternative and is the wrong tool
 *     here — it is async (this path is synchronous throughout) and it needs a staleness
 *     guess, which is a whole class of bug the DB lock does not have.
 *
 * THE PREVIOUS RATIONALE FOR THE OPPOSITE CHOICE WAS FACTUALLY WRONG, which is why it
 * is recorded rather than quietly replaced: it said holding the lock across the parse
 * "would block every other reader for the whole scan". In WAL mode — which
 * `applyPragmas` sets two files over — a writer does not block readers at all. It
 * blocks other WRITERS, which is precisely the intent.
 *
 * On timeout the caller gets `busy` and must answer from the WALK. It must NEVER answer
 * from the un-synced index: staleness that nothing reports is the one failure this
 * whole subsystem is built to avoid, and `busy` is contention, never damage — see
 * NEVER_HEALED in `index-db.ts` for what used to happen instead.
 */
export function syncIndex(db: Database.Database, root: string, kind: PillarKind): SyncStats {
  const run = db.transaction((): SyncStats => syncWithin(db, root, kind))
  try {
    return run.immediate()
  } catch (err) {
    if (isBusyError(err)) {
      throw new IndexFaultError({
        code: 'busy',
        detail:
          'another process is indexing this corpus and its write lock did not free within busy_timeout — answer from the corpus walk; this is contention, NOT damage',
      })
    }
    throw err
  }
}

function syncWithin(db: Database.Database, root: string, kind: PillarKind): SyncStats {
  const files = kind.zones.flatMap((zone) =>
    listDocuments(root, kind, zone).map((path) => ({ path, zone })),
  )
  const zoneOf = new Map(files.map((f) => [f.path, f.zone]))
  const live: Map<string, FileIdentity> = identifyFiles(
    files.map((f) => f.path),
    root,
  )

  const indexed = new Map<string, string>()
  for (const row of db.prepare(`SELECT path, identity FROM files WHERE kind = ?`).all(kind.name) as Array<{
    path: string
    identity: string
  }>) {
    indexed.set(row.path, row.identity)
  }

  const delta = diffIdentities(indexed, live)
  const toRead = [...delta.added, ...delta.changed]

  // Parse INSIDE the transaction, deliberately — see `syncIndex` for why, and for the
  // wrong reason this used to sit outside it.
  const pending: PendingRow[] = []
  for (const path of toRead) {
    const zone = zoneOf.get(path) ?? ''
    const doc = readDocument(path, kind, zone)
    if (!doc) continue // vanished mid-pass; the next sync will see it as removed
    const row: PendingRow = {
      path,
      zone,
      identity: live.get(path)!.id,
      records: [],
      edges: [],
    }
    for (const rec of recordsOf(doc, kind)) {
      const id = kind.name === 'trdd' ? normalizeTrddRef(rec.id) : kind.normalizeId(rec.id)
      row.records.push({
        id,
        line: rec.line,
        col: typeof doc.frontmatter.column === 'string' ? doc.frontmatter.column : '',
        title: typeof doc.frontmatter.title === 'string' ? doc.frontmatter.title : '',
        // Through the graph's own normalizer, for the same reason the edges are:
        // the board reads this back out and compares it to what the WALK produced,
        // so a second stringification rule here would be a silent disagreement.
        priority: normalizePriority(doc.frontmatter.priority),
      })
      if (kind.name === 'trdd') row.edges.push(...edgesFor(id, doc.frontmatter))
    }
    pending.push(row)
  }

  const stats: SyncStats = {
    scanned: files.length,
    added: delta.added.length,
    changed: delta.changed.length,
    removed: delta.removed.length,
    records: 0,
    edges: 0,
  }

  const delFiles = db.prepare(`DELETE FROM files WHERE path = ?`)
  const delRecords = db.prepare(`DELETE FROM records WHERE path = ?`)
  const delEdges = db.prepare(`DELETE FROM edges WHERE path = ?`)
  const delFts = db.prepare(`DELETE FROM records_fts WHERE path = ?`)
  const insFile = db.prepare(`INSERT INTO files VALUES (?, ?, ?, ?, ?)`)
  // POSITIONAL, so the placeholder count is COUPLED to the column count: v3 added
  // `priority` and a 6-placeholder INSERT would make SQLite reject every row with
  // "table records has 7 columns but 6 values were supplied". That fails loudly,
  // which is the good case — but it fails on every sync, so the INSERT and the
  // migration have to land in the same change.
  const insRecord = db.prepare(`INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const insEdge = db.prepare(`INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?)`)
  // NO insFts. `records_fts` IS NO LONGER POPULATED — see TRDD-7CHUK1AZ. The table,
  // its migrations and its shape check all stay, so restoring it is exactly this one
  // statement plus `body` back on PendingRow. What is gone is the WRITE, not the
  // capability.
  //
  // WHY. The FTS had exactly one intended consumer — recall/search — and search takes
  // a REGEX (`scripts/greptrdd.mjs`, `new RegExp(cmd, 'i')`), which FTS5 structurally
  // cannot serve; the graph subcommands were index-backed instead and search was
  // ratified walk-only. So it was not a table awaiting a consumer, it was a table
  // mis-designed for the consumer it had — while `body` was the ONLY large field on
  // the retained `pending` array, making it the whole memory wall. Measured at 10^5:
  // peak RSS 2.36 GB and the build KILLED at 1h32m with the WAL rate still decaying,
  // i.e. no bounded finish. Cost: a build that never completes. Benefit: nothing read.

  const evict = (path: string): void => {
    // Order matters only for readability; all four are unconditional. Missing any
    // ONE of them leaves a deleted card still answering queries from that table.
    delRecords.run(path)
    delEdges.run(path)
    // Retained deliberately even though nothing inserts any more: an index built
    // BEFORE this change still holds FTS rows, and this drains them as files change.
    // Dropping it would strand those rows forever in every existing index.
    delFts.run(path)
    delFiles.run(path)
  }

  // No transaction here: `syncIndex` already holds one, IMMEDIATE, spanning this whole
  // function. A second one would add only a redundant SAVEPOINT — and having it here
  // was what made the enclosing scope look transaction-free.
  const now = Date.now()
  for (const path of delta.removed) evict(path)
  for (const row of pending) {
    evict(row.path)
    insFile.run(row.path, kind.name, row.zone, row.identity, now)
    for (const r of row.records) {
      insRecord.run(kind.name, r.id, row.path, r.line, r.col, r.title, r.priority)
      stats.records++
    }
    for (const e of row.edges) {
      insEdge.run(kind.name, e.srcId, e.field, kind.name, e.dstId, row.path)
      stats.edges++
    }
  }

  return stats
}

export interface DanglingRef {
  srcId: string
  field: string
  dstId: string
  path: string
}

/**
 * Every reference that resolves to nothing — ONE indexed join.
 *
 * This is the query the whole index exists for. Done against the live corpus through
 * the store's public API it is O(N) per reference and therefore O(N² × refs); here it
 * is a join over two indexed columns.
 */
export function danglingRefs(db: Database.Database, kindName: string): DanglingRef[] {
  return db
    .prepare(
      `SELECT e.src_id AS srcId, e.field AS field, e.dst_id AS dstId, e.path AS path
         FROM edges e
         LEFT JOIN records r ON r.kind = e.dst_kind AND r.id = e.dst_id
        WHERE e.src_kind = ? AND r.id IS NULL
        ORDER BY e.src_id, e.field, e.dst_id`,
    )
    .all(kindName) as DanglingRef[]
}
