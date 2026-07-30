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
  }
}

/** Find one TRDD by id across all four zones (case-insensitive), or null. */
export function findTrdd(designDir: string, id: string): ParsedTrdd | null {
  const want = id.toUpperCase()
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

/** Set (or insert) a single `field: value` line inside the `---` frontmatter. */
export function setFrontmatterField(content: string, field: string, value: string): string {
  const lines = content.split('\n')
  if (lines[0] !== '---') return content
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      end = i
      break
    }
  }
  if (end === -1) return content

  const re = new RegExp(`^${escapeRe(field)}:`)
  for (let i = 1; i < end; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${field}: ${value}`
      return lines.join('\n')
    }
  }
  // Not present — insert just before the closing fence.
  lines.splice(end, 0, `${field}: ${value}`)
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
  const marker = '## Approval log'
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
 * (TRDD-SCMPWF6R). The gate runs before the FIRST `fs.writeFileSync` — a refusal
 * leaves the file byte-identical, because nothing has touched it yet.
 */
export function editTrdd(
  designDir: string,
  id: string,
  fields: Record<string, string>,
  iso: string,
): TrddResult {
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
  )
  if (!guard.ok) return { ok: false, error: guard.error, status: 400 }

  let content = fs.readFileSync(trdd.filePath, 'utf-8')
  for (const [k, v] of Object.entries(fields)) {
    content = setFrontmatterField(content, k, v)
  }
  content = setFrontmatterField(content, 'updated', iso)
  fs.writeFileSync(trdd.filePath, content)
  return { ok: true, id: trdd.id, column: trdd.column, filePath: trdd.filePath }
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

function editAt(filePath: string, edits: Array<[string, string]>, logLine: string): void {
  let content = fs.readFileSync(filePath, 'utf-8')
  for (const [k, v] of edits) content = setFrontmatterField(content, k, v)
  content = appendApprovalLog(content, logLine)
  fs.writeFileSync(filePath, content)
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
): TrddResult {
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

  editAt(
    newPath,
    fields,
    `- ${opts.iso} — APPROVED by ${opts.approver}${reqStr}. ${opts.rationale ?? 'promoted proposal → planned'}.` +
      (opts.approvalToken
        ? ` Verifiable: approval-token ${opts.approvalToken} (aimaestro-trdd.sh verify ${trdd.id}).`
        : ''),
  )
  if (tracked) stageMovedFile(designDir, newPath)
  return { ok: true, id: trdd.id, from: 'proposals', to: 'tasks', column: 'planned', filePath: newPath }
}

/** REFUSE a proposal → refused (git mv proposals/ → refused/). */
export function refuseTrdd(
  designDir: string,
  id: string,
  opts: { approver: string; reason?: string; iso: string },
): TrddResult {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  if (trdd.zone !== 'proposals') {
    return { ok: false, error: `Only a proposal can be refused; ${trdd.id} is in ${trdd.zone}`, status: 409 }
  }
  const { toPath: newPath, tracked } = moveZone(designDir, trdd, 'refused')
  const reqStr = minApprovalSuffix(trdd.frontmatter)
  editAt(
    newPath,
    [['column', 'refused'], ['updated', opts.iso]],
    `- ${opts.iso} — REFUSED by ${opts.approver}${reqStr}. ${opts.reason ?? 'refused at proposal gate'}.`,
  )
  if (tracked) stageMovedFile(designDir, newPath)
  return { ok: true, id: trdd.id, from: 'proposals', to: 'refused', column: 'refused', filePath: newPath }
}

/** ADVANCE an in-flight TRDD's column within tasks/ (no folder move); bumps `updated`. */
export function advanceColumn(
  designDir: string,
  id: string,
  column: string,
  opts: { iso: string; note?: string; approver?: string },
): TrddResult {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  if (trdd.zone !== 'tasks') {
    return { ok: false, error: `Only an open (tasks/) TRDD can be advanced; ${trdd.id} is in ${trdd.zone}`, status: 409 }
  }
  let content = fs.readFileSync(trdd.filePath, 'utf-8')
  content = setFrontmatterField(content, 'column', column)
  content = setFrontmatterField(content, 'updated', opts.iso)
  if (opts.note || opts.approver) {
    const who = opts.approver ? ` by ${opts.approver}` : ''
    content = appendApprovalLog(content, `- ${opts.iso} — column → ${column}${who}. ${opts.note ?? ''}`.trimEnd())
  }
  fs.writeFileSync(trdd.filePath, content)
  return { ok: true, id: trdd.id, column, filePath: trdd.filePath }
}

/** ARCHIVE a once-approved TRDD → completed|cancelled|superseded (git mv → archived/). */
export function archiveTrdd(
  designDir: string,
  id: string,
  opts: {
    approver: string
    state: 'completed' | 'cancelled' | 'superseded'
    reason?: string
    supersededBy?: string
    iso: string
  },
): TrddResult {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  // A refused proposal is terminal in refused/; only proposals/ or tasks/ archive.
  if (trdd.zone === 'archived' || trdd.zone === 'refused') {
    return { ok: false, error: `${trdd.id} is already terminal in ${trdd.zone}`, status: 409 }
  }
  const { toPath: newPath, tracked } = moveZone(designDir, trdd, 'archived')
  const edits: Array<[string, string]> = [['column', opts.state], ['updated', opts.iso]]
  if (opts.state === 'superseded' && opts.supersededBy) {
    edits.push(['superseded-by', `[${opts.supersededBy}]`])
  }
  editAt(
    newPath,
    edits,
    `- ${opts.iso} — ${opts.state.toUpperCase()} by ${opts.approver}. ${opts.reason ?? `archived → ${opts.state}`}.`,
  )
  if (tracked) stageMovedFile(designDir, newPath)
  return { ok: true, id: trdd.id, from: trdd.zone, to: 'archived', column: opts.state, filePath: newPath }
}
