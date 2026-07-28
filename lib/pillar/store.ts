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
 * 2. THE PRIMARY READ IS AN ITERATOR, NOT AN ARRAY — and that alone was not enough.
 *    Measured end-to-end on a generated 100 000-card corpus (`yarn trdd:doctor`):
 *
 *      before  exit 134 (OOM crash)   4.45 GB peak RSS   died at 23 s
 *      after   exit 0                 2.43 GB peak RSS       22.6 s
 *
 *    Note the failure was a CRASH, not a slow run: the wall is memory and it
 *    arrives BELOW the 10^5 target. Two independent causes had to go (TRDD-BQC8NQSW):
 *    the linter retained every card with `raw` AND `body`, and gray-matter's
 *    module-level cache retained every file behind the caller's back — see NO_CACHE.
 *    An array-returning primary read is the first bug, so `walkDocuments` /
 *    `walkRecords` let a consumer process and discard; array helpers stay for the
 *    small-corpus callers that legitimately want one. But note the ORDER of the two:
 *    streaming without the cache fix is theatre, because the reader would still
 *    accumulate the whole corpus no matter how little it kept.
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
 * Passed to EVERY `matter()` call, and the reason is memory, not parsing.
 *
 * gray-matter keeps a MODULE-LEVEL cache keyed by the full file text
 * (`matter.cache[file.content] = file`, gray-matter 4.0.3 `index.js:35-47`) and stores
 * the parsed file INCLUDING its `orig`. So every document ever parsed is retained for
 * the life of the process, and memory tracks TOTAL CORPUS BYTES no matter how little
 * the caller keeps. Invisible at 298 files; fatal at 10^5.
 *
 * MEASURED, because the correlation had an obvious wrong explanation. On a 20 000-card
 * fixture, retaining nothing but the frontmatter cost 456 MB with 10 KB bodies and
 * 104 MB with 1 KB bodies — IDENTICAL frontmatter, 4.4x the memory. The natural reading
 * was V8 sliced strings (a substring >= 13 chars keeps a pointer to its parent, so one
 * retained field would pin a whole document); deep-flattening every frontmatter string
 * moved the number by -3%, refuting it. The bodies were being held by this cache.
 *
 * gray-matter skips the cache whenever ANY options object is passed — its own comment
 * says caching with options would negate the benefit — and `defaults()` is
 * `Object.assign({}, options)`, so `{}` is behaviourally identical to passing nothing.
 * This constant changes no parsing; it only declines to leak.
 *
 * DO NOT "simplify" this back to `matter(raw)`. It is not decoration: without it a
 * perfectly streaming reader that retains NOTHING still accumulates the whole corpus,
 * so the streaming would be theatre.
 */
const NO_CACHE: Record<string, never> = {}

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
    const parsed = matter(raw, NO_CACHE)
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
