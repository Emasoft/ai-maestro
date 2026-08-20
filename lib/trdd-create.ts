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
import { TRDD_ZONES, type TrddZone } from '@/lib/trdd-store'
import { AUTHORITY_RANK, VALID_COLUMNS } from '@/lib/trdd-vocabulary'

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

function isoNow(): { iso: string; stamp: string } {
  const d = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const offMin = -d.getTimezoneOffset()
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
  parent?: string
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
}

export function createTrdd(designDir: string, opts: CreateTrddOpts): CreateTrddResult {
  const title = (opts.title ?? '').trim()
  if (!title) throw new Error('title required')
  if (title.includes(':')) throw new Error('title must not contain a colon (grep-first frontmatter rule)')
  if (!TASK_TYPES.has(opts.taskType)) throw new Error(`task-type must be one of: ${[...TASK_TYPES].join(', ')}`)

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
    `current-owner: ${opts.author}`,
    `created-by: ${opts.author}`,
    `task-type: ${opts.taskType}`,
    `min-approval-requirement: ${minApproval}`,
  ]
  if (isMandate) {
    lines.push('mandate: true', `mandated-by: ${opts.authorAuthority}`, 'approved: true',
      `approval-judge: ${opts.author}`, `approval-datetime: ${iso}`)
  } else {
    lines.push('approved: false')
  }
  if (opts.parent) lines.push(`parent-trdd: ${opts.parent}`)
  if (opts.npt?.length) lines.push(`npt: [${opts.npt.join(', ')}]`)
  if (opts.eht?.length) lines.push(`eht: [${opts.eht.join(', ')}]`)
  lines.push('---', '', `# ${title}`, '')
  if (opts.body) lines.push(opts.body.trim(), '')
  lines.push('## Approval log', '')
  if (isMandate) {
    lines.push(`- ${iso} — MANDATE issued by ${opts.author} (min-approval-requirement: ${minApproval}). ` +
      'Pre-approved: issuer authority >= required approver. No approval request was sent.', '')
  }

  // Atomic: temp + rename, so a crash mid-write cannot leave a half-card the board parses.
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, lines.join('\n'), 'utf8')
  fs.renameSync(tmp, file)
  return { id, file, zone, column }
}
