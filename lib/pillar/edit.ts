/**
 * TRDD-D7KVF4HQ — the shared WRITE seam for the three pillar corpora.
 *
 * `lib/pillar/store.ts` is the shared READ seam (0 write calls, by construction).
 * This is its mirror: every mutation to a TRDD, PRRD or SPEC document goes through
 * `replaceAtLines` here, so `trddgrep` / `prrdgrep` / `specgrep` cannot drift into
 * three different concurrency stories.
 *
 * THE PRIMITIVE (USER-specified): `AT LINE N REPLACE X WITH Y`. If X is not present
 * at line N, the file changed since the caller read it and the command is BLOCKED.
 *
 * WHY LINE-ANCHORED rather than the harness Edit tool's file-wide unique match: a
 * caller that read line 14 and edits line 14 is asserting something a whole-file
 * match cannot express — that ITS VIEW OF THAT SPECIFIC LINE is current. A
 * unique-match edit silently SUCCEEDS when the content moved to another line, which
 * for pillar frontmatter is exactly wrong: `column:` legitimately appears again
 * inside fenced examples in the body, so "the only occurrence" is not a safe anchor.
 *
 * WHY THIS EXISTS AT ALL: design folders are symlinked between agents working the
 * same project, so N agents in N processes edit one corpus. Nothing here was
 * serialised before — `grep withLock lib/trdd-store.ts` was empty.
 *
 * WHY NOT `lib/file-lock.ts::withLock`: it is a PROCESS-LOCAL Map+Set mutex and its
 * own header says so (REG-MIN-05, "NO protection against … CLI utilities directly
 * importing registry modules while a dev/prod server is running"). Against N
 * processes it is inert — a lock that is correct, tested, and protects nothing.
 * `withJsonLock` is the cross-process one: a lock DIRECTORY at `${file}.lock` taken
 * with `mkdir(recursive:false)`, which Python's `os.mkdir` can also take. That
 * cross-language property is what makes the janitor's `prrd-edit.py` fixable rather
 * than fatal once `prrdgrep` ships — but only if it uses the SAME path and the SAME
 * mechanism. Two different suffixes, or O_EXCL vs mkdir, are two locks that exclude
 * each other nowhere (json-io's header records that exact incident).
 */
import { readFile, writeFile, rename, unlink } from 'fs/promises'
import { basename, join } from 'path'
import { withJsonLock, type JsonLockOpts } from '../json-io'
import type { PillarKind, PillarName } from './kinds'

/**
 * The exclusion key for one document — **derived from its IDENTITY, never its
 * current path**.
 *
 * This is not a style choice, it is the difference between a lock and a decoration.
 * A TRDD lifecycle transition MOVES the file (`git mv proposals/X.md tasks/X.md`)
 * and then edits it at the new path. A lock keyed on the path would be taken on
 * `proposals/X.md` by one writer and on `tasks/X.md` by another, and those two
 * writers would exclude each other NOWHERE while both appearing correctly locked —
 * the same "two paths, two locks, no exclusion" failure `lib/json-io.ts`'s header
 * records against O_EXCL-vs-mkdir.
 *
 * So every operation on a document — a CLI line-edit, a route's field edit, a zone
 * move — must pass the SAME key, and the only thing stable across a move is the id.
 *
 * The lock directory lands beside the corpus root rather than beside the document,
 * for the same reason: a lockdir inside `proposals/` would be orphaned by the very
 * `git mv` it is meant to serialise, and would additionally be walked by
 * `listDocuments`.
 */
export function documentLockKey(corpusRoot: string, kind: PillarName, id: string): string {
  return join(corpusRoot, `.${kind}-lock-${id}`)
}

/**
 * The lock key for the DOCUMENT a given record lives in — **use this from a CLI, not
 * `documentLockKey` directly.**
 *
 * `documentLockKey(root, kind, id)` takes a RECORD id, and that is the right key only
 * where id↔document is 1:1. That is TRDD and nothing else. Measured, from
 * `lib/pillar/kinds.ts`'s own header:
 *
 *   TRDD  one FILE per record   → id ↔ document is 1:1
 *   SPEC  N CLAUSES per file    → N ids share one document
 *   PRRD  N BULLETS in ONE file → EVERY id shares one document
 *
 * So keying a PRRD edit on its bullet id would hand two writers of the SAME file two
 * DIFFERENT lock directories: both acquire instantly, both read, both write, and the
 * second silently discards the first. The CAS would catch it only when the two edits
 * touch the same LINE — which is exactly the case a lock is least needed for. A lock
 * that excludes nothing while looking correct is worse than no lock, because it stops
 * anyone asking whether the file is protected (`lib/json-io.ts`'s header records the
 * same failure from the other direction: two mechanisms, one path, zero exclusion).
 *
 * The key is therefore whatever survives a zone move for THAT pillar: the id for a
 * per-document pillar, the file's BASENAME for a per-line one. SPEC's zones are
 * `['', 'proposals', 'archived']`, so a spec really can move — and `governance-spec.md`
 * is the same document in either zone.
 */
export function documentLockKeyFor(
  corpusRoot: string,
  kind: PillarKind,
  rec: { id: string; filePath: string },
): string {
  const documentId =
    kind.source.mode === 'per-document' ? kind.normalizeId(rec.id) : basename(rec.filePath)
  return documentLockKey(corpusRoot, kind.name, documentId)
}

/** One `AT LINE N REPLACE X WITH Y` instruction. `line` is 1-based, as a reader sees it. */
export interface LineEdit {
  /** 1-based line number from the caller's read. */
  line: number
  /** The exact original text the caller believes is at that line. */
  expect: string
  /** What to put in its place. */
  replace: string
}

/**
 * The BLOCK. Thrown when `expect` is not present at `line` — i.e. the document
 * changed between the caller's read and its write.
 *
 * The message is the USER-specified one and is part of the contract: the CLIs and
 * their tests gate on it, so it is not decoration.
 */
export class StaleDocumentError extends Error {
  constructor(
    public readonly path: string,
    public readonly line: number,
    public readonly expected: string,
    public readonly actual: string | undefined,
  ) {
    super(
      'The content of the TRDD/PRRD/SPEC file changed since your command was enqueued. ' +
        'Please reread the file first.' +
        `\n  file: ${path}` +
        `\n  line ${line} expected to contain: ${JSON.stringify(expected)}` +
        `\n  line ${line} actually reads:      ${actual === undefined ? '<past end of file>' : JSON.stringify(actual)}`,
    )
    this.name = 'StaleDocumentError'
  }
}

/** Options for `replaceAtLines`: the lock windows, plus the identity key. */
export interface ReplaceOpts extends JsonLockOpts {
  /**
   * The exclusion key, from `documentLockKey`. Omit ONLY for a document that
   * cannot move; a pillar caller that omits it around a zone transition is not
   * locked against a peer that used the other path.
   */
  lockKey?: string
}

export interface ReplaceResult {
  path: string
  /** The lines actually rewritten, ascending. */
  linesChanged: number[]
  /** A unified-ish diff of just the changed lines — the directive's "diff changes". */
  diff: string
}

/**
 * Split into lines while remembering whether the file ended with a newline.
 *
 * Rejoining with `\n` and unconditionally appending one would ADD a trailing
 * newline to a file that had none, which is a byte change the caller never asked
 * for — and byte-determinism is one of the directive's clauses, so a write that
 * quietly normalises is a write that fails it.
 */
function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = text.endsWith('\n')
  const body = trailingNewline ? text.slice(0, -1) : text
  return { lines: body.split('\n'), trailingNewline }
}

/**
 * Apply a batch of `AT LINE N REPLACE X WITH Y` edits under the document's lock.
 *
 * ALL-OR-NOTHING: every edit is validated against the freshly-read file BEFORE any
 * is applied. A batch where edit 3 is stale leaves the file byte-identical — a
 * half-applied batch is the corruption this exists to prevent, not a partial
 * success to report.
 *
 * DETERMINISTIC: edits are applied by line number, each to its own line, so the
 * output depends only on (input, edits) and not on the order the caller listed
 * them. Two edits to the same line are refused rather than silently composed —
 * their result WOULD depend on order, which is the clause this enforces.
 */
export async function replaceAtLines(
  filePath: string,
  edits: readonly LineEdit[],
  opts: ReplaceOpts = {},
): Promise<ReplaceResult> {
  // Lock on the caller's IDENTITY key when it supplies one. Defaulting to the path
  // is safe ONLY for a corpus whose documents never move; for the pillars, a caller
  // that omits `lockKey` around a zone transition gets two locks and no exclusion
  // (see `documentLockKey`). The default exists so a one-off edit is not forced to
  // know the corpus root, not because path-keying is equivalent.
  const lockKey = opts.lockKey ?? filePath
  if (edits.length === 0) {
    throw new Error('replaceAtLines: refusing an empty edit batch — a no-op write is a caller bug')
  }

  const seen = new Set<number>()
  for (const e of edits) {
    if (!Number.isInteger(e.line) || e.line < 1) {
      throw new Error(`replaceAtLines: line must be a positive integer, got ${e.line}`)
    }
    if (seen.has(e.line)) {
      throw new Error(
        `replaceAtLines: two edits target line ${e.line}. Their combined result would depend on ` +
          'application order, which breaks determinism — issue them as separate, re-read batches.',
      )
    }
    seen.add(e.line)
  }

  return withJsonLock(
    lockKey,
    async () => {
      // Read INSIDE the lock. Reading outside would re-open the very window the lock
      // closes: the caller's line numbers would be checked against a snapshot that a
      // peer could have replaced between the read and the acquire.
      const original = await readFile(filePath, 'utf-8')
      const { lines, trailingNewline } = splitLines(original)

      // PASS 1 — validate every edit. Nothing is mutated here.
      for (const e of edits) {
        const actual = lines[e.line - 1]
        if (actual === undefined || !actual.includes(e.expect)) {
          throw new StaleDocumentError(filePath, e.line, e.expect, actual)
        }
      }

      // PASS 2 — apply. Ordered by line so `diff` reads top-to-bottom regardless of
      // the order the caller listed them.
      const ordered = [...edits].sort((a, b) => a.line - b.line)
      const diffParts: string[] = []
      for (const e of ordered) {
        const before = lines[e.line - 1]
        // Replace the FIRST occurrence only. A line carrying `expect` twice is
        // ambiguous, and replaceAll would rewrite text the caller never looked at.
        // FUNCTION replacement, not a string one. `String.prototype.replace` treats `$&`,
        // `` $` ``, `$'`, `$$` and `$n` in a STRING replacement as substitution patterns, so
        // `--replace "use $& twice"` against `--expect "cite the rule"` wrote
        // `use cite the rule twice` — bytes the caller never asked for, silently persisted to
        // a governance document. A replacer function's return value is used verbatim, which
        // is the only correct reading of a literal `--replace` argument from argv.
        const after = before.replace(e.expect, () => e.replace)
        lines[e.line - 1] = after
        diffParts.push(`@@ line ${e.line} @@\n-${before}\n+${after}`)
      }

      const next = lines.join('\n') + (trailingNewline ? '\n' : '')

      // Byte-identical result ⇒ skip the write. Not an optimisation: a write that
      // changes nothing still bumps mtime, and mtime is what every freshness probe
      // and index-staleness check in lib/pillar/ keys on.
      if (next !== original) {
        await atomicWrite(filePath, next)
      }

      return {
        path: filePath,
        linesChanged: ordered.map((e) => e.line),
        diff: diffParts.join('\n'),
      }
    },
    opts,
  )
}

/**
 * Write via temp + rename, so a crash mid-write can never leave a half-written
 * document. `rename(2)` is atomic within a filesystem, and the temp file is a
 * sibling precisely so it lands on the same one.
 *
 * The temp name carries the pid: two processes that somehow reach here for the same
 * path (a stale-broken lock, per json-io's documented two-holders hazard) then
 * clobber each other's TEMP file rather than interleaving into the real one.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp.${process.pid}`
  try {
    await writeFile(tmp, content, 'utf-8')
    await rename(tmp, filePath)
  } catch (err) {
    // Best-effort cleanup: a failed rename leaves the temp behind, and a stray
    // `*.tmp.<pid>` beside a corpus document is exactly the kind of litter that
    // makes a later `walkDocuments` count wrong.
    await unlink(tmp).catch(() => {})
    throw err
  }
}
