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
import { NO_MATTER_CACHE } from '../gray-matter-nocache'
import type { PillarKind, PillarName } from './kinds'

export interface PillarDocument {
  kind: PillarName
  /** The zone it was found in. `''` for a zone-less pillar. */
  zone: string
  filePath: string
  frontmatter: Record<string, unknown>
  body: string
  /**
   * How many lines of the FILE sit above `body` — i.e. the frontmatter block. Add it
   * to a body-relative line number to get a file-relative one.
   *
   * It exists because `body` is gray-matter's `content`, which has the frontmatter
   * STRIPPED, so a line counted in `body` is NOT the line a reader (or `sed -n Np`,
   * or an editor) would find it on. Every per-line pillar has frontmatter, so the two
   * always disagree — measured on a 3-line-frontmatter PRRD, by exactly 3.
   */
  bodyLineOffset: number
  /**
   * Set when the frontmatter could NOT be parsed — the reason, verbatim from the parser.
   *
   * WHY this field exists (TRDD-5XJWR473, 2026-08-04). The parse failure used to be
   * swallowed into `frontmatter = {}`, which made "this document has no fields" and "I
   * could not read this document" the SAME answer. That is a lenient read, and its
   * danger is not on the read side — it is on whatever WRITES based on it. Measured:
   * `trdd-doctor --fix` keys its `column:`/`title:` insertions on those fields being
   * absent, so an unparseable card got a SECOND pair inserted after `trdd-id:` while the
   * real ones sat unparsed below. The insertion does not make the YAML parseable, so the
   * next run appended another pair, and the next — unbounded, on the tool whose whole job
   * is keeping the corpus honest.
   *
   * It is a FIELD rather than a thrown error on purpose: `walkDocuments` streams the whole
   * corpus, and one malformed card must not abort a sweep over the other 370.
   *
   * A caller that WRITES must refuse when this is set. A caller that only READS may treat
   * the document as field-less, which is what every caller did before this existed.
   */
  parseError?: string
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
 * Every document file in one zone, in a STABLE order.
 *
 * A MISSING zone yields `[]` — legal. ANY OTHER read failure THROWS, and that
 * distinction is the whole point of the function.
 *
 * THE SORT IS A CORRECTNESS PROPERTY, NOT TIDINESS. `readdirSync` returns
 * directory order, which POSIX does not define: APFS happens to hand back sorted
 * names, ext4 with `dir_index` hands back HASH order. Every consumer inherits that
 * order for its ties — `board` within a column, `roots` by hold-count, the search
 * by score — so without this, identical corpora render differently on two machines
 * and any diff-based acceptance passes at home and flakes in CI. It is also the
 * precondition for index-backing these queries at all: a walk-vs-index differential
 * can only be byte-compared if the walk agrees with `ORDER BY path`.
 *
 * Measured at 10^5, and stated as measured: sorting the largest zone in isolation
 * (35 000 shuffled names) is 6.2 ms, and end-to-end the difference is BELOW the
 * run-to-run noise floor — 8.82/8.10 s with the sort against 8.17/8.12 s without,
 * a spread that swamps it. Determinism is free at this scale; discovering it was
 * missing only after building a differential test on top of it would not be.
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
  return names
    .filter((n) => kind.isDocument(n))
    .sort()
    .map((n) => path.join(dir, n))
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
  let parseError: string | undefined
  try {
    // NO_MATTER_CACHE, or the reader accumulates every document it ever parsed —
    // which would make the streaming above theatre. See lib/gray-matter-nocache.ts.
    const parsed = matter(raw, NO_MATTER_CACHE)
    data = (parsed.data ?? {}) as Record<string, unknown>
    content = parsed.content ?? ''
  } catch (err) {
    // The document survives as text so a reader can still show it, but the failure is
    // REPORTED rather than flattened into "no fields" — see `parseError` on the type for
    // the corruption that flattening caused. Degrading silently here is what made a
    // careful writer downstream do the wrong thing with total confidence.
    data = {}
    content = raw
    parseError = (err as Error)?.message || String(err)
  }
  return {
    kind: kind.name,
    zone,
    filePath,
    frontmatter: data,
    body: content,
    bodyLineOffset: bodyLineOffset(raw, content),
    ...(parseError ? { parseError } : {}),
  }
}

/**
 * Lines of `raw` above where `content` starts.
 *
 * Computed by SUFFIX, not by re-parsing the delimiters: gray-matter's `content` is a
 * literal slice of the input on every normal path, so the prefix it leaves behind is
 * exactly the frontmatter block and counting its newlines is exact for any delimiter
 * style, any frontmatter language, and no frontmatter at all (prefix `''` → 0).
 *
 * When `content` is NOT a suffix — a normalisation gray-matter can apply — we return 0,
 * which is the behaviour every caller had before this function existed. That is a
 * deliberate degrade to the previous semantics rather than a guess: the CAS in
 * `lib/pillar/edit.ts` is what makes it safe, because an edit aimed at the wrong line
 * is BLOCKED rather than applied. A wrong offset costs a refusal; it cannot cost a
 * write to the wrong rule.
 */
function bodyLineOffset(raw: string, content: string): number {
  if (!raw.endsWith(content)) return 0
  const prefix = raw.slice(0, raw.length - content.length)
  return prefix.split('\n').length - 1
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
    // FILE-relative, never body-relative. `line` is what an editor, `sed -n Np`, and
    // `replaceAtLines`'s compare-and-swap all mean by a line number, so a body-relative
    // value here is not an off-by-N in a display string — it aims a WRITE at the wrong
    // line. It shipped that way and only the CAS refusing an edit exposed it.
    if (m) yield { ...base, id: idFromMatch(m), line: i + 1 + doc.bodyLineOffset, text: lines[i] }
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
