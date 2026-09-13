/**
 * TRDD-KJQZEYXW — TRDD-file corpus store.
 *
 * Read / search / edit the git-tracked TRDD corpus under a project's
 * `design/{proposals,tasks,archived,refused}/*.md`, and perform the folder
 * lifecycle transitions the `aimaestro-trdd-approval.md` DEP overlay defines:
 *   - promote  proposal → planned   (git mv proposals/ → tasks/)
 *   - refuse   proposal → refused    (git mv proposals/ → refused/)
 *   - archive  → completed|cancelled|superseded (git mv → archived/)
 *   - advance  column edit within tasks/ (no folder move)
 *
 * PARSING uses gray-matter (robust YAML). WRITING is line-based on purpose: the
 * TRDD frontmatter is "grep-first" (one field per line, flow-style lists, bare
 * kebab enums) and re-serializing the whole block via a YAML emitter would
 * reorder keys / quote strings / block-style the lists and break that contract.
 * So every mutation touches only the exact line(s) it changes and appends the
 * `## Approval log` line at EOF (the log is the last section by convention).
 *
 * This module never commits. It stages the full transition — the rename AND the
 * content edit — and leaves the caller to commit, matching the overlay's protocol
 * (edit, git mv, commit).
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { TRDD_KIND, TRDD_ZONES, trddIdFromFilename, type TrddZone } from './pillar/kinds'
import { assertCorpusRoot, listDocuments, readDocument, walkDocuments } from './pillar/store'
import { validateTrddFieldEdits } from './trdd-edit-guard'
import { VALID_COLUMNS, expectedZone, TIER_TO_REQUIREMENT, TERMINAL_DONE, isParkedByOtherForm } from './trdd-vocabulary'
import { candidateFrontmatter, introducedViolations } from './pillar/trdd-candidate'
import { acceptanceBoxes } from './trdd-body'
import { withJsonLock } from './json-io'
import { documentLockKey, atomicWriteSync } from './pillar/edit'

/**
 * The ONE local-offset stamp for the TRDD corpus: `%Y-%m-%dT%H:%M:%S±HHMM`.
 *
 * It lives HERE, in the module that performs every dated write (`updated:`,
 * `approval-datetime:`, and the `## Approval log` prose line), rather than in
 * `trdd-create.ts` where the implementation used to be private. That is not a
 * preference — `trdd-create` already imports FROM this module, so exporting it the
 * other way would close an import cycle (TRDD-S13L6R9R).
 *
 * It takes a Date so it is (a) unit-testable without mocking the clock and (b) usable
 * to CONVERT an existing instant, which is what a format backfill needs: the repair
 * must preserve the moment a card was written, never substitute `now`. The corpus
 * sorts on `updated:`, so stamping `now` during a format pass would silently reorder
 * the board — the exact damage `trdd-doctor.ts:1399-1421` records having already
 * caused once.
 *
 * NOT `toISOString()`: that yields UTC `Z` with milliseconds, which the rule does not
 * admit and the corpus does not use. Converting from `Z` truncates to the second; the
 * format has no sub-second slot and never has.
 */
export function isoLocal(d: Date = new Date()): { iso: string; stamp: string } {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const offMin = -d.getTimezoneOffset() // getTimezoneOffset is inverted (UTC − local)
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  const off = `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return {
    iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off}`,
    stamp: `${date}_${time}${off}`,
  }
}

export { SHIPPED }

import { SHIPPED } from './trdd-vocabulary'

// Re-exported so this module's PUBLIC API is unchanged by the move to lib/pillar/:
// every existing caller imports TrddZone / TRDD_ZONES from here, and the proof the
// shared seam fits is that trdd-store's own tests pass unchanged.
export { TRDD_ZONES, type TrddZone }

export interface ParsedTrdd {
  id: string
  zone: TrddZone
  filePath: string
  column: string
  title: string
  frontmatter: Record<string, unknown>
  body: string
  /**
   * Set when the frontmatter could not be PARSED, carrying the parser's own reason
   * (TRDD-5XJWR473). Distinct from `frontmatter: {}`, which legitimately means "parsed
   * fine, no fields" — see `PillarDocument.parseError` for why conflating the two let
   * the auto-fixer duplicate fields on every run.
   *
   * `column` and `title` are `''` here, exactly as for a field-less card, so ANY caller
   * that writes based on their absence MUST check this first.
   */
  parseError?: string
}

export interface TrddSummary {
  id: string
  zone: TrddZone
  column: string
  title: string
  filePath: string
  updated: string | null
  priority: unknown
}

export interface SearchOpts {
  column?: string
  id?: string
  keyword?: string
  zone?: TrddZone
}

export type TrddResult =
  | { ok: true; id: string; from?: TrddZone; to?: TrddZone; column?: string; filePath: string }
  | { ok: false; error: string; status: number }

// The default corpus is the SERVER's own repo (process.cwd() is the project root
// when the custom Next.js server runs). Routes may point at another agent's
// `<workdir>/design` instead.
export function defaultDesignDir(): string {
  return path.join(process.cwd(), 'design')
}

/**
 * Fail loudly when the corpus ROOT itself is absent or unreadable.
 *
 * `listTrddFiles` below deliberately tolerates a missing ZONE — a fresh project
 * has no `refused/` yet, and that is not an error. The cost of that tolerance is
 * that a completely wrong `designDir` yields four empty zones and a confident
 * "0 findings". This guard is what separates "the corpus is clean" from "you are
 * not where you think you are", and any caller that GATES on a scan must call it
 * first. Without it, `greptrdd validate` run from the wrong directory reported a
 * clean corpus and exited 0 — a write gate that passed because it read nothing.
 */
export function assertDesignDir(designDir: string): void {
  assertCorpusRoot(designDir, TRDD_KIND)
}

// The v1/v2 filename grammar moved to `lib/pillar/kinds.ts` (TRDD_KIND). It is the
// TRDD's answer to the one question each pillar answers differently — where a
// record's id lives — so it belongs with the other two answers, not here. Aliased
// so the rest of this module reads unchanged.
const idFromFilename = trddIdFromFilename

// gray-matter (js-yaml) auto-parses an ISO-8601 frontmatter value into a JS Date.
// Normalize such a value back to an ISO string for the summary; leave a plain
// string as-is; anything else → null.
function toIsoOrNull(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v
  return null
}

/**
 * Every TRDD file in one zone, v1 and v2 filename shapes alike.
 *
 * A MISSING zone is legal and yields `[]` — a fresh project has no `refused/`.
 * ANY OTHER read failure THROWS, and that distinction is the whole point.
 *
 * This used to be `catch { return [] }`, which made an unreadable directory and
 * an empty one the same answer. A permissions fault, a broken mount, or simply
 * the wrong working directory all read as "there is nothing here" — silently,
 * because the failure mode of a missing input is not an error, it is a SILENCE,
 * and silence reads as zero. That is ai-maestro#96 L2 (*a parser with a silent
 * `continue` is a data-loss engine*) in the corpus reader that every pillar tool,
 * the board, the graph and the write gate are built on.
 *
 * An empty result must be PROVABLY empty, never merely unread.
 */
export function listTrddFiles(designDir: string, zone: TrddZone): string[] {
  return listDocuments(designDir, TRDD_KIND, zone)
}

export function parseTrddFile(filePath: string, zone: TrddZone): ParsedTrdd | null {
  // A name that is not a TRDD is not an error — it is not a card. (Distinct from a
  // READ failure, which `readDocument` throws on; two shapes, two behaviours.)
  const id = idFromFilename(path.basename(filePath))
  if (!id) return null
  const doc = readDocument(filePath, TRDD_KIND, zone)
  if (!doc) return null
  const data = doc.frontmatter
  return {
    id,
    zone,
    filePath,
    column: typeof data.column === 'string' ? data.column : '',
    title: typeof data.title === 'string' ? data.title : '',
    frontmatter: data,
    body: doc.body,
    // Propagated, not swallowed: a card whose YAML does not parse reaches every caller
    // looking exactly like one that merely lacks fields, and the auto-fixer used to
    // "repair" it by inserting duplicates of the fields sitting unparsed below.
    ...(doc.parseError ? { parseError: doc.parseError } : {}),
  }
}

/** Find one TRDD by id across all four zones (case-insensitive), or null. */
export function findTrdd(designDir: string, id: string): ParsedTrdd | null {
  // `normalizeId`, not `toUpperCase`: it ALSO strips the `TRDD-` prefix, which is the
  // CANONICAL citation form the IND base defines ("Reference a TRDD as `TRDD-<id8>`").
  // Without it this resolved a bare id and 404'd on the very spelling every commit
  // subject, every frontmatter reference and every agent-to-agent message uses — while
  // `trddgrep edit TRDD-<id8>` resolved it fine, because the CLI goes through
  // `findRecord`, which normalizes. Two lookups disagreeing about what an id IS.
  // Strictly more permissive: a bare id normalizes to itself, so no caller loses.
  const want = TRDD_KIND.normalizeId(id)
  for (const zone of TRDD_ZONES) {
    for (const file of listTrddFiles(designDir, zone)) {
      if (idFromFilename(path.basename(file)) === want) {
        return parseTrddFile(file, zone)
      }
    }
  }
  return null
}

/** Read one TRDD by id (full frontmatter + body). */
export function readTrdd(designDir: string, id: string): ParsedTrdd | null {
  return findTrdd(designDir, id)
}

/** Search the corpus by column, id, free-text keyword (title + body), and/or zone. */
export function searchTrdds(designDir: string, opts: SearchOpts = {}): TrddSummary[] {
  const zones = opts.zone ? [opts.zone] : TRDD_ZONES
  const wantId = opts.id ? opts.id.toUpperCase() : null
  const kw = opts.keyword ? opts.keyword.toLowerCase() : null
  const out: TrddSummary[] = []

  // Iterates rather than collecting: only the small SUMMARIES accumulate, never the
  // bodies. The saving is modest at today's 298 cards — the corpus-sized win belongs
  // to the linter (EHT BQC8NQSW) — but routing the search through the seam's primary
  // read means `walkDocuments` is exercised by every one of this module's tests and
  // by the live corpus, instead of being an API the next phase merely hopes works.
  for (const zone of zones) {
    for (const doc of walkDocuments(designDir, TRDD_KIND, [zone])) {
      const id = idFromFilename(path.basename(doc.filePath))
      if (!id) continue
      if (wantId && id !== wantId) continue
      const fm = doc.frontmatter
      const column = typeof fm.column === 'string' ? fm.column : ''
      if (opts.column && column !== opts.column) continue
      const title = typeof fm.title === 'string' ? fm.title : ''
      if (kw) {
        const hay = `${title}\n${doc.body}`.toLowerCase()
        if (!hay.includes(kw)) continue
      }
      out.push({
        id,
        zone,
        column,
        title,
        filePath: doc.filePath,
        updated: toIsoOrNull(fm.updated),
        priority: fm.priority,
      })
    }
  }
  return out
}

// ── line-based frontmatter writers (preserve the grep-first format) ──────────

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Raised by {@link setFrontmatterField} when the content has no usable `---` frontmatter
 *  block, so a caller can report the failure instead of writing an unchanged file. */
export class NoFrontmatterError extends Error {
  constructor(reason: string) {
    super(`cannot set a frontmatter field: ${reason}`)
    this.name = 'NoFrontmatterError'
  }
}

/**
 * Set (or insert) a single `field: value` line inside the `---` frontmatter.
 *
 * THROWS rather than returning the content unchanged when there is no frontmatter to edit.
 * The previous silent `return content` was indistinguishable from a successful edit at every
 * call site — `advanceColumn`/`editTrdd`/`editAt` all write the buffer and return `{ok:true,
 * column}` unconditionally — so a card the writer could not parse was reported as moved while
 * its `column:` on disk never changed. A no-op that reports success is the worst outcome here:
 * the board, the API and the CLI all agree on a transition that did not happen.
 *
 * The `\r?` in the fence match is the reason this was reachable at all in practice. Splitting
 * on '\n' leaves a trailing CR on every line of a CRLF-authored TRDD, so `lines[0]` was
 * `'---\r'` and the strict `=== '---'` comparison rejected the whole file. CRLF is an
 * anticipated input elsewhere in this pillar (`trdd-doctor.ts` matches `\r?\n`), so those
 * cards were silently unwritable. Inserted lines inherit the file's own line ending so a CRLF
 * document does not acquire one stray LF-only line.
 */
export function setFrontmatterField(content: string, field: string, value: string): string {
  const lines = content.split('\n')
  const isFence = (line: string | undefined): boolean => line !== undefined && line.trimEnd() === '---'
  if (!isFence(lines[0])) {
    throw new NoFrontmatterError('the document does not open with a `---` fence')
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (isFence(lines[i])) {
      end = i
      break
    }
  }
  if (end === -1) {
    throw new NoFrontmatterError('the opening `---` fence is never closed')
  }

  // Preserve the document's own line ending on any line this function writes.
  const eol = lines[0].endsWith('\r') ? '\r' : ''
  const re = new RegExp(`^${escapeRe(field)}:`)
  for (let i = 1; i < end; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${field}: ${value}${eol}`
      return lines.join('\n')
    }
  }
  // Not present — insert just before the closing fence.
  lines.splice(end, 0, `${field}: ${value}${eol}`)
  return lines.join('\n')
}

/**
 * Append one entry to the `## Approval log` section, creating the section at EOF
 * when it does not exist.
 *
 * The log is the LAST section by convention, but convention is not a guarantee:
 * a TRDD may carry `## Notes and lessons learned` after it, and at least one in
 * this corpus does. Appending at end-of-file would then file the approval entry
 * under whatever section happens to be last — silently, since both are prose. So
 * the entry is inserted at the end of the log's OWN section (before the next `## `
 * heading), after its last non-blank line so the blank separator survives.
 */
export function appendApprovalLog(content: string, logLine: string): string {
  return appendToSection(content, '## Approval log', logLine)
}

/**
 * Append one line to the END of a named `## ` section, creating the section at EOF when
 * it does not exist (TRDD-I8UC56GZ — this is `appendApprovalLog` generalized, and that
 * function is now a one-line wrapper so there is one implementation, not two).
 *
 * WHY IT EXISTS AS A VERB. Appending to a section had no tool, so the workaround was
 * `edit --at-line N --expect <some existing line> --replace <that same line + the new
 * text>` — a line number and a whole line of context standing in for "put this at the end
 * of that section". It is CAS-guarded and therefore safe, but it is a proxy operation,
 * and it was performed four times in the session that wrote this. The heading is the
 * address the caller actually means.
 *
 * The insertion point is the section's own end, backing up over trailing blanks, NOT
 * end-of-file: a TRDD may carry `## Notes and lessons learned` after its log, and at
 * least one in this corpus does, so appending at EOF would silently file the entry under
 * whatever section happens to be last.
 */
export function appendToSection(content: string, marker: string, logLine: string): string {
  const lines = content.split('\n')
  const start = lines.findIndex(l => l.trimEnd() === marker)

  if (start === -1) {
    const sep = content.endsWith('\n') ? '' : '\n'
    return `${content}${sep}\n${marker}\n\n${logLine}\n`
  }

  // The section ends at the next `## ` heading, or at EOF.
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  // Back up over the section's trailing blank lines so the entry lands directly
  // under the last existing entry rather than after the separator.
  let insertAt = end
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt--

  lines.splice(insertAt, 0, logLine)
  return lines.join('\n')
}

// ── mutations ────────────────────────────────────────────────────────────────

/**
 * Edit arbitrary frontmatter fields in place (no folder move); bumps `updated`.
 *
 * This is the ONE write funnel every caller (the API route, the CLI, every
 * lifecycle verb) shares, so it is where the validate-BEFORE-write gate lives
 * (TRDD-SCMPWF6R). The gate runs before the FIRST write — a refusal leaves the
 * file byte-identical, because nothing has touched it yet.
 *
 * That write is `atomicWriteSync` (tmp + rename), not `writeFileSync`, since
 * TRDD-7S27HJCS: an in-place truncate leaves a HALF-WRITTEN governance card if the
 * process dies between truncating and writing, and the lock this runs under does not
 * help — it stops two writers colliding, not one writer dying mid-write.
 */
export function editTrdd(
  designDir: string,
  id: string,
  fields: Record<string, string>,
  iso: string,
): Promise<TrddResult> {
  return withTrddLock(designDir, id, () => {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }

  // Validate the exact set of fields that will actually land on disk — including
  // `updated`, which this function always writes alongside the caller's edits, so
  // the guard's terminal-freeze exception for it (and its own date-shape check)
  // see the real write, not a partial view of it.
  const guard = validateTrddFieldEdits(
    { ...fields, updated: iso },
    trdd.frontmatter,
    (refId) => Boolean(findTrdd(designDir, refId)),
    trdd.zone,
  )
  if (!guard.ok) return { ok: false, error: guard.error, status: 400 }

  let content = fs.readFileSync(trdd.filePath, 'utf-8')
  for (const [k, v] of Object.entries(fields)) {
    content = setFrontmatterField(content, k, v)
  }
  content = setFrontmatterField(content, 'updated', iso)
  atomicWriteSync(trdd.filePath, content)
  return { ok: true, id: trdd.id, column: trdd.column, filePath: trdd.filePath }
  })
}

/**
 * Move a TRDD file between zone folders, preferring `git mv` (history-preserving).
 * Reports whether the rename went through git, because only then is the file in
 * the index and only then may its post-move edit be staged (see `stageMovedFile`).
 */
function moveZone(
  designDir: string,
  from: ParsedTrdd,
  toZone: TrddZone,
): { toPath: string; tracked: boolean } {
  const toDir = path.join(designDir, toZone)
  fs.mkdirSync(toDir, { recursive: true })
  const toPath = path.join(toDir, path.basename(from.filePath))
  const projectRoot = path.dirname(designDir)
  try {
    execFileSync('git', ['mv', from.filePath, toPath], { cwd: projectRoot, stdio: 'pipe' })
    return { toPath, tracked: true }
  } catch {
    // Untracked file, or not a git repo — plain rename still moves it (no data loss).
    fs.renameSync(from.filePath, toPath)
    return { toPath, tracked: false }
  }
}

/**
 * Re-stage a file that `moveZone` moved and `editAt` then rewrote.
 *
 * `git mv` renames the INDEX ENTRY: it carries over the blob already staged for
 * the old path (HEAD's, since nothing was staged) and never re-reads the working
 * tree. Every lifecycle verb below moves BEFORE it edits, so the content change
 * lands in the working tree only — unstaged, by construction, on every call. A
 * caller that then commits the index records a `rename (100%)` carrying none of
 * the edit. That has bitten this corpus three times; the durable fix belongs here,
 * not in the discipline of whoever commits next.
 *
 * Only ever called when `git mv` succeeded, so this updates an entry git already
 * tracks. It must never begin tracking a file git was not following: an untracked
 * TRDD is an anomaly for the caller to notice, not for this module to silently
 * resolve by adding it to someone's next commit.
 */
function stageMovedFile(designDir: string, filePath: string): void {
  try {
    execFileSync('git', ['add', '--', filePath], {
      cwd: path.dirname(designDir),
      stdio: 'pipe',
    })
  } catch {
    // The move and the edit both succeeded; the file on disk is correct. A failed
    // `git add` leaves the edit unstaged — never fail the transition over it.
  }
}

/**
 * Run `fn` holding the TRDD's identity lock (TRDD-D7KVF4HQ).
 *
 * WHY EVERY VERB BELOW IS ASYNC. Design folders are symlinked between agents
 * working the same project, so N agents in N processes edit one corpus, and until
 * this landed nothing serialised them. The cross-process lock (`withJsonLock`, a
 * `mkdir` lock DIRECTORY) is async, and `lib/file-lock.ts::withLock` — the sync-ish
 * alternative — is a PROCESS-LOCAL Map+Set that its own header (REG-MIN-05)
 * documents as no protection against exactly this. A sync `mkdirSync` spin-wait was
 * considered and REJECTED: it blocks the Node event loop for the whole process, and
 * three of these callers are server route handlers.
 *
 * WHY THE LOCK WRAPS THE WHOLE VERB, `findTrdd` INCLUDED. A lifecycle transition is
 * find → `git mv` → edit → stage, and those must be ONE atomic unit: a peer that
 * moves the card between our find and our move leaves us editing a path that no
 * longer holds it. Locking only the write would serialise the harmless half.
 *
 * WHY THE KEY IS THE ID AND NOT THE PATH. The verb MOVES the file, so a path-keyed
 * lock is taken on `proposals/X.md` by one writer and `tasks/X.md` by another — two
 * locks, zero exclusion, both looking correct from inside. See `documentLockKey`.
 */
/**
 * The lock key for one TRDD, from any spelling of its id.
 *
 * EXPORTED so a test can compare it against the one `trddgrep edit` computes through
 * `documentLockKeyFor`. That comparison cannot be written any other way: an expectation
 * that RE-IMPLEMENTS the normalization passes with the normalization deleted (measured —
 * the first version of that test did exactly this and its neuter reddened nothing).
 *
 * NORMALIZE, or the key depends on how the CALLER happened to spell the id. Lookups here
 * are case-INSENSITIVE and legacy lowercase ids are permanently valid (the IND base: they
 * are cited in immutable commit subjects, and were measured at 76% of one live board), so
 * `abcd1234` and `ABCD1234` reach the SAME card and without this produce two lock
 * directories. That also makes this byte-identical to the CLI's key, which is what stops
 * `trddgrep edit` and the API routes from racing on one document.
 *
 * ⚠ THE CASE VARIANT IS INVISIBLE ON macOS AND REAL ON LINUX. APFS is case-INSENSITIVE, so
 * `mkdir .trdd-lock-abcd1234` beside an existing `.trdd-lock-ABCD1234` returns EEXIST and
 * the two keys accidentally collide into one working lock — verified with a bare `mkdir`.
 * On ext4 they are two directories and two writers proceed at once. So a behavioural test
 * of this on a dev Mac cannot fail, and its passing says nothing about CI. That is why the
 * guard is pinned on the KEY rather than on an observed block.
 */
export function trddLockKey(designDir: string, id: string): string {
  return documentLockKey(designDir, 'trdd', TRDD_KIND.normalizeId(id))
}

/**
 * EXPORTED so a CALLER can widen the critical section to include the DECISION that
 * authorised the write (TRDD-6D6SQNI6) — the verbs below lock their own write, which
 * does not cover an authorization computed before the verb was ever called.
 *
 * Nesting this is safe, and that is a MEASURED fact rather than a reading: `withJsonLock`
 * is reentrant through an `AsyncLocalStorage` held-set keyed on the exact lock-key string,
 * and `trddLockKey` NORMALIZES the id — so an outer acquisition here and the inner one
 * inside every verb collapse to one string and the inner call runs directly instead of
 * waiting on a lock its own chain already holds. Measured both arms: a nested re-acquire
 * completes, and a SIBLING async context on the same key blocks until release (without
 * that second arm, the first passes just as well against a lock that excludes nobody).
 */
export function withTrddLock<T>(designDir: string, id: string, fn: () => T | Promise<T>): Promise<T> {
  return withJsonLock(trddLockKey(designDir, id), async () => fn())
}


/**
 * The on-touch migration the approval rules mandate: `approval-tier: N` (retired) →
 * `min-approval-requirement: <title>` (TRDD-I8UC56GZ).
 *
 * WHY ON TOUCH AND NOT IN `trddgrep fix`. The rule says migrate "on next touch, never in
 * a mass rewrite", and `fix` is exactly a mass rewrite — it sweeps the whole corpus. So
 * the migration lives on the WRITE paths instead: a card being transitioned is, by
 * definition, being touched. 82 cards carried the legacy field at the time this landed
 * and they migrate one at a time, as work reaches them, which is what the rule asks for.
 *
 * It REFUSES the ambiguous case rather than guessing. Both fields present and
 * DISAGREEING is `APPROVAL-FIELD-CONFLICT`, an ERROR the doctor marks non-autofixable
 * precisely because picking a side silently would hand two readers different required
 * approvers for the same card; an undecodable number is left for a human. Only the two
 * unambiguous shapes are rewritten: a lone legacy number, and a pair that already agree.
 *
 * `updated:` is deliberately NOT bumped by this — it changes no fact the card asserts,
 * only the spelling of one, and the board sorts on `updated:`.
 */
export function migrateLegacyApprovalTier(content: string): { content: string; migrated: string | null } {
  const end = content.indexOf('\n---', 4)
  if (!content.startsWith('---') || end < 0) return { content, migrated: null }
  const head = content.slice(0, end)
  const tierLine = head.match(/^approval-tier:[ \t]*(.*)$/m)
  if (!tierLine) return { content, migrated: null }
  const decoded = TIER_TO_REQUIREMENT[tierLine[1].trim()]
  if (!decoded) return { content, migrated: null }
  const declared = (head.match(/^min-approval-requirement:[ \t]*(.*)$/m)?.[1] ?? '').trim()
  if (declared && declared !== decoded) return { content, migrated: null }

  // Drop the legacy line, keeping the rest of the block byte-identical.
  let next = content.replace(/^approval-tier:[ \t]*.*\n/m, '')
  if (!declared) next = setFrontmatterField(next, 'min-approval-requirement', decoded)
  return { content: next, migrated: decoded }
}

function editAt(filePath: string, edits: Array<[string, string]>, logLine: string): void {
  let content = fs.readFileSync(filePath, 'utf-8')
  content = migrateLegacyApprovalTier(content).content
  for (const [k, v] of edits) content = setFrontmatterField(content, k, v)
  content = appendApprovalLog(content, logLine)
  atomicWriteSync(filePath, content)
}

/**
 * Reverse a {@link moveZone}. Called only when the edit that was supposed to follow it
 * failed, so the card does not stay in a zone whose column it never got.
 *
 * Best-effort by construction: if the reversal itself fails there is nothing further this
 * process can do, and the ORIGINAL error is the one worth propagating.
 */
function undoMoveZone(designDir: string, fromPath: string, toPath: string, tracked: boolean): void {
  const projectRoot = path.dirname(designDir)
  try {
    if (tracked) execFileSync('git', ['mv', toPath, fromPath], { cwd: projectRoot, stdio: 'pipe' })
    else fs.renameSync(toPath, fromPath)
  } catch {
    // `git mv` can refuse for reasons a plain rename does not care about; the file being
    // back in its old zone matters more than the index entry, which a later status shows.
    try {
      fs.renameSync(toPath, fromPath)
    } catch {
      /* nothing left to try — the caller's error is the real failure */
    }
  }
}

/**
 * `editAt` on a file `moveZone` has ALREADY moved — restoring the move if the edit throws.
 *
 * Every lifecycle verb moves the file BEFORE rewriting its frontmatter, and
 * `setFrontmatterField` now THROWS on a card with no usable `---` fence — a shape that
 * demonstrably occurs, since `trdd-doctor` carries a repair for it ("added a full
 * frontmatter (was: none)"). Without this compensation the throw escaped the lock AND the
 * route (no try/catch at `approve/route.ts:67`): the API 500'd, and the card was left in
 * the NEW zone still declaring its OLD column, with the rename staged. Every retry then
 * failed the zone guard — "Only a proposal can be approved; X is in tasks" — permanently,
 * so a merely malformed card became unrecoverable without a hand edit.
 *
 * A partial mutation that reports failure is recoverable; one that leaves the store in a
 * state no retry can reach is not.
 */
function editAfterMove(
  designDir: string,
  originalPath: string,
  newPath: string,
  tracked: boolean,
  edits: Array<[string, string]>,
  logLine: string,
): void {
  try {
    editAt(newPath, edits, logLine)
  } catch (err) {
    undoMoveZone(designDir, originalPath, newPath, tracked)
    throw err
  }
}

/**
 * The retired `approval-tier: N` decoded to the ladder title, for the LOG LINE
 * only (never written as a card field). An absent requirement emits nothing — the
 * log records what the card DECLARED, not the authz default of `manager`.
 */
const LEGACY_TIER_LABEL: Record<string, string> = { '0': 'none', '1': 'chief-of-staff', '2': 'manager', '3': 'user' }
function minApprovalSuffix(fm: Record<string, unknown>): string {
  const raw = fm['min-approval-requirement']
  let label = typeof raw === 'string' ? raw.trim() : ''
  if (!label) {
    const legacy = fm['approval-tier']
    const key = typeof legacy === 'number' ? String(legacy) : typeof legacy === 'string' ? legacy.trim() : ''
    label = LEGACY_TIER_LABEL[key] ?? ''
  }
  return label ? ` (min-approval-requirement: ${label})` : ''
}

/** APPROVE / PROMOTE a proposal → planned (git mv proposals/ → tasks/). */
export function promoteTrdd(
  designDir: string,
  id: string,
  opts: { approver: string; rationale?: string; iso: string; approvalToken?: string | null },
): Promise<TrddResult> {
  return withTrddLock(designDir, id, () => {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  if (trdd.zone !== 'proposals') {
    return { ok: false, error: `Only a proposal can be approved; ${trdd.id} is in ${trdd.zone}`, status: 409 }
  }
  const { toPath: newPath, tracked } = moveZone(designDir, trdd, 'tasks')
  // Record the card's approval requirement by its TITLE, never the retired numeric
  // tier (MANAGER ruling ai-maestro#65-B1/#69; ai-maestro#66 Q9 — the read side
  // lib/trdd-authz.ts already speaks the title ladder; this is the write side).
  const reqStr = minApprovalSuffix(trdd.frontmatter)

  // The APPROVAL RECORD the governance rules define (`approved:` / `approval-judge:`
  // / `approval-datetime:`), plus `approval-token:` — the id of the host-signed,
  // ledger-anchored token that makes the decision VERIFIABLE rather than merely
  // written down (ai-maestro#47). Every one of these fields is forgeable prose on
  // its own; the token is the one thing that is not, and it is what a reader should
  // check. The prose stays because humans read it.
  const fields: Array<[string, string]> = [
    ['column', 'planned'],
    ['updated', opts.iso],
    ['approved', 'true'],
    ['approval-judge', opts.approver],
    ['approval-datetime', opts.iso],
  ]
  if (opts.approvalToken) fields.push(['approval-token', opts.approvalToken])

  editAfterMove(
    designDir,
    trdd.filePath,
    newPath,
    tracked,
    fields,
    `- ${opts.iso} — APPROVED by ${opts.approver}${reqStr}. ${opts.rationale ?? 'promoted proposal → planned'}.` +
      (opts.approvalToken
        ? ` Verifiable: approval-token ${opts.approvalToken} (aimaestro-trdd.sh verify ${trdd.id}).`
        : ''),
  )
  if (tracked) stageMovedFile(designDir, newPath)
  return { ok: true, id: trdd.id, from: 'proposals', to: 'tasks', column: 'planned', filePath: newPath }
  })
}

/** REFUSE a proposal → refused (git mv proposals/ → refused/). */
export function refuseTrdd(
  designDir: string,
  id: string,
  opts: { approver: string; reason?: string; iso: string },
): Promise<TrddResult> {
  return withTrddLock(designDir, id, () => {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  if (trdd.zone !== 'proposals') {
    return { ok: false, error: `Only a proposal can be refused; ${trdd.id} is in ${trdd.zone}`, status: 409 }
  }
  const { toPath: newPath, tracked } = moveZone(designDir, trdd, 'refused')
  const reqStr = minApprovalSuffix(trdd.frontmatter)
  editAfterMove(
    designDir,
    trdd.filePath,
    newPath,
    tracked,
    [['column', 'refused'], ['updated', opts.iso]],
    `- ${opts.iso} — REFUSED by ${opts.approver}${reqStr}. ${opts.reason ?? 'refused at proposal gate'}.`,
  )
  if (tracked) stageMovedFile(designDir, newPath)
  return { ok: true, id: trdd.id, from: 'proposals', to: 'refused', column: 'refused', filePath: newPath }
  })
}

/**
 * Strip a `TRDD-` prefix, upcase, and take the first 8 chars — the corpus-wide join key.
 * Re-derived locally (not imported from `./trdd-graph`) to avoid a store→graph→store
 * cycle: `trdd-graph.ts` imports THIS module to read the corpus (same reason
 * `trdd-edit-guard.ts` re-derives its own trivial ref-parsing instead of importing it).
 */
function normalizeBlockerRef(ref: string): string {
  return ref.trim().replace(/^TRDD-/i, '').toUpperCase().slice(0, 8)
}

/** Parsed `blocked-by:` value (array or scalar string) → normalized ids, `[]` on empty/null. */
function blockedByRefs(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => normalizeBlockerRef(String(x))).filter(Boolean)
  if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null') return [normalizeBlockerRef(v)]
  return []
}

// This module's private day-part-read and other-park-form helpers MOVED to
// lib/trdd-vocabulary.ts's `frontmatterDay` and `isParkedByOtherForm` (TRDD-4P798U6P). They
// were re-derived here as private copies because this module imports FROM `trdd-doctor.ts`
// (the other-park-form check mirrored the doctor's own PARKED predicate from TRDD-CV5KDCB7),
// so importing the doctor's versions back would have closed a store->doctor->store cycle;
// both now live in the leaf vocabulary module both files already import from, so there is
// exactly one copy of each.

/** ADVANCE an in-flight TRDD's column within tasks/ (no folder move); bumps `updated`. */
export function advanceColumn(
  designDir: string,
  id: string,
  column: string,
  opts: { iso: string; note?: string; approver?: string; clearBlocker?: boolean },
): Promise<TrddResult> {
  return withTrddLock(designDir, id, () => {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  if (trdd.zone !== 'tasks') {
    return { ok: false, error: `Only an open (tasks/) TRDD can be advanced; ${trdd.id} is in ${trdd.zone}`, status: 409 }
  }
  // TRDD-ISGUYYLN: moving OUT of `blocked` used to leave `blocked-by:` populated, so the
  // board invariant (`blocked-by` non-empty <=> `column: blocked`) broke the instant the
  // card left. This verb owns BOTH halves of that transition — set the column AND clear
  // the reason — the same way every other advanceColumn caller expects. Refuse by default
  // when a named blocker is still open or unresolvable (moving on would assert the card is
  // workable when it is not); `clearBlocker` is the explicit override.
  let clearBlockedBy = false
  if (trdd.column === 'blocked' && column !== 'blocked') {
    const refs = blockedByRefs(trdd.frontmatter?.['blocked-by'])
    if (refs.length > 0) {
      if (opts.clearBlocker) {
        clearBlockedBy = true
      } else {
        const stillOpen = refs.filter((ref) => {
          const blocker = findTrdd(designDir, ref)
          return !blocker || !SHIPPED.has(blocker.column)
        })
        if (stillOpen.length > 0) {
          return {
            ok: false,
            error: `Cannot leave blocked — still open or unresolvable: ${stillOpen.join(', ')} (use --clear-blocker to override)`,
            status: 409,
          }
        }
        clearBlockedBy = true
      }
    }
  }
  // THE COLUMN IS VALIDATED HERE, not only in the callers (TRDD-I8UC56GZ). This verb
  // never moves folders, so an unvalidated column reaches disk two ways that both look
  // like success: a value outside the ratified vocabulary, and a terminal value that
  // belongs in archived/ and would sit in tasks/ instead — the ZONE-MISMATCH the doctor
  // reports as an ERROR. Guarding the store rather than the CLI covers the HTTP callers
  // for free, which is the whole reason it is here and not in trddgrep.
  if (!VALID_COLUMNS.includes(column)) {
    return { ok: false, error: `Invalid column "${column}" — not one of the ratified values`, status: 400 }
  }
  const wantZone = expectedZone(column, trdd.frontmatter ?? {})
  if (wantZone && wantZone !== 'tasks') {
    return {
      ok: false,
      error: `Column "${column}" belongs in design/${wantZone}/, not tasks/ — advance does not move folders; use the promote/refuse/archive verb for that transition`,
      status: 409,
    }
  }
  // TRDD-1G8FBSKZ: entering `blocked` must be EARNED — 3P-KAN-06 makes `blocked-by`
  // non-empty <=> `column: blocked`, and the move-in side enforced nothing, so a
  // card could park with `blocked-by: []` and no restore point (measured: committed
  // that way after an empty-variable parse, then flagged BLOCKED-NO-RESTORE-POINT by
  // the doctor). Sibling of the ISGUYYLN block above, which owns the EXIT side of
  // this same invariant on this same function.
  let setPreBlockColumn = ''
  if (column === 'blocked') {
    const enteringRefs = blockedByRefs(trdd.frontmatter?.['blocked-by'])
    const now = new Date()
    const todayDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (enteringRefs.length === 0 && !isParkedByOtherForm(trdd.frontmatter ?? {}, todayDay)) {
      return {
        ok: false,
        error:
          '3P-KAN-06: cannot move into blocked — `blocked-by` is empty and no other park form ' +
          '(a future `review-after:`, or a `hub-blocked`/`fleet-ask` label) is present. ' +
          'Set `blocked-by` (or one of those) first, then move.',
        status: 409,
      }
    }
    // A card already blocked (re-parking after an edit) keeps its existing restore
    // point — never overwrite a non-empty `pre-block-column` with the column it is
    // ALREADY in (`blocked`), which would erase the real place to put it back.
    if (trdd.column !== 'blocked') {
      const existing = String(trdd.frontmatter?.['pre-block-column'] ?? '').trim()
      if (existing === '') {
        setPreBlockColumn = trdd.column
      }
    }
  }
  let content = fs.readFileSync(trdd.filePath, 'utf-8')
  // The same on-touch migration `editAt` runs — advanceColumn writes its own frontmatter
  // rather than going through it, and a migration that fires on three of the four
  // transition verbs is the drift this repo keeps finding in pairs of near-identical paths.
  content = migrateLegacyApprovalTier(content).content
  content = setFrontmatterField(content, 'column', column)
  content = setFrontmatterField(content, 'updated', opts.iso)
  if (setPreBlockColumn) {
    content = setFrontmatterField(content, 'pre-block-column', setPreBlockColumn)
  }
  let clearNote = ''
  if (clearBlockedBy) {
    content = setFrontmatterField(content, 'blocked-by', '[]')
    if (trdd.frontmatter?.['pre-block-column'] !== undefined) {
      content = setFrontmatterField(content, 'pre-block-column', '')
    }
    clearNote = opts.clearBlocker
      ? ' Cleared blocked-by (--clear-blocker override).'
      : ' Cleared blocked-by (all blockers terminal).'
  }
  if (opts.note || opts.approver) {
    const who = opts.approver ? ` by ${opts.approver}` : ''
    content = appendApprovalLog(
      content,
      `- ${opts.iso} — column → ${column}${who}. ${opts.note ?? ''}${clearNote}`.trimEnd(),
    )
  }
  atomicWriteSync(trdd.filePath, content)
  return { ok: true, id: trdd.id, column, filePath: trdd.filePath }
  })
}

/**
 * The columns that live in `design/archived/`, per `expectedZone`.
 *
 * `complete` is HERE (TRDD-I8UC56GZ). It was missing, and the gap was silent: a caller
 * asking for `complete` on a `release-via: none` card could only reach `advanceColumn`,
 * which never moves folders — so the card sat terminal in `design/tasks/`, which IS the
 * definition of open work, and the open count became a lie. The alternative the shape
 * invited was worse: renaming `complete` → `completed` on the way in, the dual write
 * 3P-ZON-05 was amended to kill after it was measured drifting 232 times fleet-wide.
 *
 * `expectedZone` remains the arbiter of WHETHER a given card archives — `complete` with
 * `release-via: publish` still has stages ahead of it and stays in tasks/. This list is
 * only which column VALUES the archive verb will write.
 */
export type ArchiveState = 'complete' | 'completed' | 'cancelled' | 'superseded' | 'published' | 'live'

/**
 * The archive states that assert the work was FINISHED, and so must prove it with a
 * complete acceptance checklist. `cancelled` and `superseded` are exempt, matching the
 * linter exactly: open boxes are what those columns MEAN, and demanding a finished
 * checklist from abandoned or overtaken work would make honest closure impossible.
 */
const CHECKLIST_GATED_STATES: ReadonlySet<string> = new Set(['complete', 'completed', 'published', 'live'])


/**
 * SET one frontmatter field, under the document lock, through the same candidate gate
 * `trddgrep edit` is judged by (TRDD-I8UC56GZ).
 *
 * WHY THIS EXISTS. Before it, changing a field meant `trddgrep edit --at-line N --expect
 * … --replace …` — a LINE NUMBER standing in for the field you meant. The staleness
 * guard makes that safe against a moved line, but nothing makes it safe against a field
 * that is simply ABSENT: the card this very session hand-authored was patched twice with
 * a regex anchored on a `created-by:` line it did not have, both inserts failed SILENTLY,
 * and the card then claimed a state it did not carry. `setFrontmatterField` inserts a
 * missing field rather than matching nothing, so the no-op shape cannot occur.
 *
 * `column` is REFUSED here on purpose. A column change is half of a transition — the
 * other half is the zone `git mv` — and a verb that wrote one without the other is how a
 * card ends terminal in the OPEN zone. `moveTrdd` owns that, and pointing at it is more
 * use than performing half of it.
 *
 * `bump` defaults TRUE: a field set changes what the card ASSERTS, and the board sorts on
 * `updated:`. A mechanical repair (a re-spelling that changes no fact) passes false, the
 * same mechanical/semantic split the doctor's fixer already reports.
 */
export function setTrddField(
  designDir: string,
  id: string,
  field: string,
  value: string,
  opts: { iso: string; bump?: boolean } = { iso: isoLocal().iso },
): Promise<TrddResult> {
  return withTrddLock(designDir, id, () => {
    const trdd = findTrdd(designDir, id)
    if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
    if (field === 'column') {
      return {
        ok: false,
        status: 409,
        error: 'refusing to set `column:` directly — a column change is half of a transition, and writing it without the zone `git mv` is how a card ends terminal in the OPEN zone. Use `trddgrep move <id> <column>`',
      }
    }
    // A newline in the value would write ARBITRARY frontmatter — `parent: "X\nmandate:
    // true"` forges the exact approval record the zone routing exists to gate. The same
    // guard createTrdd carries, for the same reason, on the other write path.
    if (/[\r\n\u0000-\u001f]/.test(value) || /[\r\n\u0000-\u001f:\s]/.test(field)) {
      return { ok: false, status: 400, error: 'field and value must be one line, and a field name carries no colon or whitespace' }
    }
    // ONE read, held as `before`. The first version re-read the file for the gate's
    // "before" side — harmless inside the lock (no other writer) but it made the
    // comparison look like it might be against a different state than the one edited.
    const before = fs.readFileSync(trdd.filePath, 'utf-8')
    let content = migrateLegacyApprovalTier(before).content
    content = setFrontmatterField(content, field, value)
    if (opts.bump !== false) content = setFrontmatterField(content, 'updated', opts.iso)

    // THE SAME GATE, on the same bytes, inside the same lock. A setter that skipped it
    // would be a second write path with a second (absent) predicate — the drift this
    // card exists to remove.
    // WHAT THIS GATE DOES AND DOES NOT COVER, stated because "the same gate as edit" is
    // true and easy to over-read. It is the same PREDICATE, and that predicate polices
    // seven things: column, a pipeline value in status:, trdd-id shape, a colon in title,
    // the three ISO date fields, and min-approval-requirement. `set` can write ANY field,
    // so `severity: not-a-severity` lands — measured. Field-value vocabularies beyond
    // those seven are the doctor's to report, not this gate's to refuse.
    //
    // The "before" side is POST-migration, so a violation the migration itself introduced
    // would be invisible here. It cannot happen today — the migration only ever writes a
    // decoded ladder title, which the predicate accepts — so this is a latent coupling
    // worth naming, not a defect.
    const violations = introducedViolations(
      candidateFrontmatter(before.split('\n')),
      candidateFrontmatter(content.split('\n')),
      trdd.zone,
    )
    if (violations.length) {
      return { ok: false, status: 409, error: `refusing the set — it would introduce: ${violations.join('; ')}` }
    }
    atomicWriteSync(trdd.filePath, content)
    return { ok: true, id: trdd.id, column: trdd.column ?? '', filePath: trdd.filePath }
  })
}


/**
 * APPEND a line to a named `## ` section of a card's body, under the document lock.
 *
 * Body-only by construction: it never touches frontmatter, so the candidate gate has
 * nothing to judge and is not run — a gate that "passed" every body edit would be
 * decoration, and claiming one would be worse than having none. What IS enforced is the
 * heading shape and the one-line rule, because a `text` carrying a newline could open a
 * `---` fence and everything after it would read as a second frontmatter block.
 *
 * `updated:` is bumped by default for the same reason `set` bumps it: prose appended to a
 * card changes what the card asserts, and the board sorts on `updated:`.
 */
export function appendTrddSection(
  designDir: string,
  id: string,
  heading: string,
  text: string,
  opts: { iso: string; bump?: boolean },
): Promise<TrddResult> {
  return withTrddLock(designDir, id, () => {
    const trdd = findTrdd(designDir, id)
    if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
    const marker = heading.startsWith('## ') ? heading : `## ${heading}`
    if (/[\r\n\u0000-\u001f]/.test(text) || /[\r\n\u0000-\u001f]/.test(heading)) {
      return { ok: false, status: 400, error: 'the heading and the text must each be one line — a newline here could open a second `---` fence and everything after it would read as frontmatter' }
    }
    let content = fs.readFileSync(trdd.filePath, 'utf-8')
    content = appendToSection(content, marker, text)
    if (opts.bump !== false) content = setFrontmatterField(content, 'updated', opts.iso)
    atomicWriteSync(trdd.filePath, content)
    return { ok: true, id: trdd.id, column: trdd.column ?? '', filePath: trdd.filePath }
  })
}

/**
 * TICK (or untick) the Nth acceptance checkbox of a card, addressed by ORDINAL rather
 * than by line number.
 *
 * The line-number route works and is CAS-guarded — `edit --at-line 68 --expect '- [ ]'`
 * — but the caller must first FIND line 68, and the number it finds is a proxy for "the
 * first unchecked box". The terminal-column gate counts these boxes, so getting one wrong
 * is not cosmetic: it is the difference between a card that may archive and one that may
 * not.
 *
 * Fenced code is skipped, exactly as `countAcceptanceBoxes` skips it, so the ordinals
 * this verb accepts and the ones the gate counts are the same ordinals.
 */
export function checkTrddBox(
  designDir: string,
  id: string,
  ordinal: number,
  opts: { iso: string; check?: boolean; bump?: boolean },
): Promise<TrddResult> {
  return withTrddLock(designDir, id, () => {
    const trdd = findTrdd(designDir, id)
    if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
    const content = fs.readFileSync(trdd.filePath, 'utf-8')
    const lines = content.split('\n')
    const mark = opts.check === false ? ' ' : 'x'
    // ONE walker, shared with the terminal-column gate (lib/trdd-body.ts). The ordinal a
    // caller passes here and the count that gate makes are now the SAME traversal, so
    // they cannot drift into ticking one box while the gate counts another.
    const boxes = acceptanceBoxes(lines)
    const box = boxes[ordinal - 1]
    if (!box) {
      return { ok: false, status: 404, error: `no acceptance box ${ordinal} — the card has ${boxes.length} (fenced code is not counted, matching the terminal gate)` }
    }
    if (box.mark === mark) {
      return { ok: false, status: 409, error: `box ${ordinal} is already \`[${mark}]\` — refusing a write that changes nothing, because a no-op that reports success is how a card comes to claim a state it does not carry` }
    }
    lines[box.index] = `${box.prefix}${mark}${box.suffix}`
    let next = lines.join('\n')
    if (opts.bump !== false) next = setFrontmatterField(next, 'updated', opts.iso)
    atomicWriteSync(trdd.filePath, next)
    return { ok: true, id: trdd.id, column: trdd.column ?? '', filePath: trdd.filePath }
  })
}

/** ARCHIVE a once-approved TRDD → an archived column (git mv → archived/). */
export function archiveTrdd(
  designDir: string,
  id: string,
  opts: {
    approver: string
    state: ArchiveState
    reason?: string
    supersededBy?: string
    iso: string
    clearBlocker?: boolean
  },
): Promise<TrddResult> {
  return withTrddLock(designDir, id, async () => {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  // A refused proposal is terminal in refused/; only proposals/ or tasks/ archive —
  // EXCEPT the one terminal-to-terminal edit IND base step 12 explicitly permits:
  // complete/completed → superseded on a card ALREADY in archived/. Step 12 says a
  // terminal card's body is frozen except `updated:` and, when superseding,
  // `superseded-by:` — and every terminal column archives AS ITSELF, so this is a
  // COLUMN edit with NO zone move, not a second archive. Before this branch nothing
  // in the store could reach it: `archiveTrdd` refused outright ("already terminal"),
  // `editTrdd`/`set` refuses a bare `column` edit as "half a transition" (the guard's
  // FROZEN_ALLOWED_FIELDS omits it on purpose). A checklist-less terminal card could
  // then never be superseded through the sanctioned write path (TRDD-MUB7NTRF).
  if (trdd.zone === 'archived' && opts.state === 'superseded') {
    // `published`/`live`/`failed` are release-pipeline statements — force-superseding
    // one is NON-EXEMPT (PRRD R-Y) and routes through the approval flow, never a bare
    // CLI move. (`failed` cards live in tasks/, not archived/, but a drifted corpus
    // could still carry one here, so the check is column-based, not zone-based.)
    const RELEASE_PIPELINE_COLUMNS = new Set(['published', 'live', 'failed'])
    if (RELEASE_PIPELINE_COLUMNS.has(trdd.column ?? '')) {
      return {
        ok: false,
        status: 409,
        error: `${trdd.id} is "${trdd.column}" — a release-pipeline statement, and force-superseding it is NON-EXEMPT (PRRD R-Y); route this through the approval flow instead of \`move\``,
      }
    }
    if (trdd.column !== 'complete' && trdd.column !== 'completed') {
      return {
        ok: false,
        status: 409,
        error: `${trdd.id} is "${trdd.column}" in archived/ — an in-place archived → superseded edit only covers a finished (complete/completed) card`,
      }
    }
    if (!opts.supersededBy) {
      return {
        ok: false,
        status: 409,
        error: `superseding an already-archived card needs --superseded-by naming its replacement`,
      }
    }
    if (!findTrdd(designDir, opts.supersededBy)) {
      return {
        ok: false,
        status: 404,
        error: `--superseded-by ${JSON.stringify(opts.supersededBy)} does not resolve to a TRDD under ${designDir}`,
      }
    }
    if (!opts.reason || !opts.reason.trim()) {
      return {
        ok: false,
        status: 409,
        error: `--reason is required — name the checklist gap (or other cause) this in-place supersede is closing`,
      }
    }
    editAt(
      trdd.filePath,
      [
        ['column', 'superseded'],
        ['updated', opts.iso],
        ['superseded-by', `[${opts.supersededBy}]`],
      ],
      `- ${opts.iso} — SUPERSEDED by ${opts.approver}. ${opts.reason} (in-place archived → superseded, no zone move — IND base step 12).`,
    )
    return { ok: true, id: trdd.id, from: 'archived', to: 'archived', column: 'superseded', filePath: trdd.filePath }
  }
  if (trdd.zone === 'archived' || trdd.zone === 'refused') {
    return { ok: false, error: `${trdd.id} is already terminal in ${trdd.zone}`, status: 409 }
  }
  // TRDD-XCQ9TDSK: `advanceColumn` (TRDD-ISGUYYLN) owns the leaving-`blocked`
  // invariant for every WORKING-column move, but a blocked card archiving straight
  // to a terminal column never went through it — `archiveTrdd` had no blocked-by
  // handling at all, so the card landed in archived/ still carrying `blocked-by:`,
  // and a terminal card's body is frozen (IND base step 12), so nothing could ever
  // repair it afterwards. `trddgrep validate` then raises GRAPH-DANGLING-BLOCKER on
  // a card no later edit can fix. Same contract as ISGUYYLN, copied rather than
  // shared (the card says extraction into a helper is not required): refuse while
  // a named blocker is still open or unresolvable, unless `clearBlocker` overrides;
  // otherwise clear it in THIS write, before the card leaves tasks/ for good.
  let clearBlockedBy = false
  if (trdd.column === 'blocked') {
    const refs = blockedByRefs(trdd.frontmatter?.['blocked-by'])
    if (refs.length > 0) {
      if (opts.clearBlocker) {
        clearBlockedBy = true
      } else {
const stillOpen = refs.filter((ref) => {
          const blocker = findTrdd(designDir, ref)
          return !blocker || !SHIPPED.has(blocker.column)
        })
        if (stillOpen.length > 0) {
          return {
            ok: false,
            error: `Cannot leave blocked — still open or unresolvable: ${stillOpen.join(', ')} (use --clear-blocker to override)`,
            status: 409,
          }
        }
        clearBlockedBy = true
      }
    }
  }
  // THE CHECKLIST GATE, ON THE WRITE PRIMITIVE (TRDD-I8UC56GZ). It existed only as
  // `rejectIncompleteChecklist` in lib/trdd-authz.ts — which returns a `NextResponse`,
  // so it is reachable from the HTTP route and from nothing else. `trddgrep move` would
  // therefore have archived cards the API refuses, and it gated only the literal string
  // `completed`, never `complete`/`published`/`live`, which the linter treats as the same
  // terminal claim. Guarding the primitive covers every caller, present and future — the
  // lesson this repo learned the other way round when a per-call-site guard could not see
  // a compensation path that wrote through the same function.
  //
  // The doctor is imported LAZILY because it imports this module: a top-level import
  // would close the cycle, while a call-time one runs long after both are loaded. Only
  // the body-grammar counter is taken from it.
  if (CHECKLIST_GATED_STATES.has(opts.state)) {
    const { countAcceptanceBoxes } = await import('./trdd-doctor')
    const boxes = countAcceptanceBoxes(trdd.body ?? '')
    if (boxes.total === 0) {
      return {
        ok: false,
        status: 409,
        error: `${trdd.id} has NO acceptance checklist, so archiving it as '${opts.state}' would record a completion that proves nothing: nothing states what the card promised or whether it delivered. Write the checklist first, then archive`,
      }
    }
    if (boxes.open > 0) {
      return {
        ok: false,
        status: 409,
        error: `${trdd.id} has ${boxes.open} of ${boxes.total} acceptance box(es) still unchecked — archiving it as '${opts.state}' would be a false completion. Either the work is not done, or an obsolete box must be struck through with its reason (never silently ticked)`,
      }
    }
  }
  const { toPath: newPath, tracked } = moveZone(designDir, trdd, 'archived')
  const edits: Array<[string, string]> = [['column', opts.state], ['updated', opts.iso]]
  if (opts.state === 'superseded' && opts.supersededBy) {
    edits.push(['superseded-by', `[${opts.supersededBy}]`])
  }
  let clearNote = ''
  if (clearBlockedBy) {
    edits.push(['blocked-by', '[]'])
    if (trdd.frontmatter?.['pre-block-column'] !== undefined) {
      edits.push(['pre-block-column', ''])
    }
    clearNote = opts.clearBlocker
      ? ' Cleared blocked-by (--clear-blocker override).'
      : ' Cleared blocked-by (all blockers terminal).'
  }
  editAfterMove(
    designDir,
    trdd.filePath,
    newPath,
    tracked,
    edits,
    `- ${opts.iso} — ${opts.state.toUpperCase()} by ${opts.approver}. ${opts.reason ?? `archived → ${opts.state}`}.${clearNote}`,
  )
  if (tracked) stageMovedFile(designDir, newPath)
  return { ok: true, id: trdd.id, from: trdd.zone, to: 'archived', column: opts.state, filePath: newPath }
  })
}
