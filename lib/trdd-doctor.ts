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
import {
  toGraphNode,
  type TrddNode,
  checkTrddInvariants,
  normalizeTrddRef,
  refList,
  V1_STATUS_TO_COLUMN,
  TERMINAL_DONE as GRAPH_TERMINAL_DONE,
} from './trdd-graph'
// BRACKET_COLUMNS / VALID_COLUMNS / isPipelineStateValue / WORKING_COLUMNS / AUTHORITY_RANK /
// TIER_TO_REQUIREMENT moved to lib/trdd-vocabulary.ts (a LEAF module) so the write-time gate
// (lib/trdd-edit-guard.ts, called FROM trdd-store.ts::editTrdd) can share this grammar without
// closing a cycle back through trdd-store.ts. Imported AND re-exported here — imported for this
// file's own use below, re-exported so every existing importer of this module is unaffected.
import {
  BRACKET_COLUMNS,
  VALID_COLUMNS,
  isPipelineStateValue,
  WORKING_COLUMNS,
  AUTHORITY_RANK,
  TIER_TO_REQUIREMENT,
} from './trdd-vocabulary'
export { BRACKET_COLUMNS, VALID_COLUMNS, isPipelineStateValue, WORKING_COLUMNS, AUTHORITY_RANK, TIER_TO_REQUIREMENT }

/**
 * Columns that mean "this work is finished and leaves the board".
 *
 * RE-EXPORTED from lib/trdd-graph.ts — NOT redefined. It is the one owner of the graph
 * semantics, and a second definition of "what counts as done" is a second truth that
 * will eventually disagree with the first. (I originally wrote my own copy of this list,
 * plus my own cycle detector and completion gate, because I never checked whether they
 * existed. They did. That is the bug this whole file exists to catch, committed by the
 * file itself.)
 */
export const TERMINAL_DONE: readonly string[] = [...GRAPH_TERMINAL_DONE]

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

/**
 * One card, REDUCED. `body` and `raw` are deliberately absent — see `loadCorpus`.
 */
export interface Card {
  id: string
  zone: TrddZone
  filePath: string
  column: string
  title: string
  fm: Record<string, unknown>
  /**
   * Set when this card's frontmatter could NOT be parsed (TRDD-5XJWR473). Such a card
   * arrives with `column: ''`, `title: ''` and `fm: {}` — indistinguishable from a card
   * that genuinely lacks those fields — so every AUTOFIX must skip it. Its real fields
   * are sitting in the file, unparsed; inserting more is not a repair, it is a guess
   * that compounds on every run.
   */
  parseError?: string
  /**
   * The STALE-COLUMN verdict, decided IN THE STREAM so the body is released with the
   * file. It is the only rule that reads prose, and holding ~10 KB of body per card to
   * answer one boolean is most of what put the entire corpus in memory.
   */
  stateReadsDone: boolean
  /**
   * The body's H1 — the only body text the auto-fixer needs (it lifts a missing title
   * from it). One line retained, not one document.
   */
  h1: string
  /**
   * A pipeline-state claim found in the BODY (`**Status:** Not started`) — 3P-TRDD-10.
   * Decided IN THE STREAM, same reason as `stateReadsDone`: one short string per card
   * instead of ~10 KB of body, which is what the 10^5 budget cost last time.
   * Empty when the body makes no such claim.
   */
  bodyStateClaim: string
  /**
   * The acceptance checklist, REDUCED to two integers — the terminal-column completion gate
   * (`rules/aimaestro/aimaestro-trdd-approval.md` §D4 step 5b). Decided IN THE STREAM, same
   * reason as the two fields above: two numbers per card instead of a document.
   */
  boxes: { total: number; open: number }
}

/**
 * Find a pipeline-state claim in a TRDD's BODY — the 3P-TRDD-10 second-source-of-truth.
 *
 * Matches `**Status:** X`, `**Column:** X`, and a line-initial `Status:` / `Column:`.
 *
 * Two exclusions, both of them the difference between a rule and a nuisance:
 *  - FENCED CODE is stripped first. A rule that scans bodies for a pattern matches its OWN
 *    documentation: the TRDD that specifies this rule quotes `**Status:**` several times, so
 *    a naive implementation flags the card that defines it. Same self-match trap as a source
 *    scanner flagging its own pattern table.
 *  - BLOCKQUOTED lines (`> …`) are skipped — a quoted example or a relayed report is
 *    evidence, not the card's own claim.
 *
 * Returns the raw claimed value, or '' when the body makes no claim.
 */
export function findBodyStateClaim(body: string): string {
  const lines = body.split('\n')
  const start = bodyStartIndex(lines)
  return start === null ? '' : (scanStateClaimLines(lines.slice(start))?.claim ?? '')
}

/**
 * Where the BODY begins — index of the first line after the closing `---`, or 0 when there is
 * no frontmatter block, or null when a block was opened and never closed.
 *
 * Both entry points compute it rather than trusting their caller, because the claim regex
 * matches a line-initial `Column:` — which is EXACTLY a frontmatter field name. Handed a whole
 * file, an unguarded scan would report every card in the corpus (frontmatter `column: dev`) and
 * the repair would DELETE that field. Today `findBodyStateClaim` happens to be called with a
 * body, so the guard is only latent; a function that is correct only because of what one caller
 * passes is a trap with a due date.
 */
function bodyStartIndex(lines: readonly string[]): number | null {
  if (lines[0]?.trimEnd() !== '---') return 0
  const close = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---')
  return close === -1 ? null : close + 1
}

/**
 * The ONE line-walk behind the lint, the exported finder, and the auto-repair. It returns the
 * line INDEX as well as the value, because the repair must delete exactly the line the rule
 * matched — a literal string-replace would hit a fenced copy earlier in the file, i.e. the
 * self-match trap again, one layer down in the fixer.
 *
 * The fence handling is a TOGGLE, not a strip-by-regex: an unclosed fence then makes the rest
 * of the file fenced, which is the conservative direction (no claim found → nothing flagged,
 * nothing deleted). The regex form would have re-exposed the tail.
 */
function scanStateClaimLines(lines: readonly string[]): { idx: number; claim: string } | null {
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || /^\s*>/.test(line)) continue
    const m = line.match(/^\s*(?:\*\*(?:Status|Column):\*\*|(?:Status|Column):)\s*(\S.*)$/i)
    if (m) return { idx: i, claim: (m[1] ?? '').trim() }
  }
  return null
}

/**
 * Count a body's ACCEPTANCE BOXES — `{ total, open }`, two integers, never the prose.
 *
 * Reduced IN THE STREAM for the same reason as `stateReadsDone` and `bodyStateClaim`: the
 * rule below needs two numbers, and retaining ~10 KB of body per card to compute them is
 * most of what put the whole corpus in memory last time (see `loadCorpus`).
 *
 * The fence handling is the same TOGGLE as `scanStateClaimLines`, and for the same reason —
 * a rule that scans bodies matches its OWN documentation. TRDD-5YRLA53W, the card that
 * specifies this gate, carries a fenced `grep -cE '^- \[[ x~]\]'` in its measurement recipe;
 * a naive counter reads that as a checkbox on the card that defines the rule. An unclosed
 * fence makes the rest of the file fenced, which is the conservative direction here too: it
 * UNDER-counts, and under-counting can only produce a finding a human then dismisses, never
 * a silent pass.
 *
 * `[~]` counts toward `total` but not toward `open`: it is the corpus's "deliberately not
 * doing this" marker, which is a decision, not an outstanding obligation.
 */
export function countAcceptanceBoxes(body: string): { total: number; open: number } {
  const lines = body.split('\n')
  const start = bodyStartIndex(lines)
  if (start === null) return { total: 0, open: 0 }
  let inFence = false
  let total = 0
  let open = 0
  for (const line of lines.slice(start)) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^\s*[-*]\s\[([ xX~])\]/)
    if (!m) continue
    total++
    if (m[1] === ' ') open++
  }
  return { total, open }
}

/**
 * The DAY part of a frontmatter date, as `YYYY-MM-DD`, or `''` when there is none.
 *
 * Handles BOTH shapes on purpose. A YAML reader may hand back an ISO string or a parsed
 * `Date` depending on its timestamp settings, and which one it is here is not something a
 * rule should silently depend on: `String(someDate)` yields `"Fri Jul 31 2026 …"`, whose
 * first ten characters are not a date at all, so a string-only reader would compare garbage
 * and quietly grandfather every card forever. Both branches are pinned by tests rather than
 * one being assumed and the other left as dead code.
 */
export function frontmatterDay(v: unknown): string {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  return String(v ?? '').trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
}

/**
 * The GRANDFATHER BOUNDARY of the terminal-column checklist gate.
 *
 * The gate is normative in `rules/aimaestro/aimaestro-trdd-approval.md` §D4 step 5b, whose
 * own text fixes this date: 46 archived cards closed with no checklist, they are FROZEN by
 * IND base step 12 and therefore unrepairable, and "what the fix changes is every terminal
 * transition FROM 2026-07-31 ON". Flagging the 46 would be a wall of warnings about work
 * nobody is permitted to fix — which is how a linter gets routed around.
 *
 * `updated:` is the proxy for "when it went terminal", because the transition bumps it. It is
 * a proxy and not a proof: rule 12 lets a frozen card's `updated:` move later (a
 * `superseded-by:` edit). That direction is safe — it can only pull a card INTO scope, and
 * the resulting finding ("touched after the boundary, still has no checklist") is true and
 * worth a human's glance.
 */
export const CHECKLIST_GATE_SINCE = '2026-07-31'

/**
 * Does a body state claim AGREE with the card's `column:`?
 *
 * Exported and shared by the lint and the fixer deliberately. The sibling rule
 * STATUS-HOLDS-COLUMN-VALUE shipped earlier this session with two copies of its predicate —
 * the lint accepted only `VALID_COLUMNS` while the fixer also accepted `V1_STATUS_TO_COLUMN`,
 * so `--fix` silently REPAIRED a shape the lint never reported. One predicate, two callers.
 *
 * Compares the LEADING clause, not the whole line. Every real claim in this corpus carries an
 * explanation ("Not started — deferred until…", "DONE — Phases 0-8 landed in…"), so a
 * whole-line key can never equal a column value: the first cut of this rule made agreement
 * unreachable, and with it the WARN severity and the only auto-repairable case.
 *
 * Two spellings are accepted, and only two, because they are the two we can PROVE: the column
 * vocabulary itself and the v1 map (`trdd-graph` owns it). There is deliberately NO synonym
 * table — "Done" beside `column: completed` reads as agreement to a human and cannot be proven
 * by a tool, so it stays an ERROR for a human to judge. Inventing the synonyms would be the
 * tool guessing at which of two states a card is in, which is the one thing 3P-TRDD-10 forbids.
 */
export function bodyClaimAgreesWithColumn(claim: string, column: string): boolean {
  if (!claim || !column) return false
  const key = claim
    .split(/\s+[—–]\s+|\s+-\s+|[.(]/)[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
  // The ONE inflection accepted beyond the two vocabularies: `done` beside a terminal column.
  // It is not a synonym guess — it is the plain past participle of the terminal set itself, and
  // every reader (human or machine) reads `**Status:** Done` on a `column: completed` card as
  // agreement. Classifying that as a CONTRADICTION would be the tool misreporting, not the tool
  // being careful: the conservative-when-unsure posture only applies where the tool genuinely
  // cannot tell. Deliberately NOT extended to `implemented` / `shipped` / `fixed`, which name an
  // ACTION rather than the pipeline position and can legitimately predate the column.
  if (key === 'done' && TERMINAL_DONE.includes(column)) return true
  return (V1_STATUS_TO_COLUMN[key] ?? key) === column || key === column
}

/**
 * Delete the FIRST body state-claim line from a TRDD's full file text, or return null when
 * there is none. Used only for an AGREEING claim — a disagreement is never auto-resolved.
 *
 * The frontmatter boundary is COMPUTED from the closing `---`, never assumed to be a fixed
 * line: without that, the scan would reach a frontmatter `status:` and the repair would delete
 * a legitimate field (`status: normative`), which is exactly how the sibling fixer destroyed
 * data before the USER's 2026-07-30 ruling.
 */
export function removeBodyStateClaimLine(text: string): string | null {
  const lines = text.split('\n')
  const bodyStart = bodyStartIndex(lines)
  if (bodyStart === null) return null // frontmatter opened and never closed: nothing is body yet
  const hit = scanStateClaimLines(lines.slice(bodyStart))
  if (!hit) return null
  lines.splice(bodyStart + hit.idx, 1)
  return lines.join('\n')
}

/**
 * Every field this file reads through `asList` is a REFERENCE field — `npt`, `eht`,
 * `blocked-by`, `superseded-by` — so what counts as a reference is `lib/trdd-graph.ts`'s
 * to decide, not this file's.
 *
 * It used to be `Array.isArray(v) ? … : []`, which made a legal bare scalar
 * (`npt: TRDD-X`) INVISIBLE to the linter in all seven of its call sites: the depth-1
 * derivation rules, GRAPH-BLOCKED-NOT-BLOCKED, ORDER-NPT-VIOLATED, the supersede check,
 * the ready queue, and the fixer. That is precisely the divergence `refList` was
 * exported to end one layer down — greptrdd carried the identical array-only reader and
 * reported a scalar-blocked card as READY — and the WRITE GATE kept it for longer,
 * silently, because a rule that cannot see an edge reports no finding about it.
 *
 * Found by TRDD-C069SK9E's walk-vs-index differential: the two feeders disagreed on the
 * ready queue over a fixture whose blocker is written as a scalar, and the walk was the
 * wrong one. `normalizeTrddRef` is idempotent, so the sites that re-normalize are
 * unaffected; the one deliberate behaviour change is that a literal `null` placeholder
 * is now dropped rather than carried as the ref `"NULL"`.
 */
const asList = (v: unknown): string[] => refList(v)

/**
 * A STATE block that reads as finished. Hoisted to module scope so the reduction in
 * `loadCorpus` and the rule that reports it cannot drift into two different tests.
 * No `g` flag on purpose: a global regex carries `lastIndex` between `.test` calls and
 * would then answer differently on identical input depending on call order.
 */
const STATE_READS_DONE =
  /\b(RESOLVED|EXECUTION COMPLETE|✅\s*(DONE|COMPLETE|SHIPPED)|DEPLOYED \+ LIVE-VERIFIED)\b/i

/**
 * Read every TRDD in every zone, through the store, REDUCING each file as it is read.
 *
 * WHY THE REDUCTION IS THE POINT (TRDD-BQC8NQSW). This used to return a `Card[]` whose
 * every card carried `body` AND `raw` — two full copies of the file — so peak RSS
 * tracked corpus bytes: measured 1 429 MB over a 20 000-card fixture, extrapolating to
 * ~7 GB at 10^5, past Node's heap cap. The wall was MEMORY, and it landed BELOW the
 * target size, so the failure at scale was a crash rather than a slow run. Nothing about
 * the verdicts needed those bytes: exactly two rules read prose (STALE-COLUMN's STATE
 * block, the auto-fixer's H1 lift), and both reduce to a few bytes at parse time. So each
 * file is read, reduced, and released.
 *
 * The frontmatter IS retained, and that is a deliberate trade. The alternative — evaluate
 * every rule inside the stream and keep only findings — would move each cross-card
 * finding (ID-DUPLICATE, ORDER-NPT-VIOLATED, DERIVED-FLAG-MISSING, DANGLING-REF) out of
 * its card's position and into a trailing block, because those rules cannot be answered
 * until the last card has been read. This refactor's acceptance criterion is that the
 * findings are identical before and after, ORDER included; reducing ~70 KB/card to ~2 KB
 * is what the budget needed, and reordering the report to save the last 2 KB would trade
 * a provable property for an unmeasured one.
 *
 * The graph nodes are built HERE, from the same read, instead of by a second
 * `loadTrddGraph(designDir)` walk — the doctor used to read the whole corpus twice for
 * one report. `toGraphNode` remains the one owner of the node semantics; only the I/O is
 * shared.
 *
 * A file the store cannot parse is itself a finding — it must never be silently skipped,
 * or the linter reproduces the exact bug it exists to catch (an input that vanishes
 * without an error).
 */
function loadCorpus(designDir: string): { cards: Card[]; unparsed: string[]; nodes: TrddNode[] } {
  const cards: Card[] = []
  const unparsed: string[] = []
  const nodes: TrddNode[] = []
  for (const zone of TRDD_ZONES) {
    for (const file of listTrddFiles(designDir, zone)) {
      const parsed = parseTrddFile(file, zone)
      if (!parsed) {
        unparsed.push(file)
        continue
      }
      const body = parsed.body ?? ''
      cards.push({
        id: normalizeTrddRef(parsed.id),
        zone,
        filePath: file,
        column: String(parsed.column ?? '').trim(),
        title: String(parsed.title ?? '').trim(),
        fm: parsed.frontmatter ?? {},
        ...(parsed.parseError ? { parseError: parsed.parseError } : {}),
        stateReadsDone: STATE_READS_DONE.test(
          body.match(/##\s*⏵?\s*STATE[\s\S]{0,1200}/i)?.[0] ?? '',
        ),
        h1: body.match(/^#\s+(.+)$/m)?.[1] ?? '',
        bodyStateClaim: findBodyStateClaim(body),
        boxes: countAcceptanceBoxes(body),
      })
      const node = toGraphNode(parsed)
      if (node) nodes.push(node)
      // `parsed` — and with it the body — goes out of scope here. That release is the fix.
    }
  }
  return { cards, unparsed, nodes }
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
  const { cards, unparsed, nodes } = loadCorpus(designDir)
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

  // The OTHER unparseable shape, and the one this rule was named for (TRDD-5XJWR473).
  // `unparsed` above only ever holds files whose FILENAME carries no id — a YAML parse
  // failure produced a perfectly ordinary Card with blank column/title, so a broken card
  // was reported as a card merely missing fields, and `--fix` then "repaired" it by
  // inserting duplicates of the fields sitting unparsed in the file.
  for (const c of cards) {
    if (!c.parseError) continue
    add({
      rule: 'UNPARSEABLE',
      severity: 'error',
      id: c.id,
      filePath: c.filePath,
      message: `frontmatter does not parse (${c.parseError}) — every field reads as ABSENT, so the board sees a card with no column and no title while the real ones sit in the file. Repair the YAML by hand: an autofix here would insert a SECOND copy of each missing field and do it again on every run`,
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
        const k = normalizeTrddRef(child.replace(/^TRDD-/i, ''))
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
    // Every field-based verdict below is derived from `c.fm`, and for an unparseable card
    // `c.fm` is `{}` — not because the fields are absent but because they could not be READ
    // (TRDD-5XJWR473). Emitting COLUMN-MISSING for a card whose `column:` is sitting right
    // there in the file is a FALSE finding, and it is the specific false finding that made
    // `--fix` insert a duplicate. UNPARSEABLE was already raised for this card above; that is
    // the one true thing there is to say about it until a human repairs the YAML.
    if (c.parseError) continue

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

    // ---- a COLUMN value in the `status:` field ----
    // USER ruling 2026-07-30: `status:` is NOT a retired duplicate of `column:` — it carries
    // a DIFFERENT aspect, and the pillar specs already use it that way (`status: normative`).
    // So this rule may never key on the FIELD NAME. It keyed on `fmHas('status')` and was
    // marked autofixable, which made `trdd:fix` a deleter of a legitimate field the moment
    // one appeared — data loss from a tool, in the one place a tool must not guess.
    //
    // Key on the VALUE instead: a `status:` holding a COLUMN value is v1 residue (the v1
    // field spelled the pipeline state), and that is the only shape we can prove is wrong.
    // Anything else is the field doing its own job — not a finding, not even a warning.
    const statusVal = fmHas('status') ? String(c.fm['status']).trim() : ''
    if (statusVal && isPipelineStateValue(statusVal)) {
      add({
        rule: 'STATUS-HOLDS-COLUMN-VALUE',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `\`status: ${statusVal}\` holds a COLUMN value — the v1 field spelled the pipeline state, and v2 moved that to \`column:\`. Two state fields = two truths. (\`status:\` itself is legitimate for a different aspect; only a column value in it is wrong.)`,
        autofixable: true,
      })
    }

    // ---- 3P-TRDD-10 one-state-claim: the body must not state the pipeline position too ----
    // One source of truth is the whole reason the pipeline state moved to `column:`; a body
    // line defeats it just as thoroughly as a second frontmatter field. This is how the
    // janitor's drift detector came to report three `column: complete` cards as unstarted —
    // it read line 19, which said so (janitor#135).
    //
    // Severity splits on AGREEMENT, because the two cases need different human actions:
    // a contradiction is a card asserting two states at once and someone must decide which
    // is true; a duplicate is merely a second copy waiting to go stale.
    if (c.bodyStateClaim) {
      const agrees = bodyClaimAgreesWithColumn(c.bodyStateClaim, c.column)
      add({
        rule: 'BODY-STATE-CLAIM',
        severity: agrees ? 'warn' : 'error',
        id: c.id,
        filePath: c.filePath,
        message: agrees
          ? `the body restates the pipeline position ("${c.bodyStateClaim}") that \`column: ${c.column}\` already owns — a second copy, free to go stale (3P-TRDD-10)`
          : `the body claims "${c.bodyStateClaim}" while \`column: ${c.column}\` — the card asserts TWO states at once, and a reader nineteen lines in believes the body (3P-TRDD-10). Which is true is a judgement, so this is never auto-repaired`,
        // Only the AGREEING case is derivable: drop the redundant line. A disagreement must
        // never be auto-resolved — picking one silently is how a tool loses work.
        autofixable: agrees,
      })
    }

    // ---- the approval requirement: one rung, one spelling ----
    // `approval-tier:` is the retired NUMBER for the same fact `min-approval-requirement:`
    // now names. Both fields on one card is not redundancy — the §D4 floor check reads one
    // and another reader reads the other, so a disagreement hands them DIFFERENT required
    // approvers for the same card. That is the only ERROR here; a lone legacy number is a
    // migration chore, not a defect, and must not turn the suite red.
    if (fmHas('approval-tier')) {
      const decoded = TIER_TO_REQUIREMENT[String(c.fm['approval-tier']).trim()]
      const declared = String(c.fm['min-approval-requirement'] ?? '').trim()
      if (declared && decoded && declared !== decoded) {
        add({
          rule: 'APPROVAL-FIELD-CONFLICT',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `\`approval-tier: ${c.fm['approval-tier']}\` decodes to '${decoded}' but \`min-approval-requirement: ${declared}\` — the card names TWO different required approvers, and which one binds depends on which field the reader happens to prefer. Resolve by hand: deleting the wrong one is a governance decision, not a mechanical fix`,
          autofixable: false,
        })
      } else {
        add({
          rule: 'APPROVAL-TIER-DEPRECATED',
          severity: 'warn',
          id: c.id,
          filePath: c.filePath,
          message: `carries the deprecated \`approval-tier: ${c.fm['approval-tier']}\`${decoded ? ` (= '${decoded}')` : ''} — the overlay retired the number for a named rung. Decode-only on legacy cards; never written on a new one`,
          autofixable: Boolean(decoded),
        })
      }
    }

    // ---- overlay metadata the §D4 watchdog and the multi-agent board actually read ----
    // Each entry names the CONSUMER that silently misreads the card when the field is absent
    // — that is what keeps these false-positive-free. A field whose absence breaks nobody
    // (`scope:` defaults to project; `project-id:` is a proposed IND-base addition that has
    // not shipped) is deliberately NOT here: flagging it would be a style opinion, and a
    // linter people route around costs every finding it would ever have made.
    //
    // SCOPE, and why it is exactly this: the §D4 watchdog scans `design/tasks/` +
    // `design/proposals/` and nothing else. Archived and refused cards are outside its scan
    // set, so a missing field there breaks no consumer — flagging them added 218 findings
    // that named no broken reader, which is a wall, and a wall is how a linter gets routed
    // around. Mirroring the consumer's OWN scan set is what makes the check FP-free.
    const watchdogScans = c.zone === 'tasks' || c.zone === 'proposals'
    const missingMeta: Array<[string, string]> = []
    if (watchdogScans && c.zone === 'tasks' && !fmHas('assignee')) {
      missingMeta.push(['assignee', 'this card is OPEN work with no owner — the D4 watchdog asserts `assignee` is set, and the board renders no one'])
    }
    if (watchdogScans && !fmHas('min-approval-requirement') && !fmHas('approval-tier')) {
      missingMeta.push(['min-approval-requirement', 'the D4 floor comparison has nothing to compare the objective floor AGAINST, so the watchdog silently cannot evaluate this card at all'])
    }
    if (watchdogScans && !fmHas('created-by')) {
      missingMeta.push(['created-by', 'mandate provenance and the derived-TRDD invariant both read authorship, and neither can resolve it from any other field'])
    }
    for (const [field, why] of missingMeta) {
      add({
        rule: 'META-MISSING',
        severity: 'warn',
        id: c.id,
        filePath: c.filePath,
        message: `no \`${field}:\` — ${why}`,
        autofixable: false,
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

    // ---- the terminal-column completion gate (aimaestro-trdd-approval.md §D4 step 5b) ----
    //
    // The rule was RATIFIED and enforced by NOTHING. It is written as a "hard gate", it was
    // repaired on 2026-07-31 (TRDD-9QV4ZCYY) to close its own vacuity — a condition stated
    // only over UNCHECKED boxes passes a card that has NO boxes, "a gate that passes because
    // it read nothing" — and the repaired rule then had no enforcer, so the corpus never
    // changed. That is the same vacuity one level up: the fix to a gate is worth exactly what
    // enforces it. `grep -rn checklist lib/ scripts/` returned nothing before this block.
    //
    // The gate binds the TRANSITION INTO a terminal column, never a card's whole life, so:
    //  - a non-terminal card with no checklist is NOT flagged (premature — a `planned` card
    //    has not been designed yet, and 22 of them have no boxes for good reason);
    //  - a fully-checked checklist in a non-terminal column is simply not-yet-advanced;
    //  - `cancelled` and `superseded` are DELIBERATELY excluded. Open boxes are what those
    //    columns MEAN — abandoned work and overtaken work are not required to be finished,
    //    and demanding a complete checklist from them would make the honest closure of a
    //    dead card impossible.
    //
    // Measured before landing: 165 terminal cards grandfathered, 33 past the boundary, and
    // ALL 33 already compliant — so this emits ZERO findings on day one. That inverts the
    // objection recorded on TRDD-5YRLA53W ("only after the backfill, or it emits 69 warnings
    // on day one and gets routed around"), which was sized against the 69 open cards with no
    // checklist — a different set entirely. It is a pure ratchet: free today, binding on
    // every terminal transition after it.
    const CHECKLIST_GATED = ['complete', 'completed', 'published', 'live']
    if (CHECKLIST_GATED.includes(c.column)) {
      const day = frontmatterDay(c.fm['updated'])
      if (day && day >= CHECKLIST_GATE_SINCE) {
        const back = String(c.fm['pre-block-column'] ?? '').trim() || 'dev'
        if (c.boxes.total === 0) {
          add({
            rule: 'TERMINAL-WITHOUT-CHECKLIST',
            severity: 'error',
            id: c.id,
            filePath: c.filePath,
            message: `is '${c.column}' with NO acceptance checklist — the completion gate is written over boxes that are unchecked, so a card with no boxes passes it having PROVEN NOTHING. Nothing records what this card promised or whether it delivered. Move it back to '${back}', write the checklist, then close it`,
            autofixable: false,
          })
        } else if (c.boxes.open > 0) {
          add({
            rule: 'TERMINAL-WITH-OPEN-BOX',
            severity: 'error',
            id: c.id,
            filePath: c.filePath,
            message: `is '${c.column}' with ${c.boxes.open} of ${c.boxes.total} acceptance box(es) still unchecked — a false completion. Either the work is not done (move it back to '${back}') or the box is obsolete and must be struck through with its reason, never silently ticked`,
            autofixable: false,
          })
        }
      }
    }

    // ================= ORDER — the invariant that actually matters =================
    //
    // Timing is noise: a TRDD may wait a day or a month and nothing is wrong. What is
    // NEVER acceptable is work proceeding OUT OF ORDER — a task running while its
    // prerequisite is unfinished, or a task idling while its blocker has long cleared.
    // The dependency chain is the load-bearing structure; respect it and scheduling
    // solves itself. These four rules are that structure, enforced.

    // NOTE: "a live blocker means column: blocked" and "blocked-by lists only OPEN
    // blockers" are NOT checked here. lib/trdd-graph.ts already owns them
    // (`blockedNotBlocked`, `danglingBlocker`) and the delegation block at the end of
    // this function surfaces them. I originally re-implemented both, which is how this
    // file briefly became the second truth it exists to prevent.
    const blockedBy = asList(c.fm['blocked-by']).map((x) => normalizeTrddRef(x))

    if (c.column === 'blocked' && blockedBy.length === 0) {
      add({
        rule: 'BLOCKED-WITHOUT-BLOCKER',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: 'column is `blocked` but `blocked-by:` is empty — nothing records what would unblock it, so it can NEVER be noticed as unblocked. A card that cannot be unblocked is a card that is silently abandoned',
        autofixable: false,
      })
    }

    if (c.column === 'blocked' && !fmHas('pre-block-column')) {
      add({
        rule: 'BLOCKED-NO-RESTORE-POINT',
        severity: 'warn',
        id: c.id,
        filePath: c.filePath,
        message: 'blocked without `pre-block-column:` — when the blocker clears there is no record of where to put it back, so it will land in the wrong column or be forgotten',
        autofixable: false,
      })
    }

    // (3) NPT ordering: a Necessary Prerequisite Task must be finished BEFORE the parent
    //     proceeds past `dev`. A parent in testing/review/complete with an open NPT has
    //     built on a foundation that does not exist yet.
    const PAST_DEV = ['testing', 'ai_review', 'human_review', 'complete', 'publish', 'published', 'deploy', 'live', 'live_auditing']
    if (PAST_DEV.includes(c.column)) {
      const openNpt = asList(c.fm['npt'])
        .map((x) => normalizeTrddRef(x.replace(/^TRDD-/i, '')))
        .filter((k) => {
          const n = byId.get(k)?.[0]
          return n && !TERMINAL_DONE.includes(n.column)
        })
      if (openNpt.length > 0) {
        add({
          rule: 'ORDER-NPT-VIOLATED',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `is '${c.column}' (past dev) while its NPT(s) ${openNpt.join(', ')} are unfinished — an NPT must complete BEFORE the parent proceeds past \`dev\`. This card is being tested/reviewed against a prerequisite that does not exist yet`,
          autofixable: false,
        })
      }
    }

    // The derivation invariants (depth1 / unclaimed / childDerivedFalse / twoParents /
    // kindMismatch / parentMismatch) and the completion gate (falseComplete) are NOT
    // checked here — lib/trdd-graph.ts owns all of them, and the delegation block below
    // surfaces them. What the graph does NOT do is decide whether a violation is
    // MECHANICALLY REPAIRABLE, so that judgement stays here:
    //
    // A missing `derived: true` back-link is autofixable ONLY when the lineage is
    // unambiguous — exactly ONE parent claims the child AND the child already names that
    // same parent. Then the flag is DERIVED from the parent's own npt:/eht:, not guessed.
    // Two claimants means the child has two parents, which is a real lineage bug; writing
    // the flag would paper over it. `fixCorpus` applies exactly this rule.
    const claims = claimedBy.get(c.id) ?? []
    if (c.fm['derived'] !== true && claims.length > 0) {
      const parentField = normalizeTrddRef(String(c.fm['parent-trdd'] ?? ''))
      const unambiguous = claims.length === 1 && parentField === claims[0].parent
      if (unambiguous) {
        add({
          rule: 'DERIVED-FLAG-MISSING',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `is claimed as an ${claims[0].kind.toUpperCase()} by TRDD-${claims[0].parent} but does not declare \`derived: true\` — repair the missing half, never delete the half that is there`,
          autofixable: true,
        })
      }
      // The ambiguous case is left to trdd-graph (it reports `twoParents`/`childDerivedFalse`),
      // because it is NOT repairable and duplicating the report would double-count it.
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

    // `superseded-by:` is the one reference field trdd-graph does NOT walk (it checks
    // npt/eht/blocked-by/parent-trdd). Kept here for that field alone — everything else
    // comes from the delegation below.
    for (const ref of asList(c.fm['superseded-by'])) {
      const k = normalizeTrddRef(ref)
      if (!known.has(k)) {
        add({
          rule: 'DANGLING-REF',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `\`superseded-by:\` cites TRDD-${k}, which does not exist in either root — a card superseded by nothing is a card silently removed from the board`,
          autofixable: false,
        })
      }
    }

    // ---- drift: the STATE block says done, the column says otherwise ----
    //
    // Deliberately a WARN, not an error. This is a *timing* signal, and timing is the
    // least important thing on this board: how long a card has waited says nothing about
    // whether anything is wrong. The ERRORs above are all about ORDER — a prerequisite
    // skipped, a blocker ignored, a ring that can never start — because a violated order
    // means work is proceeding on a foundation that does not exist, which is a real
    // defect at any age. A stale column is only a bookkeeping lag, and it costs a
    // reviewer a minute; a violated order costs the work itself.
    if (WORKING_COLUMNS.includes(c.column)) {
      if (c.stateReadsDone) {
        add({
          rule: 'STALE-COLUMN',
          severity: 'warn',
          id: c.id,
          filePath: c.filePath,
          message: `STATE block reads as finished but column is '${c.column}' — either the card never got moved or the STATE is optimistic. Verify against git before moving it: a STATE block's word is not evidence. (WARN by design: this is bookkeeping lag, not an ordering violation)`,
          autofixable: false,
        })
      }
    }
  }

  // ================== THE GRAPH INVARIANTS — DELEGATED, NOT RE-DERIVED ==================
  //
  // cycle · falseComplete · blockedNotBlocked · danglingBlocker · depth1 · unclaimed ·
  // twoParents · kindMismatch · parentMismatch · childMissing · childDerivedFalse ·
  // unknownBlocker · parentIsDerived — every one of these lives in lib/trdd-graph.ts,
  // which is ALREADY the owner (wired into lib/kanban-index.ts, falsified by
  // tests/unit/trdd-corpus-invariants.test.ts). This doctor calls it. It does not
  // reimplement it.
  //
  // The first version of THIS FILE re-derived eight of those rules — a private cycle
  // detector, a private completion gate, a private TERMINAL_DONE — because I never
  // enumerated what existed before building. Two implementations of "is this card done?"
  // agree on the day they are written and disagree silently the day one is edited. That
  // is the exact class of defect this doctor exists to catch, and the doctor committed it.
  // Deleting my copies is the fix; this comment is the guardrail against a third.
  // The nodes come from `loadCorpus`'s single read, not from a second
  // `loadTrddGraph(designDir)` walk of the same files (TRDD-BQC8NQSW).
  for (const v of checkTrddInvariants(nodes)) {
    const id = normalizeTrddRef(v.id)
    add({
      rule: `GRAPH-${v.kind.replace(/([A-Z])/g, '-$1').toUpperCase()}`,
      severity: 'error',
      id,
      filePath: byId.get(id)?.[0]?.filePath ?? '?',
      message: v.detail,
      autofixable: false,
    })
  }

  const errors = findings.filter((f) => f.severity === 'error').length
  return { findings, scanned: cards.length, errors, warnings: findings.length - errors }
}

/** Edges that impose ORDER: this card cannot proceed until those cards do. */
function orderEdges(c: Card): string[] {
  return [...asList(c.fm['blocked-by']), ...asList(c.fm['npt'])].map((x) =>
    normalizeTrddRef(x),
  )
}

export interface ReadyCard {
  id: string
  column: string
  title: string
  priority: unknown
  /** Cards this one unblocks. A high count means finishing it frees the most work. */
  unblocks: number
}

/**
 * The minimum a card must expose to be RANKED — and deliberately nothing more.
 *
 * Two feeders build it: this file's corpus walk, and `greptrdd`'s shared graph
 * (index-backed at 10⁵, `TRDD-C069SK9E`). Naming the shape here is what keeps the
 * ranking ONE implementation instead of two that agree until they don't — the exact
 * "two consumers of one store, divergent on identical input" bug Phase 1 fixed a
 * layer down. `orderEdges` arrives already normalized, because whose job it is to
 * normalize a ref is settled in `lib/trdd-graph.ts` and not re-decided per caller.
 */
export interface ReadyInput {
  id: string
  column: string
  title: string
  priority: unknown
  orderEdges: string[]
}

/**
 * The READY QUEUE, over cards someone else read — every card whose prerequisites are
 * ALL satisfied, so it can be worked on right now, ordered by how much work finishing
 * it would unblock.
 *
 * This is the answer to "what should I do next?", and it is derived purely from the
 * dependency graph — never from how long something has been waiting. Age tells you
 * nothing: a card that has waited a month may still be blocked, and a card created
 * this morning may be the one thing unblocking six others.
 *
 * A ref to a card that is not in `inputs` counts as DONE, not as a blocker: a dangling
 * reference is a lint finding (`GRAPH-DANGLING-BLOCKER`), never a reason to call work
 * unstartable. The graph reader reaches the same verdict by a membership test, so both
 * feeders drop the same rows for the same reason.
 */
export function readyQueueFrom(inputs: readonly ReadyInput[]): ReadyCard[] {
  const byId = new Map(inputs.map((c) => [c.id, c]))
  const isDone = (id: string) => {
    const c = byId.get(id)
    return !c || TERMINAL_DONE.includes(c.column)
  }

  // How many OPEN cards each card would unblock if it were finished.
  const unblocks = new Map<string, number>()
  for (const c of inputs) {
    if (TERMINAL_DONE.includes(c.column)) continue
    for (const dep of c.orderEdges) unblocks.set(dep, (unblocks.get(dep) ?? 0) + 1)
  }

  return inputs
    .filter((c) => WORKING_COLUMNS.includes(c.column) && c.column !== 'blocked')
    .filter((c) => c.orderEdges.every(isDone))
    .map((c) => ({
      id: c.id,
      column: c.column,
      title: c.title,
      priority: c.priority,
      unblocks: unblocks.get(c.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.unblocks - a.unblocks ||
        String(a.priority ?? 9).localeCompare(String(b.priority ?? 9)),
    )
}

/** The READY QUEUE over this file's own corpus walk. Public API, frozen. */
export function readyQueue(designDir: string): ReadyCard[] {
  const { cards } = loadCorpus(designDir)
  return readyQueueFrom(
    cards.map((c) => ({
      id: c.id,
      column: c.column,
      title: c.title,
      priority: c.fm['priority'],
      orderEdges: orderEdges(c),
    })),
  )
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
        const k = normalizeTrddRef(child.replace(/^TRDD-/i, ''))
        if (!claimedBy.has(k)) claimedBy.set(k, [])
        claimedBy.get(k)!.push({ parent: c.id, kind })
      }
    }
  }

  for (const c of cards) {
    // NEVER autofix a card whose frontmatter did not PARSE (TRDD-5XJWR473). Such a card
    // arrives with every field reading as absent, so each "missing field" repair below
    // fires and inserts a duplicate of something already in the file — and because the
    // insertion does not make the YAML parseable, the next run inserts another, and the
    // next. Unbounded corruption, produced by the tool whose job is to repair.
    //
    // Reported instead: `runDoctor` raises UNPARSEABLE (severity error, autofixable
    // false) for exactly these cards, so a human sees it rather than a silent skip.
    // Broken frontmatter is a judgement call — which of the two `column:` lines is real
    // is not something a mechanical pass can know.
    if (c.parseError) continue

    const changes: string[] = []
    // Re-read the ONE file about to be repaired, rather than carrying every file's bytes
    // through the lint path to serve the rare fix path (TRDD-BQC8NQSW).
    let text: string
    try {
      text = fs.readFileSync(c.filePath, 'utf8')
    } catch (err) {
      // ENOENT is the one benign case: a concurrent `git mv` lifecycle transition moved
      // the card out from under us, which is normal traffic on a TRDD corpus. Repairing
      // it would RE-CREATE the file at its old path, so skipping is the only correct
      // action. Any other errno is a real fault on a file we just parsed successfully,
      // and swallowing it would drop a repair without a word.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue
      throw err
    }
    const hasFm = /^---\r?\n/.test(text)

    // A file with no frontmatter at all: build one from the H1 + git.
    if (!hasFm) {
      const title = c.h1.replace(/^TRDD-[0-9a-fA-F-]+\s+—\s+/, '').trim()
      const created = gitFirstCommitDate(c.filePath) ?? stamp
      const id = normalizeTrddRef(path.basename(c.filePath).replace(/^TRDD-(?:\d{8}_\d{6}[+-]\d{4}-)?/, '').slice(0, 8))
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
      // A COLUMN VALUE sitting in the `status:` field.
      //
      // USER ruling 2026-07-30: `status:` is NOT a retired duplicate of `column:` — it
      // carries a DIFFERENT aspect, and the pillar specs already use it that way
      // (`status: normative`). Both branches below used to key on the FIELD NAME, which made
      // this fixer a DESTROYER of a legitimate field:
      //
      //   (a) with a column present it DELETED the `status:` line whatever it held, so a
      //       `status: normative` vanished silently;
      //   (b) with no column it REWROTE `status: X` into `column: <mapped>`, and the
      //       `?? 'todo'` swallowed every unmapped value — converting a field into a
      //       different field with an invented value. Worse than a delete: the original is
      //       unrecoverable and the card now asserts a state nobody chose.
      //
      // So both branches now require the VALUE to be a recognised pipeline state. That is
      // the only shape we can PROVE is v1 residue. A `status:` holding anything else is the
      // field doing its own job and is left untouched — a fixer must never guess.
      const status = c.fm['status']
      const statusRaw = status === undefined ? '' : String(status).trim()
      const statusKey = statusRaw.toLowerCase()
      const mappedFromV1 = V1_STATUS_TO_COLUMN[statusKey]
      const statusIsPipelineState = isPipelineStateValue(statusRaw)

      if (statusIsPipelineState && c.column) {
        // (a) redundant pipeline state alongside a live column → drop it. Never let the
        // dead spelling overwrite the live one.
        const agrees = mappedFromV1 === c.column || statusKey === c.column
        text = text.replace(/^status:.*\n/m, '')
        changes.push(
          agrees
            ? `dropped \`status: ${statusRaw}\` (a column value, redundant — \`column: ${c.column}\` already says it)`
            : `dropped \`status: ${statusRaw}\`; KEPT \`column: ${c.column}\` (both held a pipeline state and disagreed — the v2 state machine wins)`,
        )
      } else if (statusIsPipelineState) {
        // (b) the pipeline state is only in `status:` → migrate it to its own field. Safe
        // ONLY because the value is a recognised state; no default, no guess.
        const mapped = mappedFromV1 ?? statusKey
        text = text.replace(/^status:.*$/m, `column: ${mapped}`)
        changes.push(`status: ${statusRaw} → column: ${mapped} (a column value in the wrong field)`)
      }
      // A `status:` whose value is NOT a pipeline state is deliberately left alone.
      //
      // Missing column. The condition is `!statusIsPipelineState`, NOT `status === undefined`:
      // a card carrying a legitimate `status: normative` and no column must still GET a
      // column, exactly like a card carrying no status at all. Keying on the field's mere
      // presence would leave it column-less forever, because branch (b) above no longer
      // fires for it — the two conditions have to be complements or the card falls through
      // both. Adding the missing field is not repurposing the other one: `status:` survives.
      if (!c.column && !statusIsPipelineState) {
        // INSERT only when there is genuinely no `column:` KEY.
        //
        // `c.column` is falsy for TWO different shapes: "no key at all", and "the key is
        // there with an EMPTY value" (`column:` parses to `column: null`, which yields ''
        // and NO parseError, so the `if (c.parseError) continue` guard above cannot see
        // it). Blind-inserting into the second shape writes a SECOND `column:` line, and
        // js-yaml then throws `duplicated mapping key` — the card becomes permanently
        // UNPARSEABLE, drops off the board, and is un-fixable by that same guard, which
        // keys on the PRE-fix state and so can never see damage this pass just caused.
        // A repairer that manufactures the corruption it screens for is the worst case.
        const hasColumnKey = /^column:/m.test(text)
        const next = hasColumnKey
          ? text.replace(/^column:.*$/m, 'column: todo')
          : text.replace(/^(trdd-id:.*)$/m, `$1\ncolumn: todo`)
        // Report only a repair that ACTUALLY LANDED. The push used to be unconditional,
        // so a card whose frontmatter carries no `trdd-id:` line (the anchor) had its
        // replace no-op while `--fix` still claimed the repair, still bumped `updated:`,
        // and still wrote — so the card stayed column-less, the claim repeated every run,
        // and its board sort key floated to the top forever. `--fix` never converged.
        if (next !== text) {
          text = next
          changes.push('column: todo (was missing — the uncertainty law)')
        }
      }
      // uppercase the id
      if (c.fm['trdd-id'] && !/^[A-Z0-9]{8}$/.test(String(c.fm['trdd-id']))) {
        const short = normalizeTrddRef(String(c.fm['trdd-id']).slice(0, 8))
        text = text.replace(/^trdd-id:.*$/m, `trdd-id: ${short}`)
        changes.push(`trdd-id → ${short} (8-char UPPERCASE base36)`)
      }
      // title from H1
      if (!c.title) {
        const title = c.h1.replace(/^TRDD-[0-9a-fA-F-]+\s+—\s+/, '').trim()
        if (title) {
          // Same two-shapes hazard as `column:` above — an empty `title:` parses to null,
          // so inserting would produce a duplicate key and an unparseable card.
          const hasTitleKey = /^title:/m.test(text)
          const line = `title: ${title.replace(/:/g, ' —')}`
          const next = hasTitleKey
            ? text.replace(/^title:.*$/m, line)
            : text.replace(/^(trdd-id:.*)$/m, `$1\n${line}`)
          if (next !== text) {
            text = next
            changes.push('title lifted from the H1')
          }
        }
      }

      // A body state claim that AGREES with `column:` → drop the duplicate line (3P-TRDD-10).
      //
      // Only the agreeing case is derivable. A DISAGREEING claim is left byte-for-byte alone:
      // which of the two states is true is a judgement — four of this corpus's cards say
      // `column: complete` beside `**Status:** Not started` and either could be the truth —
      // and picking one silently is how a tool loses work. The lint reports it; nothing here
      // touches it.
      //
      // `bodyClaimAgreesWithColumn` is the SAME predicate the lint uses, so `--fix` can never
      // repair a shape the lint did not report (the drift the sibling rule shipped with).
      if (c.bodyStateClaim && bodyClaimAgreesWithColumn(c.bodyStateClaim, c.column)) {
        const stripped = removeBodyStateClaimLine(text)
        if (stripped !== null) {
          text = stripped
          changes.push(
            `dropped the body's \`Status: ${c.bodyStateClaim.slice(0, 40)}\` line (a second copy of \`column: ${c.column}\`, free to go stale)`,
          )
        }
      }

      // The missing half of a derivation back-link. Only when EXACTLY ONE parent claims
      // this child AND the child already names that same parent — then `derived: true`
      // and `derived-kind:` follow mechanically from the parent's own npt:/eht:. Two
      // claimants means a genuine lineage bug; writing the flag would hide it.
      const claims = claimedBy.get(c.id) ?? []
      const parentField = normalizeTrddRef(String(c.fm['parent-trdd'] ?? '').replace(/^TRDD-/i, ''))
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
