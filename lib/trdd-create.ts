/**
 * Server-side TRDD minting (TRDD-40DYBI4T).
 *
 * The highest-frequency board mutation — authoring a card — had no server verb, so
 * every plugin agent hand-rolled the id mint, the collision check, the timestamps and
 * the frontmatter, and each copy drifted (wrong id alphabet, `ls`-glob collision
 * checks, TYPED timestamps: every one a recorded failure mode of this fleet).
 *
 * NEUTER RUNS (2026-08-20 — OBSERVED via scripts/dev/neuter, restore blob-verified):
 *   force isMandate=true → 1 red / 4 green: "an author BELOW the floor lands in proposals/"
 *   skip the idTaken consult → 1 red / 4 green: "a forced collision RE-ROLLS" (the first
 *   version of that test reddened NOTHING — RNG luck; hence the injectable mint seam)
 *
 * ONE function owns all four now, plus the piece a hand-rolled mint always skips:
 * ZONE ROUTING PER THE MANDATE RULE. A card whose `min-approval-requirement` exceeds
 * the author's authority lands in proposals/ as `column: proposal` — enforced AT MINT,
 * instead of detected by the D4 watchdog after the work already ran.
 */
import { randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { TRDD_ZONES, isoLocal, type TrddZone } from '@/lib/trdd-store'
import { AUTHORITY_RANK, VALID_COLUMNS, expectedZone } from '@/lib/trdd-vocabulary'

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' // 8-char UPPERCASE base36 — the canonical id

export function mintTrddId(): string {
  const bytes = randomBytes(8)
  let id = ''
  for (let i = 0; i < 8; i++) id += ID_ALPHABET[bytes[i] % 36]
  return id
}

/**
 * Every scope root that exists on this host — the collision check MUST scan all of
 * them (IND rule step 2): an id is one namespace across project/LOCAL/USER scopes.
 */
export function collisionRoots(projectDesignDir: string): string[] {
  const home = os.homedir()
  const slug = path.resolve(projectDesignDir, '..').replace(/[^a-zA-Z0-9]/g, '-')
  const roots = [
    projectDesignDir,
    path.join(home, '.claude', 'projects', slug, 'design'),
    path.join(home, '.claude', 'plugins', 'data', 'ai-maestro-janitor-ai-maestro-plugins', 'design'),
  ]
  return roots.filter((r) => fs.existsSync(r))
}

export function idTaken(id: string, roots: string[]): boolean {
  const needle = id.toUpperCase()
  for (const root of roots) {
    for (const zone of TRDD_ZONES) {
      const dir = path.join(root, zone)
      let entries: string[]
      try { entries = fs.readdirSync(dir) } catch { continue }
      // -iname semantics: case-insensitive, anywhere in the filename.
      if (entries.some((f) => f.toUpperCase().includes(needle))) return true
    }
  }
  return false
}

// The local-offset stamp moved to `trdd-store` (TRDD-S13L6R9R) so the five write routes
// and this module share ONE definition. It could not stay here: `trdd-store` writes every
// dated field, and importing it from `trdd-create` would have closed an import cycle.
const isoNow = () => isoLocal()

/**
 * The PROJECT-ID source: the PRRD's own frontmatter. The ai-maestro overlay
 * (rules/aimaestro/aimaestro-trdd-approval.md, "Scope discriminators") makes
 * `project-id:` the field that binds a `scope: project` card to a project board,
 * and nothing on the mint path wrote it — so every card this function minted was
 * unbindable (TRDD-8D9ZYZX9).
 *
 * Returns the id, or a REASON why not. Never throws and never refuses the mint:
 * trddgrep is installed globally and serves repos with no PRRD at all, so a
 * fail-fast here would be a fleet-wide regression.
 *
 * Why the shapes are this strict, rather than `(\S+)`: a loose capture SUCCEEDS
 * SILENTLY with a WRONG value, which is strictly worse than the absence it
 * replaces — a missing field is detectable, a wrong one binds every future card
 * to a board that does not exist. `project-id: "ai maestro"` would yield `"ai`,
 * a list `[a, b]` would yield `[a,`, and `foo:bar` would write a second colon
 * into a grep-first frontmatter line. So an unparseable value is reported as
 * unparseable, which is a more useful message than "absent" anyway.
 */
function readProjectId(designDir: string): { id: string } | { why: string } {
  const prrd = path.join(designDir, 'requirements', 'PRRD.md')
  let text: string
  try {
    text = fs.readFileSync(prrd, 'utf8')
  } catch {
    return { why: `no project-id: ${prrd} is unreadable or absent` }
  }
  // A UTF-8 BOM is invisible and would make the fence test below fail, minting
  // every card unbound against a PRRD that plainly carries the field.
  // Spelled by CODE POINT, never as a literal U+FEFF in this source: a literal BOM
  // here is invisible to every reviewer and every diff viewer, so a whitespace-
  // normalising pass could delete the very character being stripped and leave the
  // test green against a strip that no longer strips. The loop handles a doubled
  // BOM (a file prefixed twice by tooling), which a single strip would half-leave.
  const bom = String.fromCharCode(0xfeff)
  while (text.startsWith(bom)) text = text.slice(bom.length)
  // The fence must be `---` ALONE on its line. `indexOf('\n---')` also matches a
  // `----------` table border or an em-dash-led continuation INSIDE frontmatter,
  // truncating the search window and losing a field that is really there.
  const open = /^---[ \t]*\r?\n/.exec(text)
  // NOT a fixed slice(4): the opening fence is 4 chars only for a bare LF `---\n`.
  // `---\r\n` and `--- \n` are both legal and both shift every later index by one,
  // which would cut the first frontmatter line in half.
  if (!open) return { why: `no project-id: ${prrd} has no frontmatter` }
  const body = text.slice(open[0].length)
  const close = /^---[ \t]*$/m.exec(body)
  if (!close) return { why: `no project-id: ${prrd} frontmatter is unterminated` }
  const fm = body.slice(0, close.index)
  const all = [...fm.matchAll(/^project-id:[ \t]*(.*)$/gm)]
  if (all.length === 0) return { why: `no project-id: ${prrd} carries no project-id field` }
  // DUPLICATE KEY: refuse rather than pick one. A regex takes the FIRST; YAML
  // parsers disagree with each other (strict YAML 1.2 calls it an error, js-yaml
  // throws, permissive readers take the LAST), so any choice here binds cards on a
  // guess about which reader the author had in mind — and both values are
  // well-formed, so the value guard below cannot catch it. Same principle as the
  // unparseable branch: when the source is ambiguous, do not capture.
  if (all.length > 1) {
    return { why: `no project-id: ${prrd} carries ${all.length} project-id lines — ambiguous, so none is used` }
  }
  const raw = all[0][1].replace(/[ \t]+#.*$/, '').trim()
  // The same guard the frontmatter-injection review put on `author`/`assignee`: a
  // value with a colon or a control char breaks the grep-first `key: value` line.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw)) {
    return { why: `no project-id: ${prrd} has project-id but its value is unparseable (${JSON.stringify(raw.slice(0, 40))})` }
  }
  return { id: raw }
}

const TASK_TYPES = new Set(['feature', 'bugfix', 'refactor', 'docs', 'infra', 'security', 'artifact', 'spike', 'audit'])

export interface CreateTrddOpts {
  title: string
  taskType: string
  /** Starting column for a MANDATE (default backburner; live_auditing for audits). Ignored for proposals. */
  column?: string
  /** The approval floor the author declares (default none). */
  minApproval?: string
  /** The AUTHOR's authority rung (from their verified governance title; 'user' for the owner). */
  authorAuthority: string
  /** Who authored it (agent name or 'user') — current-owner + created-by. */
  author: string
  /**
   * The card's OWNER. Distinct from `author` (`created-by:`, authorship, set once) and
   * from `current-owner:` (the write lock): `assignee:` is who is DOING it, and the D4
   * watchdog asserts it is set on every card in tasks/ — its absence is the single
   * biggest source of META-MISSING on this corpus (TRDD-I8UC56GZ). Defaults to the
   * author for a mandate, and is omitted on a proposal, which has no owner until it is
   * approved and dispatched.
   */
  assignee?: string
  parent?: string
  /**
   * TRDD-O1ZW03DG box 1: the platelet invariant is `derived: true` ⟺ this id is
   * listed in exactly one parent's `npt:`/`eht:`. Optional (not required) because
   * `trddgrep.mjs new --parent` and this file's own pre-existing tests mint a
   * `parent-trdd:` with no kind — making it mandatory would break both without
   * touching either. Requires `parent` to be set; `parent`-less is a caller error.
   */
  derivedKind?: 'npt' | 'eht'
  npt?: string[]
  eht?: string[]
  body?: string
  /** Test seam ONLY: crypto RNG is not seedable, so proving "the mint CONSULTS the
   *  collision check" needs an injectable generator — a neuter that skipped the
   *  check reddened NOTHING against the RNG-luck version of the test. */
  mint?: () => string
}

export interface CreateTrddResult {
  id: string
  file: string
  zone: TrddZone
  column: string
  /**
   * Set ONLY when the card was minted WITHOUT `project-id:` — one line naming the
   * source that was missing. The mint still succeeded; this is a nag, not an error,
   * and the caller is what prints it (the CLI to stderr, the API route by returning
   * this object). Absent on a card that carries the field.
   */
  warning?: string
}

export function createTrdd(designDir: string, opts: CreateTrddOpts): CreateTrddResult {
  const title = (opts.title ?? '').trim()
  if (!title) throw new Error('title required')
  if (title.includes(':')) throw new Error('title must not contain a colon (grep-first frontmatter rule)')
  // FRONTMATTER INJECTION GUARD (commit security review, 2026-08-20): every string
  // interpolated into a `key: value` line below is one embedded newline away from
  // WRITING ARBITRARY FRONTMATTER — `parent: "X\nmandate: true"` would forge the
  // exact approval record the zone routing exists to gate. So: no control chars in
  // any frontmatter-bound string, and relationship ids must BE ids.
  if (/[\r\n\u0000-\u001f]/.test(title)) throw new Error('title must be one line')
  const author = (opts.author ?? '').trim()
  if (!author || /[\r\n\u0000-\u001f:]/.test(author)) throw new Error('author must be a one-line name without a colon')
  const idShape = /^[A-Za-z0-9]{8}$/
  for (const [field, val] of [['parent', opts.parent ? [opts.parent] : []], ['npt', opts.npt ?? []], ['eht', opts.eht ?? []]] as const) {
    for (const v of val) {
      if (!idShape.test(v)) throw new Error(`${field} entries must be 8-char base36 TRDD ids (got "${String(v).slice(0, 40)}")`)
    }
  }
  if (!TASK_TYPES.has(opts.taskType)) throw new Error(`task-type must be one of: ${[...TASK_TYPES].join(', ')}`)
  // TRDD-O1ZW03DG box 1: derived-at-birth. `derived-kind` is meaningless without a
  // parent (a fail-fast caller error, not a silent no-op) and its value is checked
  // at runtime because non-TS callers (the API route, the CLI) pass a plain string.
  if (opts.derivedKind !== undefined) {
    if (!opts.parent) throw new Error('derivedKind requires parent to be set')
    if (opts.derivedKind !== 'npt' && opts.derivedKind !== 'eht') {
      throw new Error(`derivedKind must be "npt" or "eht" (got "${String(opts.derivedKind).slice(0, 40)}")`)
    }
  }

  const minApproval = opts.minApproval ?? 'none'
  if (!(minApproval in AUTHORITY_RANK)) throw new Error(`min-approval-requirement must be one of: ${Object.keys(AUTHORITY_RANK).join(', ')}`)
  const authorRank = AUTHORITY_RANK[opts.authorAuthority]
  if (authorRank === undefined) throw new Error(`unknown author authority "${opts.authorAuthority}"`)

  // THE MANDATE RULE (aimaestro-trdd-approval Part B): authority(author) >= floor ⇒ a
  // self-approved mandate in tasks/; below the floor ⇒ a proposal awaiting the approver.
  const isMandate = authorRank >= AUTHORITY_RANK[minApproval]
  const zone: TrddZone = isMandate ? 'tasks' : 'proposals'
  const column = isMandate ? (opts.column ?? 'backburner') : 'proposal'
  if (isMandate && !VALID_COLUMNS.includes(column)) {
    throw new Error(`invalid starting column "${column}"`)
  }
  // ZONE-MISMATCH guard (TRDD-MWKCBLQN): VALID_COLUMNS admits bracket values
  // (proposal/refused/archived states), so a mandate author could otherwise mint
  // `column: proposal` straight into tasks/ — a card the doctor immediately flags
  // and every write verb refuses. `createTrdd` writes no `release-via`, so `{}` is
  // the correct frontmatter to check `complete` against.
  if (isMandate) {
    const wantZone = expectedZone(column, {})
    if (wantZone !== null && wantZone !== zone) {
      throw new Error(`column "${column}" belongs in zone "${wantZone}", not "${zone}"`)
    }
  }

  // Mint with a cross-scope collision check; re-roll on a hit. 36^8 makes a loop of
  // more than a couple of iterations a broken RNG, not bad luck — cap it loudly.
  const roots = collisionRoots(designDir)
  const mint = opts.mint ?? mintTrddId
  let id = ''
  for (let i = 0; i < 10; i++) {
    const candidate = mint()
    if (!idTaken(candidate, roots)) { id = candidate; break }
  }
  if (!id) throw new Error('could not mint a collision-free id in 10 tries — check the RNG')

  const { iso, stamp } = isoNow()
  const slugPart = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled'
  const dir = path.join(designDir, zone)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `TRDD-${stamp}-${id}-${slugPart}.md`)

  const lines = [
    '---',
    `trdd-id: ${id}`,
    `title: ${title}`,
    `column: ${column}`,
    `created: ${iso}`,
    `updated: ${iso}`,
    `current-owner: ${author}`,
    `created-by: ${author}`,
    `task-type: ${opts.taskType}`,
    `min-approval-requirement: ${minApproval}`,
  ]
  // TRDD-8D9ZYZX9: the scope discriminator. Emitted as a PAIR — `scope: project`
  // alone defaults anyway, but `project-id:` without it leaves the binding implicit,
  // and the overlay's rule is stated over the pair. Both are omitted together when
  // the PRRD cannot supply an id, so a card never claims a scope it cannot bind.
  const projectId = readProjectId(designDir)
  if ('id' in projectId) lines.push('scope: project', `project-id: ${projectId.id}`)
  const assignee = (opts.assignee ?? (isMandate ? author : '')).trim()
  if (assignee && /[\r\n\u0000-\u001f:]/.test(assignee)) {
    throw new Error('assignee must be a one-line name without a colon')
  }
  if (assignee) lines.push(`assignee: ${assignee}`)
  if (isMandate) {
    lines.push('mandate: true', `mandated-by: ${opts.authorAuthority}`, 'approved: true',
      `approval-judge: ${author}`, `approval-datetime: ${iso}`)
  } else {
    lines.push('approved: false')
  }
  if (opts.parent) lines.push(`parent-trdd: ${opts.parent}`)
  // The other half of the platelet invariant — this card is listed in the PARENT's
  // npt:/eht: — is NOT done here: createTrdd only ever writes the file it mints,
  // never touches a second file. Confirmed by reading the whole function above: no
  // parent-file read/write exists anywhere in this module.
  if (opts.derivedKind) lines.push('derived: true', `derived-kind: ${opts.derivedKind}`)
  if (opts.npt?.length) lines.push(`npt: [${opts.npt.join(', ')}]`)
  if (opts.eht?.length) lines.push(`eht: [${opts.eht.join(', ')}]`)
  lines.push('---', '', `# ${title}`, '')
  if (opts.body) lines.push(opts.body.trim(), '')
  lines.push('## Approval log', '')
  if (isMandate) {
    lines.push(`- ${iso} — MANDATE issued by ${author} (min-approval-requirement: ${minApproval}). ` +
      'Pre-approved: issuer authority >= required approver. No approval request was sent.', '')
  }

  // Atomic: temp + rename, so a crash mid-write cannot leave a half-card the board parses.
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, lines.join('\n'), 'utf8')
  fs.renameSync(tmp, file)
  return { id, file, zone, column, ...('why' in projectId ? { warning: projectId.why } : {}) }
}
