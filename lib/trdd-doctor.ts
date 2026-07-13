/**
 * TRDD doctor — the corpus linter + safe auto-repairer.
 *
 * WHY THIS EXISTS. On 2026-07-13 ten TRDDs were found sitting in `design/tasks/`
 * (the OPEN-work zone) with NO `column:` field — three carried the retired v1
 * `status:`, seven had no frontmatter at all. A card with no column cannot be
 * placed in any column, so it rendered nowhere and appeared in no count. Nobody
 * noticed for three months, because the failure mode of a missing field is not an
 * error — it is a SILENCE, and silence reads as "there is nothing there".
 *
 * The 3-pillars spec already promised a watchdog over exactly these invariants
 * (`rules/aimaestro/aimaestro-trdd-approval.md` §D4). This is it. It runs on the
 * files, needs no server, and is enforced by a test so the corpus cannot rot again.
 *
 * DESIGN — two rules that keep it honest:
 *
 *  1. ONE OWNER OF "WHAT IS A TRDD". Every read goes through `lib/trdd-store.ts`
 *     (listTrddFiles/parseTrddFile). A linter with its OWN parser would disagree
 *     with the store about which files exist, and then the two would drift — which
 *     is the same class of bug this file was written to catch.
 *
 *  2. AUTO-FIX ONLY WHAT IS DERIVABLE. A repair is allowed only when the correct
 *     value follows mechanically from evidence already on disk (the H1, git's first
 *     commit, the retired status field). Anything that requires JUDGEMENT — "is this
 *     work actually done?", "should this move zone?" — is REPORTED, never guessed.
 *     A doctor that guesses `complete` deletes real work from the board.
 *
 * THE UNCERTAINTY LAW (USER, 2026-07-13): "when in doubt, put it in todo."
 * A TRDD whose column cannot be determined gets `todo` — never `complete`, never a
 * silent omission. `todo` is the honest answer to "we do not know", and it keeps the
 * card VISIBLE, which is the only property that matters.
 */
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { TRDD_ZONES, type TrddZone, listTrddFiles, parseTrddFile } from './trdd-store'
import { DEFAULT_STATUSES } from '@/types/task'

/** The 17 ratified kanban columns, plus the lifecycle values that bracket them. */
export const BRACKET_COLUMNS = ['proposal', 'planned', 'refused', 'completed', 'cancelled'] as const
export const VALID_COLUMNS: readonly string[] = [...DEFAULT_STATUSES, ...BRACKET_COLUMNS]

/** Columns that mean "this work is finished and leaves the board". */
export const TERMINAL_DONE = ['complete', 'completed', 'published', 'live', 'cancelled', 'superseded']
/** Working columns — a card here is OPEN. `failed` is OPEN too: it is retryable. */
export const WORKING_COLUMNS = DEFAULT_STATUSES.filter(
  (c) => !['complete', 'published', 'live', 'superseded'].includes(c),
).concat('planned')

/** The authority ladder. A mandate is valid only if the issuer sits at or above the floor. */
export const AUTHORITY_RANK: Record<string, number> = {
  none: 0,
  orchestrator: 1,
  'chief-of-staff': 2,
  manager: 3,
  user: 4,
  maestro: 4, // the human owner, as this project names them
}

/** v1 `status:` → v2 `column:`. Only unambiguous mappings; anything else falls to `todo`. */
const STATUS_TO_COLUMN: Record<string, string> = {
  'not-started': 'todo',
  notstarted: 'todo',
  todo: 'todo',
  planned: 'planned',
  'in-progress': 'dev',
  inprogress: 'dev',
  doing: 'dev',
  blocked: 'blocked',
  done: 'complete',
  complete: 'complete',
  completed: 'complete',
}

export type Severity = 'error' | 'warn'

export interface Finding {
  rule: string
  severity: Severity
  id: string
  filePath: string
  message: string
  /** true when `fixCorpus` can repair it from evidence, with no judgement call. */
  autofixable: boolean
}

export interface DoctorReport {
  findings: Finding[]
  scanned: number
  errors: number
  warnings: number
}

interface Card {
  id: string
  zone: TrddZone
  filePath: string
  column: string
  title: string
  fm: Record<string, unknown>
  body: string
  raw: string
}

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []

const norm = (id: string) => id.trim().toUpperCase()

/**
 * Read every TRDD in every zone, through the store. A file the store cannot parse is
 * itself a finding — it must never be silently skipped, or the linter reproduces the
 * exact bug it exists to catch (an input that vanishes without an error).
 */
function loadCorpus(designDir: string): { cards: Card[]; unparsed: string[] } {
  const cards: Card[] = []
  const unparsed: string[] = []
  for (const zone of TRDD_ZONES) {
    for (const file of listTrddFiles(designDir, zone)) {
      const parsed = parseTrddFile(file, zone)
      if (!parsed) {
        unparsed.push(file)
        continue
      }
      cards.push({
        id: norm(parsed.id),
        zone,
        filePath: file,
        column: String(parsed.column ?? '').trim(),
        title: String(parsed.title ?? '').trim(),
        fm: parsed.frontmatter ?? {},
        body: parsed.body ?? '',
        raw: fs.readFileSync(file, 'utf8'),
      })
    }
  }
  return { cards, unparsed }
}

/** Which zone a column belongs in. Returns null when the column implies no constraint. */
export function expectedZone(column: string, fm: Record<string, unknown>): TrddZone | null {
  if (column === 'proposal') return 'proposals'
  if (column === 'refused') return 'refused'
  if (['completed', 'cancelled', 'superseded', 'published', 'live'].includes(column)) return 'archived'
  // `complete` is terminal ONLY when the TRDD ships nothing further. With
  // `release-via: publish|deploy` it still has publish/deploy stages ahead of it,
  // so it legitimately stays OPEN in design/tasks/.
  if (column === 'complete') {
    const via = String(fm['release-via'] ?? 'none').trim()
    return via === 'none' || via === '' ? 'archived' : null
  }
  if (WORKING_COLUMNS.includes(column)) return 'tasks'
  return null
}

export function lintCorpus(designDir: string): DoctorReport {
  const { cards, unparsed } = loadCorpus(designDir)
  const findings: Finding[] = []
  const add = (f: Finding) => findings.push(f)

  for (const file of unparsed) {
    add({
      rule: 'UNPARSEABLE',
      severity: 'error',
      id: '?',
      filePath: file,
      message: 'file matches a TRDD filename but the store cannot parse it — it is invisible to every board query',
      autofixable: false,
    })
  }

  const byId = new Map<string, Card[]>()
  for (const c of cards) {
    if (!byId.has(c.id)) byId.set(c.id, [])
    byId.get(c.id)!.push(c)
  }
  const known = new Set(byId.keys())

  // Build the derivation index once: who claims whom as an NPT/EHT child.
  const claimedBy = new Map<string, { parent: string; kind: 'npt' | 'eht' }[]>()
  for (const c of cards) {
    for (const kind of ['npt', 'eht'] as const) {
      for (const child of asList(c.fm[kind])) {
        const k = norm(child.replace(/^TRDD-/i, ''))
        if (!claimedBy.has(k)) claimedBy.set(k, [])
        claimedBy.get(k)!.push({ parent: c.id, kind })
      }
    }
  }

  for (const [id, dupes] of byId) {
    if (dupes.length > 1) {
      add({
        rule: 'ID-DUPLICATE',
        severity: 'error',
        id,
        filePath: dupes.map((d) => d.filePath).join(' | '),
        message: `id ${id} is used by ${dupes.length} files — a citation by id no longer identifies one TRDD, which is the single property the whole citation grammar rests on`,
        autofixable: false,
      })
    }
  }

  for (const c of cards) {
    const fmHas = (k: string) => c.fm[k] !== undefined && c.fm[k] !== null && String(c.fm[k]) !== ''

    // ---- schema ----
    if (!c.column) {
      add({
        rule: 'COLUMN-MISSING',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: 'no `column:` — the card cannot be placed on the board, so it appears in NO count and NO column (it is invisible, not broken). Auto-fix sets `todo` per the uncertainty law',
        autofixable: true,
      })
    } else if (!VALID_COLUMNS.includes(c.column)) {
      add({
        rule: 'COLUMN-UNKNOWN',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `column '${c.column}' is not one of the ratified 17 (+ bracket) values — every consumer aligns TO this vocabulary, never the reverse`,
        autofixable: false,
      })
    }

    if (fmHas('status')) {
      add({
        rule: 'RETIRED-STATUS-FIELD',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `carries the retired v1 \`status: ${c.fm['status']}\` — v2 replaced it with \`column:\`. Two state fields = two truths`,
        autofixable: true,
      })
    }

    if (!c.title) {
      add({
        rule: 'TITLE-MISSING',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: 'no `title:` — auto-fix lifts it from the H1',
        autofixable: true,
      })
    } else if (c.title.includes(':')) {
      add({
        rule: 'TITLE-COLON',
        severity: 'warn',
        id: c.id,
        filePath: c.filePath,
        message: 'title contains a colon — breaks grep-first flow-style frontmatter parsing',
        autofixable: false,
      })
    }

    if (!/^[A-Z0-9]{8}$/.test(c.id)) {
      add({
        rule: 'ID-SHAPE',
        severity: c.id ? 'warn' : 'error',
        id: c.id || '?',
        filePath: c.filePath,
        message: `id '${c.id}' is not 8-char UPPERCASE base36. Uppercase is load-bearing: macOS/Windows filenames are case-insensitive, so a lowercase id can fold onto an existing one`,
        autofixable: true,
      })
    }

    for (const req of ['created', 'updated']) {
      if (!fmHas(req)) {
        add({
          rule: `${req.toUpperCase()}-MISSING`,
          severity: 'warn',
          id: c.id,
          filePath: c.filePath,
          message: `no \`${req}:\` — the board sorts on \`updated\``,
          autofixable: true,
        })
      }
    }

    // ---- zone ⇄ column agreement ----
    const want = expectedZone(c.column, c.fm)
    if (want && want !== c.zone) {
      add({
        rule: 'ZONE-MISMATCH',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `column '${c.column}' belongs in design/${want}/ but the file is in design/${c.zone}/ — design/tasks/ IS the definition of OPEN work, so a terminal card left there makes the open count a lie. Fix with \`git mv\` (commit the content FIRST: git mv stages the bytes on disk, so an edit made after the move is left unstaged)`,
        autofixable: false,
      })
    }

    // ---- blocked ⇄ blocked-by ----
    const blockedBy = asList(c.fm['blocked-by'])
    if (c.column === 'blocked' && blockedBy.length === 0) {
      add({
        rule: 'BLOCKED-WITHOUT-BLOCKER',
        severity: 'warn',
        id: c.id,
        filePath: c.filePath,
        message: 'column is `blocked` but `blocked-by:` is empty — nothing records what would unblock it, so it can never be noticed as unblocked',
        autofixable: false,
      })
    }

    // ---- derived-TRDD invariants (depth is exactly 1) ----
    const derived = c.fm['derived'] === true
    const claims = claimedBy.get(c.id) ?? []
    if (derived && claims.length === 0) {
      add({
        rule: 'DERIVED-ORPHAN',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: 'declares `derived: true` but NO parent lists it in `npt:`/`eht:` — an orphan platelet never gates anyone\'s `complete`, which is the one thing it exists to do',
        autofixable: false,
      })
    }
    if (!derived && claims.length > 0) {
      // Autofixable ONLY when the lineage is unambiguous: exactly ONE parent claims it,
      // and the child already points back at that same parent. Then `derived: true` and
      // `derived-kind:` are DERIVED facts (from the parent's own npt:/eht:), not a
      // judgement. If two parents claim the same child, the child has two parents —
      // that is a real lineage bug, and writing a flag would paper over it.
      const parentField = norm(String(c.fm['parent-trdd'] ?? '').replace(/^TRDD-/i, ''))
      const unambiguous = claims.length === 1 && parentField === claims[0].parent
      add({
        rule: 'DERIVED-FLAG-MISSING',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `is claimed as an ${claims[0].kind.toUpperCase()} by TRDD-${claims[0].parent} but does not declare \`derived: true\` — the same bug seen from the other end; repair the missing half, never delete the half that is there${unambiguous ? '' : ' (NOT autofixable: the lineage is ambiguous — more than one parent claims it, or parent-trdd disagrees)'}`,
        autofixable: unambiguous,
      })
    }
    if (derived && (asList(c.fm['npt']).length > 0 || asList(c.fm['eht']).length > 0)) {
      add({
        rule: 'DERIVED-DEPTH',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: 'a derived TRDD may not have its own npt/eht (depth is exactly 1) — otherwise the parent\'s `complete` gate recurses over a tree nobody can enumerate. A sibling ordering belongs in `blocked-by:`, not `npt:`',
        autofixable: false,
      })
    }

    // ---- the completion gate: a parent is not complete while its flock is open ----
    if (TERMINAL_DONE.includes(c.column)) {
      const children = [...asList(c.fm['npt']), ...asList(c.fm['eht'])].map((x) =>
        norm(x.replace(/^TRDD-/i, '')),
      )
      const open = children.filter((k) => {
        const child = byId.get(k)?.[0]
        return child && !TERMINAL_DONE.includes(child.column)
      })
      if (open.length > 0) {
        add({
          rule: 'FALSE-COMPLETION',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `is '${c.column}' while its derived TRDD(s) ${open.join(', ')} are still open — the honest column is \`blocked\` (it is blocked on itself). Shipping the parent without its platelets does net damage: the change landed and the holes it opened stayed open`,
          autofixable: false,
        })
      }
    }

    // ---- mandate authority: a self-issued mandate above your rank is a forged approval ----
    if (c.fm['mandate'] === true) {
      const by = String(c.fm['mandated-by'] ?? '').trim().toLowerCase()
      const floor = String(c.fm['min-approval-requirement'] ?? 'none').trim().toLowerCase()
      const rankBy = AUTHORITY_RANK[by === 'self' ? 'none' : by]
      const rankFloor = AUTHORITY_RANK[floor]
      if (rankBy === undefined || rankFloor === undefined) {
        add({
          rule: 'MANDATE-UNKNOWN-AUTHORITY',
          severity: 'warn',
          id: c.id,
          filePath: c.filePath,
          message: `mandate names an authority the ladder does not know (mandated-by='${by}', min-approval-requirement='${floor}')`,
          autofixable: false,
        })
      } else if (rankBy < rankFloor) {
        add({
          rule: 'MANDATE-FORGED',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `\`mandate: true\` issued by '${by}' (rank ${rankBy}) on a TRDD whose floor is '${floor}' (rank ${rankFloor}) — that is not an approval, it is a FORGED one. Without this check, mandate:true is self-certified and an under-classified floor plus a self-issued mandate bypasses the approval system entirely`,
          autofixable: false,
        })
      }
    }

    // ---- approval record ⇄ column ----
    const approved = c.fm['approved']
    if (approved === 'rejected' && c.column !== 'refused') {
      add({
        rule: 'APPROVAL-INCONSISTENT',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `approved: rejected but column is '${c.column}' — a declined proposal belongs in \`refused\``,
        autofixable: false,
      })
    }
    if ((approved === true || approved === 'rejected') && !fmHas('approval-judge')) {
      add({
        rule: 'APPROVAL-NO-JUDGE',
        severity: 'warn',
        id: c.id,
        filePath: c.filePath,
        message: 'records an approval decision but no `approval-judge:` — without it the only evidence of who signed off is prose, which is not greppable',
        autofixable: false,
      })
    }

    // ---- dangling references ----
    for (const field of ['npt', 'eht', 'blocked-by', 'superseded-by'] as const) {
      for (const ref of asList(c.fm[field])) {
        const k = norm(ref.replace(/^TRDD-/i, ''))
        if (!known.has(k)) {
          add({
            rule: 'DANGLING-REF',
            severity: 'error',
            id: c.id,
            filePath: c.filePath,
            message: `\`${field}:\` cites TRDD-${k}, which does not exist in either root — a dependency edge that points at nothing silently never resolves`,
            autofixable: false,
          })
        }
      }
    }
    const parent = String(c.fm['parent-trdd'] ?? '').trim()
    if (parent && parent !== 'null' && !known.has(norm(parent.replace(/^TRDD-/i, '')))) {
      add({
        rule: 'DANGLING-REF',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `\`parent-trdd:\` cites TRDD-${parent}, which does not exist`,
        autofixable: false,
      })
    }

    // ---- staleness: the STATE block says done, the column says otherwise ----
    if (WORKING_COLUMNS.includes(c.column)) {
      const state = c.body.match(/##\s*⏵?\s*STATE[\s\S]{0,1200}/i)?.[0] ?? ''
      if (/\b(RESOLVED|EXECUTION COMPLETE|✅\s*(DONE|COMPLETE|SHIPPED)|DEPLOYED \+ LIVE-VERIFIED)\b/i.test(state)) {
        add({
          rule: 'STALE-COLUMN',
          severity: 'warn',
          id: c.id,
          filePath: c.filePath,
          message: `STATE block reads as finished but column is '${c.column}' — either the card never got moved (the board is lying about open work) or the STATE is optimistic. Verify against git before moving it: a STATE block's word is not evidence`,
          autofixable: false,
        })
      }
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length
  return { findings, scanned: cards.length, errors, warnings: findings.length - errors }
}

/* ------------------------------------------------------------------ *
 * Auto-repair — ONLY what is derivable from evidence already on disk. *
 * ------------------------------------------------------------------ */

function gitFirstCommitDate(filePath: string): string | null {
  try {
    const out = execFileSync('git', ['log', '--reverse', '--format=%aI', '--', filePath], {
      cwd: path.dirname(filePath),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const first = out.split('\n').find(Boolean)
    return first ? first.replace(/([+-]\d{2}):(\d{2})$/, '$1$2') : null
  } catch {
    return null
  }
}

export interface FixResult {
  filePath: string
  id: string
  changes: string[]
}

/**
 * Repair the mechanical defects. Returns what it changed; writes nothing when `dryRun`.
 *
 * It will NOT invent a column. Every unknown column becomes `todo` — the honest answer
 * to "we do not know", and the only one that keeps the card visible.
 */
export function fixCorpus(designDir: string, opts: { dryRun?: boolean; now?: string } = {}): FixResult[] {
  const { cards } = loadCorpus(designDir)
  const stamp = opts.now ?? new Date().toISOString().replace(/\.\d+Z$/, '+0000')
  const results: FixResult[] = []

  // Who claims whom. The parent's own `npt:`/`eht:` is the EVIDENCE that makes the
  // child's `derived:` back-link a derivation rather than a guess.
  const claimedBy = new Map<string, { parent: string; kind: 'npt' | 'eht' }[]>()
  for (const c of cards) {
    for (const kind of ['npt', 'eht'] as const) {
      for (const child of asList(c.fm[kind])) {
        const k = norm(child.replace(/^TRDD-/i, ''))
        if (!claimedBy.has(k)) claimedBy.set(k, [])
        claimedBy.get(k)!.push({ parent: c.id, kind })
      }
    }
  }

  for (const c of cards) {
    const changes: string[] = []
    let text = c.raw
    const hasFm = /^---\r?\n/.test(text)

    // A file with no frontmatter at all: build one from the H1 + git.
    if (!hasFm) {
      const h1 = text.match(/^#\s+(.+)$/m)?.[1] ?? ''
      const title = h1.replace(/^TRDD-[0-9a-fA-F-]+\s+—\s+/, '').trim()
      const created = gitFirstCommitDate(c.filePath) ?? stamp
      const id = norm(path.basename(c.filePath).replace(/^TRDD-(?:\d{8}_\d{6}[+-]\d{4}-)?/, '').slice(0, 8))
      const fm = [
        '---',
        `trdd-id: ${id}`,
        `title: ${title.replace(/:/g, ' —')}`,
        'column: todo',
        `created: ${created}`,
        `updated: ${stamp}`,
        'current-owner: main',
        'assignee: main',
        'priority: 3',
        'task-type: feature',
        'scope: project',
        'min-approval-requirement: none',
        'parent-trdd: null',
        'npt: []',
        'eht: []',
        'blocked-by: []',
        'implementation-commits: []',
        '---',
        '',
      ].join('\n')
      text = fm + text
      changes.push('added a full frontmatter (was: none) — column=todo per the uncertainty law')
    } else {
      // The retired `status:` field. TWO distinct cases, and conflating them would
      // invert the v2 rule — `column:` is the state machine, `status:` is dead.
      //
      //   (a) column ALREADY EXISTS → `status:` is redundant. DELETE it, and never
      //       let it overwrite the column: that would make the retired field
      //       authoritative over the live one.
      //   (b) no column → `status:` is the only state we have. Migrate it, mapping
      //       only unambiguous values; anything else falls to `todo`.
      const status = c.fm['status']
      if (status !== undefined && c.column) {
        const agrees = STATUS_TO_COLUMN[String(status).trim().toLowerCase()] === c.column
        text = text.replace(/^status:.*\n/m, '')
        changes.push(
          agrees || String(status).trim().toLowerCase() === c.column
            ? `dropped the retired \`status: ${status}\` (redundant — \`column: ${c.column}\` already says it)`
            : `dropped the retired \`status: ${status}\`; KEPT \`column: ${c.column}\` (the v2 state machine wins — the dead field must never overwrite the live one)`,
        )
      } else if (status !== undefined) {
        const mapped = STATUS_TO_COLUMN[String(status).trim().toLowerCase()] ?? 'todo'
        text = text.replace(/^status:.*$/m, `column: ${mapped}`)
        changes.push(`status: ${status} → column: ${mapped}`)
      }
      // missing column entirely
      if (!c.column && status === undefined) {
        text = text.replace(/^(trdd-id:.*)$/m, `$1\ncolumn: todo`)
        changes.push('column: todo (was missing — the uncertainty law)')
      }
      // uppercase the id
      if (c.fm['trdd-id'] && !/^[A-Z0-9]{8}$/.test(String(c.fm['trdd-id']))) {
        const short = norm(String(c.fm['trdd-id']).slice(0, 8))
        text = text.replace(/^trdd-id:.*$/m, `trdd-id: ${short}`)
        changes.push(`trdd-id → ${short} (8-char UPPERCASE base36)`)
      }
      // title from H1
      if (!c.title) {
        const h1 = c.body.match(/^#\s+(.+)$/m)?.[1] ?? ''
        const title = h1.replace(/^TRDD-[0-9a-fA-F-]+\s+—\s+/, '').trim()
        if (title) {
          text = text.replace(/^(trdd-id:.*)$/m, `$1\ntitle: ${title.replace(/:/g, ' —')}`)
          changes.push('title lifted from the H1')
        }
      }

      // The missing half of a derivation back-link. Only when EXACTLY ONE parent claims
      // this child AND the child already names that same parent — then `derived: true`
      // and `derived-kind:` follow mechanically from the parent's own npt:/eht:. Two
      // claimants means a genuine lineage bug; writing the flag would hide it.
      const claims = claimedBy.get(c.id) ?? []
      const parentField = norm(String(c.fm['parent-trdd'] ?? '').replace(/^TRDD-/i, ''))
      if (c.fm['derived'] !== true && claims.length === 1 && parentField === claims[0].parent) {
        const kind = claims[0].kind
        text = /^derived:/m.test(text)
          ? text.replace(/^derived:.*$/m, 'derived: true')
          : text.replace(/^(parent-trdd:.*)$/m, `$1\nderived: true\nderived-kind: ${kind}`)
        if (!/^derived-kind:/m.test(text)) {
          text = text.replace(/^(derived: true)$/m, `$1\nderived-kind: ${kind}`)
        }
        changes.push(`derived: true + derived-kind: ${kind} (TRDD-${claims[0].parent} lists it in its \`${kind}:\` — the back-link was missing)`)
      }
    }

    if (changes.length > 0) {
      // Any repair bumps `updated:` — the board sorts on it.
      text = /^updated:/m.test(text)
        ? text.replace(/^updated:.*$/m, `updated: ${stamp}`)
        : text.replace(/^(created:.*)$/m, `$1\nupdated: ${stamp}`)
      if (!opts.dryRun) fs.writeFileSync(c.filePath, text, 'utf8')
      results.push({ filePath: c.filePath, id: c.id, changes })
    }
  }
  return results
}
