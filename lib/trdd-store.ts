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
 * This module never commits. It edits + git-mv's (staging the rename) and leaves
 * the caller to commit — matching the overlay's protocol (edit, git mv, commit).
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import matter from 'gray-matter'

export type TrddZone = 'proposals' | 'tasks' | 'archived' | 'refused'
export const TRDD_ZONES: readonly TrddZone[] = ['proposals', 'tasks', 'archived', 'refused']

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

// TRDD-<YYYYMMDD_HHMMSS±HHMM>-<ID8>-<slug>.md — the timestamp itself may contain
// a `-` (negative GMT offset), so extract the 8-char id positionally, not by
// naive `-`-split.
const TRDD_FILENAME_RE = /^TRDD-\d{8}_\d{6}[+-]\d{4}-([A-Za-z0-9]{8})-.+\.md$/

function idFromFilename(name: string): string | null {
  const m = name.match(TRDD_FILENAME_RE)
  return m ? m[1].toUpperCase() : null
}

// gray-matter (js-yaml) auto-parses an ISO-8601 frontmatter value into a JS Date.
// Normalize such a value back to an ISO string for the summary; leave a plain
// string as-is; anything else → null.
function toIsoOrNull(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v
  return null
}

function listZoneFiles(designDir: string, zone: TrddZone): string[] {
  const dir = path.join(designDir, zone)
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.md') && TRDD_FILENAME_RE.test(n))
      .map((n) => path.join(dir, n))
  } catch {
    return []
  }
}

export function parseTrddFile(filePath: string, zone: TrddZone): ParsedTrdd | null {
  const id = idFromFilename(path.basename(filePath))
  if (!id) return null
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
  let data: Record<string, unknown> = {}
  let content = ''
  try {
    const parsed = matter(raw)
    data = (parsed.data ?? {}) as Record<string, unknown>
    content = parsed.content ?? ''
  } catch {
    // Unparseable frontmatter — still expose the id/zone with empty fields rather
    // than dropping the file silently.
    data = {}
    content = raw
  }
  return {
    id,
    zone,
    filePath,
    column: typeof data.column === 'string' ? data.column : '',
    title: typeof data.title === 'string' ? data.title : '',
    frontmatter: data,
    body: content,
  }
}

/** Find one TRDD by id across all four zones (case-insensitive), or null. */
export function findTrdd(designDir: string, id: string): ParsedTrdd | null {
  const want = id.toUpperCase()
  for (const zone of TRDD_ZONES) {
    for (const file of listZoneFiles(designDir, zone)) {
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

  for (const zone of zones) {
    for (const file of listZoneFiles(designDir, zone)) {
      const t = parseTrddFile(file, zone)
      if (!t) continue
      if (wantId && t.id !== wantId) continue
      if (opts.column && t.column !== opts.column) continue
      if (kw) {
        const hay = `${t.title}\n${t.body}`.toLowerCase()
        if (!hay.includes(kw)) continue
      }
      out.push({
        id: t.id,
        zone: t.zone,
        column: t.column,
        title: t.title,
        filePath: t.filePath,
        updated: toIsoOrNull(t.frontmatter.updated),
        priority: t.frontmatter.priority,
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

/** Append one `## Approval log` entry (the log is the last section by convention). */
export function appendApprovalLog(content: string, logLine: string): string {
  const marker = '## Approval log'
  const sep = content.endsWith('\n') ? '' : '\n'
  if (content.includes(marker)) {
    return `${content}${sep}${logLine}\n`
  }
  return `${content}${sep}\n${marker}\n\n${logLine}\n`
}

// ── mutations ────────────────────────────────────────────────────────────────

/** Edit arbitrary frontmatter fields in place (no folder move); bumps `updated`. */
export function editTrdd(
  designDir: string,
  id: string,
  fields: Record<string, string>,
  iso: string,
): TrddResult {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }

  let content = fs.readFileSync(trdd.filePath, 'utf-8')
  for (const [k, v] of Object.entries(fields)) {
    content = setFrontmatterField(content, k, v)
  }
  content = setFrontmatterField(content, 'updated', iso)
  fs.writeFileSync(trdd.filePath, content)
  return { ok: true, id: trdd.id, column: trdd.column, filePath: trdd.filePath }
}

/** Move a TRDD file between zone folders, preferring `git mv` (history-preserving). */
function moveZone(designDir: string, from: ParsedTrdd, toZone: TrddZone): string {
  const toDir = path.join(designDir, toZone)
  fs.mkdirSync(toDir, { recursive: true })
  const toPath = path.join(toDir, path.basename(from.filePath))
  const projectRoot = path.dirname(designDir)
  try {
    execFileSync('git', ['mv', from.filePath, toPath], { cwd: projectRoot, stdio: 'pipe' })
  } catch {
    // Untracked file, or not a git repo — plain rename still moves it (no data loss).
    fs.renameSync(from.filePath, toPath)
  }
  return toPath
}

function editAt(filePath: string, edits: Array<[string, string]>, logLine: string): void {
  let content = fs.readFileSync(filePath, 'utf-8')
  for (const [k, v] of edits) content = setFrontmatterField(content, k, v)
  content = appendApprovalLog(content, logLine)
  fs.writeFileSync(filePath, content)
}

/** APPROVE / PROMOTE a proposal → planned (git mv proposals/ → tasks/). */
export function promoteTrdd(
  designDir: string,
  id: string,
  opts: { approver: string; tier?: number; rationale?: string; iso: string },
): TrddResult {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  if (trdd.zone !== 'proposals') {
    return { ok: false, error: `Only a proposal can be approved; ${trdd.id} is in ${trdd.zone}`, status: 409 }
  }
  const newPath = moveZone(designDir, trdd, 'tasks')
  const tierStr = opts.tier != null ? ` (tier ${opts.tier})` : ''
  editAt(
    newPath,
    [['column', 'planned'], ['updated', opts.iso]],
    `- ${opts.iso} — APPROVED by ${opts.approver}${tierStr}. ${opts.rationale ?? 'promoted proposal → planned'}.`,
  )
  return { ok: true, id: trdd.id, from: 'proposals', to: 'tasks', column: 'planned', filePath: newPath }
}

/** REFUSE a proposal → refused (git mv proposals/ → refused/). */
export function refuseTrdd(
  designDir: string,
  id: string,
  opts: { approver: string; tier?: number; reason?: string; iso: string },
): TrddResult {
  const trdd = findTrdd(designDir, id)
  if (!trdd) return { ok: false, error: 'TRDD not found', status: 404 }
  if (trdd.zone !== 'proposals') {
    return { ok: false, error: `Only a proposal can be refused; ${trdd.id} is in ${trdd.zone}`, status: 409 }
  }
  const newPath = moveZone(designDir, trdd, 'refused')
  const tierStr = opts.tier != null ? ` (tier ${opts.tier})` : ''
  editAt(
    newPath,
    [['column', 'refused'], ['updated', opts.iso]],
    `- ${opts.iso} — REFUSED by ${opts.approver}${tierStr}. ${opts.reason ?? 'refused at proposal gate'}.`,
  )
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
  const newPath = moveZone(designDir, trdd, 'archived')
  const edits: Array<[string, string]> = [['column', opts.state], ['updated', opts.iso]]
  if (opts.state === 'superseded' && opts.supersededBy) {
    edits.push(['superseded-by', `[${opts.supersededBy}]`])
  }
  editAt(
    newPath,
    edits,
    `- ${opts.iso} — ${opts.state.toUpperCase()} by ${opts.approver}. ${opts.reason ?? `archived → ${opts.state}`}.`,
  )
  return { ok: true, id: trdd.id, from: trdd.zone, to: 'archived', column: opts.state, filePath: newPath }
}
