/**
 * TRDD-L55IYKL4 — serve the TRDD dependency graph from the index instead of the walk.
 *
 * THIS IS THE INDEX'S FIRST PRODUCTION CONSUMER. Everything under `lib/pillar/` was
 * built, tested and specified with zero non-test callers; a store nothing reads is a
 * store whose answers nobody has ever had to agree with, which is why this file's
 * acceptance criterion is a DIFFERENTIAL (`tests/unit/pillar-graph-cli.test.ts`) and
 * not a set of assertions about rows.
 *
 * WHAT THE INDEX BUYS, stated honestly. It does NOT replace a quadratic join — the
 * doctor already resolves references through an O(1) Set over a Map it builds anyway.
 * It removes THE WALK: `why` / `unblocks` / `roots` / `board` need no prose and no
 * frontmatter beyond five scalars, so served from here they skip opening 10^5
 * documents entirely, and `board`'s retained cards stop being ~15 KB apiece.
 *
 * THE ACCRETION LINE, because it is what keeps this from growing without bound: a
 * column enters `records` only when an INDEX-SERVED subcommand reads it. `labels` is
 * deliberately absent — it is scored only by the default regex SEARCH, and search
 * stays on the walk BY DESIGN (fts5 tokenizes `TRDD-BQC8NQSW` into whole tokens and
 * cannot evaluate a regex at all, so "index the search, byte-identically" is not a
 * goal that was dropped, it is a goal that contradicts itself). A field the board
 * starts reading needs a migration, not a widened SELECT.
 */
import { statePath } from '../ecosystem-constants'
import { BLOCKER_FIELDS } from '../trdd-graph'
import { TRDD_KIND, TRDD_ZONES } from './kinds'
import { openIndex, indexPath, corpusKeyFor } from './index-db'
import { syncIndex, danglingRefs, type DanglingRef } from './index-build'

/** Exactly the fields the graph subcommands read. Not a general card. */
export interface GraphCard {
  id: string
  zone: string
  filePath: string
  column: string
  title: string
  priority: string | null
  blockerRefs: string[]
}

interface RecordRow {
  id: string
  zone: string
  path: string
  col: string | null
  title: string | null
  priority: string | null
}

/**
 * ORDER IS PART OF THE ANSWER, so it is part of the query.
 *
 * The walk visits `TRDD_ZONES` in declaration order and each zone's files sorted by
 * name. `TRDD_ZONES` is `proposals, tasks, archived, refused` — NOT alphabetical — so
 * a plain `ORDER BY path` reproduces `archived, proposals, refused, tasks` instead,
 * and every tie-break downstream (which column heads the board, which root leads the
 * critical path, which card appears first in `unblocks`) silently moves. The rank is
 * derived from the tuple rather than typed out, so reordering the zones cannot leave
 * this behind.
 */
const ZONE_RANK_SQL = `CASE f.zone ${TRDD_ZONES.map((_, i) => `WHEN ? THEN ${i}`).join(' ')} ELSE ${TRDD_ZONES.length} END`

export function cardsFromIndex(
  db: ReturnType<typeof openIndex>,
  kindName: string = TRDD_KIND.name,
): GraphCard[] {
  const rows = db
    .prepare(
      `SELECT r.id AS id, f.zone AS zone, r.path AS path, r.col AS col,
              r.title AS title, r.priority AS priority
         FROM records r
         JOIN files f ON f.path = r.path
        WHERE r.kind = ?
        ORDER BY ${ZONE_RANK_SQL}, r.path`,
    )
    .all(kindName, ...TRDD_ZONES) as RecordRow[]

  // `ORDER BY rowid` is what reproduces the ORDER the refs were written in — first
  // every `blocked-by` in its frontmatter-array order, then every `npt`. syncIndex
  // evicts and reinserts a file's edges as one contiguous run, so a card's own edges
  // keep their relative insertion order even after an incremental update reassigns
  // rowids; only the order BETWEEN files drifts, and that is not read here.
  const edgeRows = db
    .prepare(
      `SELECT src_id AS src, dst_id AS dst
         FROM edges
        WHERE src_kind = ? AND field IN (${BLOCKER_FIELDS.map(() => '?').join(', ')})
        ORDER BY rowid`,
    )
    .all(kindName, ...BLOCKER_FIELDS) as Array<{ src: string; dst: string }>

  const refsBySrc = new Map<string, string[]>()
  for (const e of edgeRows) {
    const list = refsBySrc.get(e.src)
    if (list) list.push(e.dst)
    else refsBySrc.set(e.src, [e.dst])
  }

  return rows.map((r) => ({
    id: r.id,
    zone: r.zone,
    filePath: r.path,
    // The SAME reductions the walk applies, over the SAME source value: the store
    // already collapsed a non-string `column`/`title` to '', so trimming here and
    // trimming there cannot disagree.
    column: String(r.col ?? '').trim() || '(none)',
    title: String(r.title ?? '').trim(),
    priority: r.priority,
    // UNFILTERED, exactly like the walk's. A ref to a card that does not exist is
    // dropped later, by the caller's `byId` membership test — dropping it here
    // instead would be a second place where "is this a real blocker?" is decided.
    blockerRefs: refsBySrc.get(r.id) ?? [],
  }))
}

/**
 * Open (migrating and self-healing as needed), bring the index in line with the
 * corpus, and hand back the graph.
 *
 * The sync is not optional and not deferrable: an index that answers from a stale
 * corpus is worse than no index, because the staleness is invisible in the answer.
 * On an unchanged corpus it costs the identity probe and zero document reads.
 *
 * THROWS on any fault — a missing native module, a downgraded index, an unreadable
 * corpus, or `busy` when another process on this host is mid-reindex. The caller
 * decides whether that is fatal or a reason to fall back to the walk; this function
 * never silently degrades, because "the index was skipped" and "the index agreed" must
 * not look the same from the outside. `busy` in particular must reach the WALK and not
 * a stale read: see `syncIndex`.
 */
export function loadTrddGraphViaIndex(designDir: string): GraphCard[] {
  const file = indexPath(statePath('pillar-index'), corpusKeyFor(designDir))
  const db = openIndex(file)
  try {
    syncIndex(db, designDir, TRDD_KIND)
    return cardsFromIndex(db, TRDD_KIND.name)
  } finally {
    db.close()
  }
}

/**
 * Every TRDD reference that resolves to nothing (TRDD-216FTVC9).
 *
 * `dag.ts` checks edge DIRECTION and says so explicitly: *"NOT THIS LINT'S JOB: whether
 * a cited target EXISTS. That is `danglingRefs` in `index-build.ts`."* That delegation
 * was correct and unwired — `danglingRefs` had four test references and ZERO production
 * callers, so nothing checked existence and `pillars-lint`'s "the reference DAG holds"
 * was true about direction alone. This is the missing call site; the query itself is
 * unchanged.
 *
 * Deliberately a SIBLING of `loadTrddGraphViaIndex` rather than a widening of it: the
 * open/sync/close dance is identical and already proven, and the two callers want
 * different rows. Same THROWS contract for the same reason — a fault must not read as
 * "no dangling references", because a lint that cannot run and a lint that found
 * nothing must never look the same. The caller maps the throw to could-not-run.
 *
 * TRDD-ONLY, and that is a real limit rather than an oversight: a SPEC citing a
 * nonexistent TRDD would also be dangling, but `spec` carries no dependency fields
 * today (see `dag.ts` — SPECS→TRDD is structurally unexpressible), so there is no
 * second corpus to join yet.
 */
export function danglingTrddRefs(designDir: string): DanglingRef[] {
  const file = indexPath(statePath('pillar-index'), corpusKeyFor(designDir))
  const db = openIndex(file)
  try {
    syncIndex(db, designDir, TRDD_KIND)
    return danglingRefs(db, TRDD_KIND.name)
  } finally {
    db.close()
  }
}
