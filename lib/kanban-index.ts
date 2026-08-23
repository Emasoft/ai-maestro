/**
 * The kanban index buffer — a CACHE over the TRDD corpus, never a board.
 *
 * The DEP overlay `aimaestro-kanban-multiagent.md` is explicit: the TRDDs ARE the
 * kanban. A card *is* a TRDD; its position *is* that TRDD's `column:` and its owner
 * *is* that TRDD's `assignee:`. Nothing else records either fact, so nothing else
 * can disagree about it. Rescanning every agent's `design/` tree on every question
 * is expensive, so this index exists — and the discipline that keeps a cache from
 * quietly becoming a second source of truth is encoded in the API, not in a comment:
 *
 *   - REGENERABLE. Delete the file and nothing is lost. `readKanbanIndex` returns
 *     null on any failure — a cache miss is not an error.
 *   - NEVER AUTHORED. There is no mutation function here, and there will not be
 *     one. To move a card you edit the TRDD; the refresher catches up. A drag on
 *     the dashboard or the GitHub Project board is applied by writing it BACK into
 *     the TRDD (`column:` edit + folder `git mv`), never left living in a mirror.
 *   - NEVER TRUSTED WHEN IT MATTERS. Plan from the index; ACT from the TRDD. Every
 *     row carries its `filePath` so the source is one Read away, and
 *     `isKanbanIndexStale` lets a reader ask before an irreversible step. A stale
 *     row is expected, not a defect.
 *
 * The buffer is written OUTSIDE the corpus it indexes (`~/.aimaestro/kanban-index/`),
 * because a fleet agent's repo must not be dirtied by a cache of itself.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { DEFAULT_STATUSES } from '@/types/task'
import { statePath } from '@/lib/ecosystem-constants'
import { TRDD_ZONES, listTrddFiles, parseTrddFile, type TrddZone } from '@/lib/trdd-store'
import { toGraphNode } from '@/lib/trdd-graph'

/**
 * Column order for a rendered board. `DEFAULT_STATUSES` is the ratified 22-column
 * vocabulary (TRDD-YUGDER9D) and is imported, never restated — consumers align TO
 * it. The folder lifecycle adds five more `column:` values that the board
 * vocabulary does not carry: the two entry states before `todo`, and the three
 * terminal states an archived or refused TRDD lands in.
 *
 * Deduped, because a later edit to DEFAULT_STATUSES that adds one of these must not
 * silently produce two columns with the same name.
 */
export const KANBAN_INDEX_COLUMNS: readonly string[] = Array.from(
  new Set<string>(['proposal', 'planned', ...DEFAULT_STATUSES, 'completed', 'cancelled', 'refused']),
)

/**
 * Where an unrecognised `column:` lands. It is a bucket, not a drop: a vocabulary
 * that silently discards a value it does not know is how two boards drift apart.
 * A non-empty bucket is an alarm, and a test asserts it stays empty.
 */
export const UNKNOWN_COLUMN = '(unknown)'

export interface KanbanRow {
  id: string
  title: string
  column: string
  zone: TrddZone
  assignee: string | null
  priority: number | null
  taskType: string | null
  labels: string[]
  parent: string | null
  derived: boolean
  derivedKind: string | null
  npt: string[]
  eht: string[]
  blockedBy: string[]
  updated: string | null
  /** The source of truth for this row. Act from here, not from the row. */
  filePath: string
}

export interface KanbanIndex {
  version: 1
  generatedAt: string
  designDir: string
  /** Cheap stat-only signature of the corpus this index was built from. */
  fingerprint: string
  rows: KanbanRow[]
  /** Every known column, in board order, each mapping to its row ids. */
  byColumn: Record<string, string[]>
}

const INDEX_VERSION = 1

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s !== 'null' ? s : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  const s = asString(v)
  return s ? [s] : []
}

function asIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString()
  return asString(v)
}

/**
 * A stat-only signature: path, size and mtime of every TRDD file. Deliberately not
 * a content hash — the whole point of the staleness check is that it must be much
 * cheaper than the rebuild it guards, and hashing content means reading every file,
 * which IS the rebuild.
 *
 * The error is one-directional, which is the direction that matters: a `git
 * checkout` bumps mtimes without changing content, so this may report STALE for an
 * unchanged corpus (harmless — you rebuild). It cannot report FRESH for a changed
 * one, because writing a file always moves its mtime.
 */
export function corpusFingerprint(designDir: string): string {
  const parts: string[] = []
  for (const zone of TRDD_ZONES) {
    for (const file of listTrddFiles(designDir, zone)) {
      let st: fs.Stats
      try {
        st = fs.statSync(file)
      } catch {
        continue
      }
      parts.push(`${path.relative(designDir, file)}\0${st.size}\0${Math.trunc(st.mtimeMs)}`)
    }
  }
  parts.sort()
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex')
}

/** Build the index from the corpus. Pure over the filesystem; writes nothing. */
export function buildKanbanIndex(designDir: string, generatedAt: string): KanbanIndex {
  const rows: KanbanRow[] = []

  for (const zone of TRDD_ZONES) {
    for (const file of listTrddFiles(designDir, zone)) {
      const parsed = parseTrddFile(file, zone)
      if (!parsed) continue
      // A pre-frontmatter v0 TRDD has no column and no assignee. It is a document,
      // not a card; the graph skips it and so does the board.
      const node = toGraphNode(parsed)
      if (!node) continue
      const fm = parsed.frontmatter
      rows.push({
        id: node.id,
        title: parsed.title,
        column: node.column,
        zone: node.zone,
        assignee: asString(fm.assignee),
        priority: asNumber(fm.priority),
        taskType: asString(fm['task-type']),
        labels: asStringList(fm.labels),
        parent: node.parent,
        derived: node.derived,
        derivedKind: node.derivedKind,
        npt: node.npt,
        eht: node.eht,
        blockedBy: node.blockedBy,
        updated: asIso(fm.updated),
        filePath: node.filePath,
      })
    }
  }

  const order = new Map(KANBAN_INDEX_COLUMNS.map((c, i) => [c, i]))
  const rank = (c: string) => order.get(c) ?? KANBAN_INDEX_COLUMNS.length
  // Deterministic: rebuilding an unchanged corpus must yield a byte-identical index
  // apart from `generatedAt`. Unprioritised rows sort after prioritised ones.
  rows.sort(
    (a, b) =>
      rank(a.column) - rank(b.column) ||
      (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) ||
      a.id.localeCompare(b.id),
  )

  const byColumn: Record<string, string[]> = {}
  for (const c of KANBAN_INDEX_COLUMNS) byColumn[c] = []
  byColumn[UNKNOWN_COLUMN] = []
  for (const r of rows) {
    const key = order.has(r.column) ? r.column : UNKNOWN_COLUMN
    byColumn[key].push(r.id)
  }

  return {
    version: INDEX_VERSION,
    generatedAt,
    designDir,
    fingerprint: corpusFingerprint(designDir),
    rows,
    byColumn,
  }
}

/**
 * True when the corpus has moved since the index was built — or when we cannot
 * tell. Unknown means stale: the failure mode of a wrongly-fresh index is a plan
 * built on a card that has already moved.
 */
export function isKanbanIndexStale(index: KanbanIndex, designDir: string): boolean {
  if (index.version !== INDEX_VERSION) return true
  if (path.resolve(index.designDir) !== path.resolve(designDir)) return true
  return index.fingerprint !== corpusFingerprint(designDir)
}

/** The buffer's home — outside the corpus, so indexing a repo never dirties it. */
export function defaultKanbanIndexPath(designDir: string): string {
  const key = crypto.createHash('sha256').update(path.resolve(designDir)).digest('hex').slice(0, 16)
  return statePath('kanban-index', `${key}.json`)
}

/** Write the buffer atomically. A half-written cache must never be readable. */
export function writeKanbanIndex(index: KanbanIndex, filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp.${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(index, null, 2)}\n`)
  fs.renameSync(tmp, filePath)
}

/**
 * Read the buffer, or null. NEVER throws: absent, truncated, hand-edited and
 * wrong-version all mean the same thing — rebuild. A cache that can fail a caller
 * is not regenerable, it is a dependency.
 */
export function readKanbanIndex(filePath: string): KanbanIndex | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as KanbanIndex
    if (parsed?.version !== INDEX_VERSION || !Array.isArray(parsed.rows)) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * The one call a consumer wants: a fresh index, rebuilt only when the corpus moved.
 * Persisting is best-effort — an unwritable cache dir must not fail the read.
 */
export function getKanbanIndex(designDir: string, generatedAt: string, filePath?: string): KanbanIndex {
  const target = filePath ?? defaultKanbanIndexPath(designDir)
  const cached = readKanbanIndex(target)
  if (cached && !isKanbanIndexStale(cached, designDir)) return cached

  const fresh = buildKanbanIndex(designDir, generatedAt)
  try {
    writeKanbanIndex(fresh, target)
  } catch {
    // The buffer is an optimisation. Losing it costs a rebuild, nothing else.
  }
  return fresh
}
