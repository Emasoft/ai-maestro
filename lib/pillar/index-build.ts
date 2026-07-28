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
import { normalizeTrddRef, refList, optionalRef } from '../trdd-graph'
import type { PillarKind } from './kinds'
import { listDocuments, readDocument, recordsOf } from './store'
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
  records: Array<{ id: string; line: number | null; col: string; title: string; body: string }>
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
 * One transaction: an index that is half-updated is worse than one that is stale,
 * because staleness is DETECTABLE (the identities disagree) while a partial write
 * looks exactly like a complete one.
 */
export function syncIndex(db: Database.Database, root: string, kind: PillarKind): SyncStats {
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

  // Parse OUTSIDE the transaction: reading is the slow part and holding the write
  // lock across it would block every other reader for the whole scan.
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
        body: rec.text,
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
  const insRecord = db.prepare(`INSERT INTO records VALUES (?, ?, ?, ?, ?, ?)`)
  const insEdge = db.prepare(`INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?)`)
  const insFts = db.prepare(`INSERT INTO records_fts(id, title, body, path) VALUES (?, ?, ?, ?)`)

  const evict = (path: string): void => {
    // Order matters only for readability; all four are unconditional. Missing any
    // ONE of them leaves a deleted card still answering queries from that table —
    // the FTS row is the easiest to forget and the most visible when it is wrong.
    delRecords.run(path)
    delEdges.run(path)
    delFts.run(path)
    delFiles.run(path)
  }

  const now = Date.now()
  db.transaction(() => {
    for (const path of delta.removed) evict(path)
    for (const row of pending) {
      evict(row.path)
      insFile.run(row.path, kind.name, row.zone, row.identity, now)
      for (const r of row.records) {
        insRecord.run(kind.name, r.id, row.path, r.line, r.col, r.title)
        insFts.run(r.id, r.title, r.body, row.path)
        stats.records++
      }
      for (const e of row.edges) {
        insEdge.run(kind.name, e.srcId, e.field, kind.name, e.dstId, row.path)
        stats.edges++
      }
    }
  })()

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
