/**
 * TRDD-L55IYKL4 — the generic pillar corpus reader, shared by TRDD / PRRD / SPEC.
 *
 * TWO PROPERTIES ARE LOAD-BEARING, and both were measured rather than assumed.
 *
 * 1. IT FAILS LOUD. A reader that returns `[]` on an I/O error makes an unreadable
 *    directory and an empty one the same answer, so a gate built on it passes
 *    because it read nothing. A missing ZONE is legal (a fresh project has no
 *    `refused/`); every other errno throws. An empty result must be PROVABLY empty,
 *    never merely unread. (ai-maestro#96 L2.)
 *
 * 2. THE PRIMARY READ IS AN ITERATOR, NOT AN ARRAY. Measured on generated corpora:
 *
 *      cards   corpus    wall     peak RSS
 *      1 000     10 MB   1.61 s     178 MB
 *     10 000    118 MB   5.47 s     820 MB
 *     50 000    586 MB  37.63 s   3 309 MB      ← 100k extrapolates to ~6.5 GB
 *
 *    RSS tracks corpus bytes because the linter holds every card, `raw` included,
 *    in one array. Past ~60-70k documents that is a heap crash, not a slow run —
 *    the wall arrives BELOW the 10^5 target. So an array-returning primary read
 *    IS the bug; `walkDocuments`/`walkRecords` let a consumer process and discard.
 *    Array helpers stay for the small-corpus callers that legitimately want one.
 *
 * WHAT THIS MODULE IS NOT: an index. Resolving a reference still costs a scan here,
 * so a cross-pillar lint written directly on `findRecord` is O(N^2 x refs). The
 * linter escapes that today only by building its own in-memory Map — which is
 * exactly the memory cost above. Both are the same problem, and the SQLite index
 * (Phase 5) is the one fix: the same index the linter already builds, persisted and
 * repaired incrementally instead of rebuilt from scratch every run.
 */
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import type { PillarKind, PillarName } from './kinds'

export interface PillarDocument {
  kind: PillarName
  /** The zone it was found in. `''` for a zone-less pillar. */
  zone: string
  filePath: string
  frontmatter: Record<string, unknown>
  body: string
}

export interface PillarRecord {
  id: string
  kind: PillarName
  zone: string
  filePath: string
  /** 1-based declaration line for a per-line pillar; `null` for per-document. */
  line: number | null
  /** The owning document's frontmatter — shared by every record of that document. */
  frontmatter: Record<string, unknown>
  /** per-document: the whole body. per-line: the declaration line. */
  text: string
}

/**
 * Fail loudly when the corpus ROOT itself is absent or unreadable.
 *
 * `listDocuments` deliberately tolerates a missing ZONE. The cost of that tolerance
 * is that a completely wrong root yields empty zones and a confident "0 findings".
 * This guard is what separates "the corpus is clean" from "you are not where you
 * think you are", and any caller that GATES on a scan must call it first.
 */
export function assertCorpusRoot(root: string, kind: PillarKind): void {
  let st: fs.Stats
  try {
    st = fs.statSync(root)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    throw new Error(
      code === 'ENOENT'
        ? `no ${kind.label} corpus at ${root} — wrong working directory, or pass --design-dir`
        : `cannot stat ${kind.label} corpus ${root}: ${(err as Error).message}`,
    )
  }
  if (!st.isDirectory()) throw new Error(`${kind.label} corpus path is not a directory: ${root}`)
}

/**
 * Every document file in one zone.
 *
 * A MISSING zone yields `[]` — legal. ANY OTHER read failure THROWS, and that
 * distinction is the whole point of the function.
 */
export function listDocuments(root: string, kind: PillarKind, zone: string): string[] {
  const dir = zone ? path.join(root, zone) : root
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return []
    throw new Error(`cannot read ${kind.label} zone ${dir}: ${(err as Error).message}`)
  }
  return names.filter((n) => kind.isDocument(n)).map((n) => path.join(dir, n))
}

/**
 * Read + parse one document.
 *
 * ENOENT is the one benign case: the file was listed and then moved out from under
 * us by a concurrent `git mv` lifecycle transition, which is normal traffic on a
 * TRDD corpus. Every other errno (EACCES, EIO, ELOOP) is a real fault on a file we
 * already know IS a document — its name passed `isDocument`. Returning null there
 * would delete a real record from every count, board and lint without a word.
 *
 * Unparseable FRONTMATTER is a different shape and is NOT an error: the document is
 * kept with empty fields so a lint can report it, rather than dropped silently.
 */
export function readDocument(
  filePath: string,
  kind: PillarKind,
  zone: string,
): PillarDocument | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
    throw new Error(`cannot read ${kind.label} ${filePath}: ${(err as Error).message}`)
  }
  let data: Record<string, unknown> = {}
  let content = ''
  try {
    const parsed = matter(raw)
    data = (parsed.data ?? {}) as Record<string, unknown>
    content = parsed.content ?? ''
  } catch {
    data = {}
    content = raw
  }
  return { kind: kind.name, zone, filePath, frontmatter: data, body: content }
}

/**
 * Every document in the corpus, one at a time.
 *
 * A generator on purpose: the caller decides whether to accumulate. At 10^5 the
 * difference between iterating and collecting is ~6.5 GB.
 */
export function* walkDocuments(
  root: string,
  kind: PillarKind,
  zones?: readonly string[],
): Generator<PillarDocument> {
  for (const zone of zones ?? kind.zones) {
    for (const file of listDocuments(root, kind, zone)) {
      const doc = readDocument(file, kind, zone)
      if (doc) yield doc
    }
  }
}

/** Every record a single document yields — one for TRDD, N for PRRD/SPEC. */
export function* recordsOf(doc: PillarDocument, kind: PillarKind): Generator<PillarRecord> {
  const base = {
    kind: kind.name,
    zone: doc.zone,
    filePath: doc.filePath,
    frontmatter: doc.frontmatter,
  }
  if (kind.source.mode === 'per-document') {
    const id = kind.source.idFromFilename(path.basename(doc.filePath))
    // `isDocument` already vetted the name, so this cannot normally miss; a null
    // here means the two disagree, and inventing an id would be worse than skipping.
    if (id) yield { ...base, id, line: null, text: doc.body }
    return
  }
  const { declarationRe, idFromMatch } = kind.source
  const lines = doc.body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = declarationRe.exec(lines[i])
    if (m) yield { ...base, id: idFromMatch(m), line: i + 1, text: lines[i] }
  }
}

/** Every record in the corpus, one at a time. */
export function* walkRecords(
  root: string,
  kind: PillarKind,
  zones?: readonly string[],
): Generator<PillarRecord> {
  for (const doc of walkDocuments(root, kind, zones)) {
    yield* recordsOf(doc, kind)
  }
}

/**
 * First record whose id matches, or null.
 *
 * O(N) per call and uncached — the honest cost of a corpus with no index. For a
 * per-document pillar the scan is filename-only, so only the ONE match is parsed;
 * for a per-line pillar every document is read. A caller resolving MANY ids (a
 * reference lint) must NOT loop this — build a Map once, or use the index.
 */
export function findRecord(root: string, kind: PillarKind, id: string): PillarRecord | null {
  const want = kind.normalizeId(id)
  if (kind.source.mode === 'per-document') {
    const { idFromFilename } = kind.source
    for (const zone of kind.zones) {
      for (const file of listDocuments(root, kind, zone)) {
        const found = idFromFilename(path.basename(file))
        if (found && kind.normalizeId(found) === want) {
          const doc = readDocument(file, kind, zone)
          if (!doc) return null
          for (const rec of recordsOf(doc, kind)) return rec
        }
      }
    }
    return null
  }
  for (const rec of walkRecords(root, kind)) {
    if (kind.normalizeId(rec.id) === want) return rec
  }
  return null
}
