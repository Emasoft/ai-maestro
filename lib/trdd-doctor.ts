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
import { bodyStartIndex, countAcceptanceBoxes } from './trdd-body'
import { TRDD_ZONES, type TrddZone, listTrddFiles, parseTrddFile, isoLocal } from './trdd-store'
import {
  toGraphNode,
  type TrddNode,
  checkTrddInvariants,
  normalizeTrddRef,
  refList,
  localRefList,
  BLOCKER_FIELDS,
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
  defaultColumnForMissing,
  expectedZone,
  frontmatterDay,
  parkReason,
} from './trdd-vocabulary'
export { BRACKET_COLUMNS, VALID_COLUMNS, isPipelineStateValue, WORKING_COLUMNS, AUTHORITY_RANK, TIER_TO_REQUIREMENT, defaultColumnForMissing }

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
  /**
   * Count of `<!-- @trdd:design-body -->` divider lines in the body (3P-TRDD-13). Reduced
   * to an integer IN THE STREAM, same reason as the fields above. 0 = no design body.
   */
  designDividers: number
}

/** Counts `<!-- @trdd:design-body -->` occurrences that sit alone on their own line (3P-TRDD-13). */
export function countDesignDividers(body: string): number {
  return body.split('\n').filter((l) => l.trim() === '<!-- @trdd:design-body -->').length
}

import { SHIPPED } from './trdd-vocabulary'
import { scopeOfDesignDir } from './pillar/kinds'
import { corpusIdentity } from '@/lib/corpus-identity'

/** A grep-first bool field is written `true`/`false` (bare or quoted). Anything else is undefined. */
export function boolFieldValue(v: unknown): boolean | undefined {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return undefined
}

/** Parses an ISO-8601 datetime (with or without a colon in the offset) to epoch ms, or null. */
export function parseIsoMs(v: unknown): number | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : ms
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
// `bodyStartIndex` and `countAcceptanceBoxes` MOVED to lib/trdd-body.ts (TRDD-I8UC56GZ):
// `checkTrddBox` in trdd-store needs the SAME walk to resolve an ordinal, and two copies
// of this predicate had already diverged (start index, and unclosed frontmatter) before
// either shipped. Re-exported so every importer of this module is unchanged.
export { countAcceptanceBoxes }

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
 * The GRANDFATHER BOUNDARY of the parked-card blocker-probe gate (TRDD-CV5KDCB7).
 *
 * A parked card TOUCHED (`updated:`) on/after this day without a runnable probe is an ERROR;
 * an older one is a WARN. Measured on landing day: 23 parked cards, 22 without a probe, none
 * of the 22 touched that day — so day one emits 22 warns and ZERO errors, and the live
 * zero-ERROR census stays meaningful. Touching a parked card is the moment to add its probe
 * (the same migrate-on-next-touch policy `approval-tier` retired under).
 */
export const PROBE_GATE_SINCE = '2026-08-27'

/** `blocker-holds-if:` grammar — deliberately tiny, no expression language (TRDD-CV5KDCB7). */
export const BLOCKER_HOLDS_IF_RE = /^(exit-0|exit-nonzero|match:\S.*|not-match:\S.*)$/

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
 * Is this parsed frontmatter value a DATETIME whose notation is NOT the mandated one?
 * (TRDD-S13L6R9R)
 *
 * IND `trdd-design-tasks` step 4 is titled "Frontmatter is grep-first", and under it:
 * *"Dates are ISO 8601 with the local offset (`%Y-%m-%dT%H:%M:%S%z`)"*. Five write
 * routes stamped `toISOString()` instead, so the corpus carries a second, UTC-`Z`
 * dialect of its own date format.
 *
 * The detector is a MEASURED property of the format, not a trick: the mandated `%z`
 * offset is COLON-LESS, which YAML 1.1's timestamp grammar does not accept — so
 * gray-matter leaves a CONFORMING value as a `string` and coerces every non-conforming
 * one (`…Z`, `…+02:00`) to a `Date`. `tests/unit/trdd-date-notation.test.ts` pins both
 * directions, so a parser upgrade that changed this reddens the control rather than
 * letting the detector go silently blind.
 *
 * Keyed on the VALUE, never a field-name list — `STATUS-HOLDS-COLUMN-VALUE` below is
 * written the way it is because name-keying once turned this tool into a deleter of a
 * legitimate field.
 *
 * SCOPE: a value with NO time-of-day is a DATE, not a datetime (`review-after:
 * YYYY-MM-DD`, which YAML also coerces), and the datetime-notation rule does not govern
 * it. Rewriting one would corrupt a park field the IND rule requires to fail OPEN. The
 * cost of that scope is that a `Z` datetime landing on exactly midnight UTC is missed —
 * the safe direction: never corrupt, occasionally miss.
 */
function dateFieldRepairable(field: string, column: string): boolean {
  // On a FROZEN card, exactly one dated field is in reach. IND step 12: *"Only `updated:`
  // (and, when superseding, `superseded-by:`) may change"* — so `updated:` is the one
  // frontmatter field the terminal freeze NAMES as changeable, and re-spelling its notation
  // is the exemption's own subject rather than a breach of it. Every other dated field on a
  // frozen card is out of reach.
  //
  // The LINT uses this too, deliberately: a rule that reported a frozen card's
  // `approval-datetime:` would be a finding nobody is permitted to fix, and this repo has
  // already shipped the mirror of that bug — a `--fix` repairing a shape the lint never
  // reported. One predicate, both sides.
  return field === 'updated' || !TERMINAL_DONE.includes(column)
}

function offFormatDatetime(v: unknown): Date | null {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return null
  const noTimeOfDay =
    v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0
  return noTimeOfDay ? null : v
}

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
// Exported for the gate test's PRESENCE pin (TRDD-U1EYWIPT follow-up): a retired exclusion must
// assert its card is still IN the corpus as `superseded` through the SAME walker the doctor
// uses — a glob over design/archived/ would pass on a file the walker cannot parse, which is
// exactly the vanished-or-unparseable state the pin exists to catch (ATOM-XC3R-GAZ4).
export function loadCorpus(designDir: string): { cards: Card[]; unparsed: string[]; nodes: TrddNode[] } {
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
        designDividers: countDesignDividers(body),
      })
      const node = toGraphNode(parsed)
      if (node) nodes.push(node)
      // `parsed` — and with it the body — goes out of scope here. That release is the fix.
    }
  }
  return { cards, unparsed, nodes }
}

// `expectedZone` MOVED to lib/trdd-vocabulary.ts (TRDD-I8UC56GZ) so the write-time gate
// can ask it without importing this file — which imports trdd-store and trdd-graph, and
// would put a corpus walker behind every write. Re-exported so every importer is unchanged.
export { expectedZone }

export function lintCorpus(designDir: string): DoctorReport {
  const { cards, unparsed, nodes } = loadCorpus(designDir)
  const findings: Finding[] = []
  const add = (f: Finding) => findings.push(f)
  // Classified ONCE, from the walk root, never per card. A card found under this root
  // is in this corpus by construction, so per-file classification would ask a path-shape
  // question 659 times and get it wrong wherever a card's own path happens to carry a
  // recognised segment for an unrelated reason — a vendored copy, a fixture written into
  // a tmp tree, a checkout living under a .claude path. The blast radius of one such
  // coincidence is every card in the corpus, not one, because they all declare the same
  // scope. It also removes a cwd sensitivity: a relative --design-dir resolves against
  // process.cwd(), so a per-card classify could answer differently from two directories.
  // CONTAINMENT IS LEXICAL AND VERIFIED, not assumed: listDocuments joins the zone onto
  // the root, readdirs it, and joins each name back on, so every card path this walk
  // yields sits under designDir by construction. A runtime startsWith guard here would
  // be dead code.
  //
  // The case that is NOT dead, and is decided here rather than left to chance: a zone
  // that is itself a SYMLINK to a tree elsewhere. Classifying per card would realpath
  // through it and answer by where the bytes live; classifying from the root answers by
  // which corpus reaches the card. The second is the right question — a card in this
  // corpus's archived/ is this corpus's card, wherever its storage happens to sit — and
  // it is pinned by a test rather than left as an emergent property.
  const corpusScope = scopeOfDesignDir(designDir)
  const corpusRealRoot = corpusIdentity(designDir)

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
        message: `no \`column:\` — the card cannot be placed on the board, so it appears in NO count and NO column (it is invisible, not broken). Auto-fix sets \`${defaultColumnForMissing(c.fm)}\` per the uncertainty law (3P-TRDD-11: backburner unless approved; design, or design_ai_review when a design body is already present)`,
        autofixable: true,
      })
    } else if (!VALID_COLUMNS.includes(c.column)) {
      add({
        rule: 'COLUMN-UNKNOWN',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `column '${c.column}' is not one of the ratified 22 (+ bracket) values — every consumer aligns TO this vocabulary, never the reverse`,
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

    // ---- SCOPE-CONTRADICTS-PATH (ai-maestro#163) ----
    // The READER half of scope derivation. Until this existed the field had a correct
    // writer and nothing that ever compared it to anything, which is the same amount of
    // information as the hardcoded literal it replaced.
    //
    // ABSENCE IS LEGAL AND IS NOT A FINDING. The rule states that a missing `scope:`
    // means project, and 312 of this repo's 659 cards omit it. A lint treating absence
    // as disagreement would report half the corpus and be routed around within a day.
    // Only a card that DECLARES a scope contradicting its own path is provably wrong.
    //
    // The path is authoritative, so the declared value is what gets flagged — never the
    // other way round. This is the tripwire the migration needs: after cards move
    // between scope roots, a stale `scope:` is the signal that a move did not land.
    //
    // NOT autofixable, deliberately. The repair is either "rewrite the field" or "move
    // the file", and which one is right depends on whether the move or the field was
    // the mistake — a judgement a fixer cannot make. Guessing here would be the
    // STATUS-HOLDS-COLUMN-VALUE bug again: a tool deleting a legitimate value in the
    // one place a tool must not guess.
    const declaredScope = fmHas('scope') ? String(c.fm['scope']).trim() : ''
    if (declaredScope) {
      const actualScope = corpusScope
      if (declaredScope !== actualScope) {
        add({
          rule: 'SCOPE-CONTRADICTS-PATH',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `\`scope: ${declaredScope}\` contradicts the card's own location, which is a ${actualScope} corpus. The PATH is authoritative (ai-maestro#163), so either the card moved and the field went stale, or the field was hand-written wrong. Not auto-repaired: rewriting the field and moving the file are both plausible fixes and only a human knows which move was intended.`,
          autofixable: false,
        })
      }
    }

    // ---- CARD-STORED-OUTSIDE-CORPUS (ai-maestro#163) ----
    // The privacy half, and the reason the rule above is safe to classify from the root.
    //
    // `scope:` encodes a PRIVACY boundary — local means machine-private and never pushed —
    // and privacy attaches to where the BYTES live, not to what can reach them. Classifying
    // from the walk root answers "which corpus reaches this card", which is right for
    // membership and, alone, blesses a laundering path: symlink a local zone into a
    // git-tracked project corpus, declare `scope: project`, and the rule above certifies it.
    // The machine-private cards are then reachable from a pushed tree, signed off by the
    // check that exists to catch exactly that mismatch.
    //
    // This is the guard that closes it, and unlike a lexical containment check it is NOT
    // dead code. listDocuments joins the zone onto the root, readdirs, and joins each name
    // back on, so every card path is LEXICALLY under the root by construction — a
    // startsWith on those strings can never fire. Comparing REALPATHS can: it fires exactly
    // when a zone or a card is a symlink pointing out of the corpus, which is the laundering
    // shape and nothing else.
    //
    // Not autofixable. The repair is to move the bytes or remove the link, and which one is
    // right depends on where the card was meant to live — a judgement a fixer cannot make.
    const realCard = corpusIdentity(c.filePath)
    if (realCard !== corpusRealRoot && !realCard.startsWith(corpusRealRoot + path.sep)) {
      add({
        rule: 'CARD-STORED-OUTSIDE-CORPUS',
        // `error`, and a WARN here was measured to be deletion. I demoted this to `warn`
        // one commit ago reasoning that it still carried the signal — then checked, and
        // `trddgrep validate` exits 0 with this finding present. It PRINTS it and gates on
        // nothing. Only `--strict` counts warnings, and nothing invokes --strict by
        // default, so a warn on a privacy boundary is a finding nobody's automation reads.
        //
        // The DATETIME rule beside this one IS correctly a warn, and citing it was the
        // mistake: its own comment justifies the severity because both datetime dialects
        // parse to a valid instant — no correctness consequence. Here the consequence is a
        // privacy boundary, so the precedent's verdict does not transfer with its reasoning.
        //
        // The benign population this was demoted to protect is HYPOTHETICAL — a corpus
        // symlinked into a synced volume. The measured one is zero: 0 symlinks across all
        // 9 local corpora on this host. Blocking a real laundering path outranks sparing a
        // user nobody has observed, and that user gets a loud, fixable error rather than a
        // silent pass.
          severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `this card is reachable from the corpus but its bytes live at ${realCard}, outside it. A scope is a privacy boundary and privacy follows the storage, so a card symlinked in from another scope can declare the reached corpus's scope and be certified by SCOPE-CONTRADICTS-PATH. Move the file or remove the link; not auto-repaired, because which of those is right depends on where the card was meant to live.`,
        autofixable: false,
      })
    }

    // ---- frontmatter DATETIME notation (TRDD-S13L6R9R) ----
    // The write side is fixed (`isoLocal()` is now the one stamp), but nothing PREVENTED
    // the drift for the weeks it ran, and a sixth write path would repeat it in silence.
    // This is that guard. Rationale + the review-after scope: `offFormatDatetime`.
    //
    // `warn`, not `error`: both dialects parse to a valid instant, and no `.sort()` keyed
    // on `updated:` exists in this repo's tracked source (the "the board sorts on
    // `updated:`" claim appears in a spec clause and three comments; the sort itself, if
    // it exists, is in `trddgrep`, a separate binary). So this is a format split in a
    // grep-first corpus, not a live ordering bug — and keeping it out of `error` keeps
    // the zero-ERROR corpus gate meaningful.
    for (const [field, value] of Object.entries(c.fm)) {
      if (!offFormatDatetime(value) || !dateFieldRepairable(field, c.column)) continue
      add({
        rule: 'DATE-NOT-LOCAL-OFFSET',
        severity: 'warn',
        id: c.id,
        filePath: c.filePath,
        message: `\`${field}:\` carries a UTC-\`Z\` instant instead of the mandated \`%Y-%m-%dT%H:%M:%S%z\` local offset — two date dialects in one grep-first corpus. Auto-fix CONVERTS the instant it already holds; it never stamps \`now\``,
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
      // A v1-era card (UUID filename) predates the `column:` vocabulary: its `**Status:**` line
      // was the ONLY state field it ever had, so a mismatch there is history, not two live
      // claims. And rule 12 freezes it once archived, so ERROR names a defect nobody may repair
      // (7123D51A stood red for 3 months). WARN keeps the finding visible; ERROR is reserved for
      // cards that could carry the column and chose to contradict it (TRDD-55H0DOO6).
      const v1Filename = /TRDD-[0-9a-f]{8}-[0-9a-f]{4}-/i.test(path.basename(c.filePath))
      add({
        rule: 'BODY-STATE-CLAIM',
        severity: agrees || v1Filename ? 'warn' : 'error',
        id: c.id,
        filePath: c.filePath,
        message: agrees
          ? `the body restates the pipeline position ("${c.bodyStateClaim}") that \`column: ${c.column}\` already owns — a second copy, free to go stale (3P-TRDD-10)`
          : `the body claims "${c.bodyStateClaim}" while \`column: ${c.column}\` — the card asserts TWO states at once, and a reader nineteen lines in believes the body (3P-TRDD-10). Which is true is a judgement, so this is never auto-repaired`,
        // Only the AGREEING case is derivable: drop the redundant line. A disagreement must
        // never be auto-resolved — picking one silently is how a tool loses work.
        //
        // AND ONLY ON A CARD THAT IS NOT FROZEN (TRDD-I8UC56GZ). The fixer's own branch
        // carries `!frozen` — deliberately, because IND step 12 freezes a terminal card's
        // body and permits removing a body line only when it FALSELY contradicts the
        // column, which is the disagreeing case, not this one. This flag did not carry
        // that condition, so for a terminal card whose body claim AGREES the linter
        // promised a repair the fixer correctly declines. Measured on this corpus: 3
        // findings (70A521D9, EAC02238, EF0C6C0A — all terminal) declared autofixable
        // that `trddgrep fix` has never touched and must never touch. Same defect class
        // as APPROVAL-TIER-DEPRECATED earlier on this card, and subtler: that flag was
        // unconditionally wrong, this one is wrong only on the frozen subset, so the
        // corpus-wide `fix` run looked clean while the promise was live.
        autofixable: agrees && !TERMINAL_DONE.includes(c.column),
      })
    }

    // ---- 3P-TRDD-13 design-lives-in-the-card: the divider + its four state fields ----
    // The divider is the machine-greppable split point between the original body and the
    // design body; the four fields let a board query answer "does this card have a design,
    // and has it been approved" without opening the file. All four are OPTIONAL — a card
    // with none of them and no divider is CONFORMANT and raises nothing here.
    if (c.designDividers > 1) {
      add({
        rule: 'DESIGN-BODY-DIVIDER-DUPLICATE',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: `body contains ${c.designDividers} \`<!-- @trdd:design-body -->\` dividers — at most ONE is allowed, else "the design half" is ambiguous (3P-TRDD-13)`,
        autofixable: false,
      })
    }
    const hasDivider = c.designDividers > 0
    const designIncluded = boolFieldValue(c.fm['design-included'])
    if (hasDivider !== (designIncluded === true)) {
      add({
        rule: 'DESIGN-INCLUDED-MISMATCH',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: hasDivider
          ? '`<!-- @trdd:design-body -->` divider is present but `design-included:` is not `true` — the fields exist so a board query never has to open the body (3P-TRDD-13)'
          : `\`design-included: ${c.fm['design-included']}\` but the body carries no \`<!-- @trdd:design-body -->\` divider — nothing to include`,
        autofixable: false,
      })
    }
    if (boolFieldValue(c.fm['design-approved']) === true && designIncluded !== true) {
      add({
        rule: 'DESIGN-APPROVED-WITHOUT-INCLUDED',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: '`design-approved: true` but `design-included:` is not `true` — a design cannot be approved before it exists (3P-TRDD-13)',
        autofixable: false,
      })
    }
    if (fmHas('first-design-draft') && designIncluded !== true) {
      add({
        rule: 'DESIGN-DRAFT-WITHOUT-INCLUDED',
        severity: 'error',
        id: c.id,
        filePath: c.filePath,
        message: '`first-design-draft:` is set but `design-included:` is not `true` — the draft timestamp names a design body that the card does not declare (3P-TRDD-13)',
        autofixable: false,
      })
    }
    if (fmHas('first-design-draft') && fmHas('last-design-revision')) {
      const first = parseIsoMs(c.fm['first-design-draft'])
      const last = parseIsoMs(c.fm['last-design-revision'])
      if (first !== null && last !== null && last < first) {
        add({
          rule: 'DESIGN-REVISION-BEFORE-DRAFT',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `\`last-design-revision: ${c.fm['last-design-revision']}\` precedes \`first-design-draft: ${c.fm['first-design-draft']}\` — a revision cannot happen before the design existed (3P-TRDD-13)`,
          autofixable: false,
        })
      }
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
          // NOT autofixable BY THIS TOOL, and the distinction is the whole point (TRDD-I8UC56GZ).
          // It IS mechanically derivable — but the approval rules say migrate "on next touch,
          // never in a mass rewrite", and `fix` is exactly a mass rewrite. So the repair lives on
          // the WRITE paths (`migrateLegacyApprovalTier`, run by every transition verb) and a card
          // migrates as work reaches it. This flag used to read `Boolean(decoded)` — true for 82
          // cards `fix` has never touched, which is a linter promising a repair its own fixer does
          // not make: the exact lint-vs-fix predicate drift this repo has been bitten by before,
          // pointed the other way round.
          autofixable: false,
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
      // An unparseable `updated:` FAILS OPEN: the boundary cannot be evaluated, and skipping
      // would silently grandfather the card forever — the gate must flag, never silently
      // skip, when its own input is garbage (TRDD-PTFPGSLV). The boundary itself is an
      // approximation: `updated:` stands in for "when it went terminal" (the closing edit
      // bumps it), and the messages say so via the note below.
      const boundaryNote = day
        ? ''
        : ' (the 2026-07-31 grandfather boundary could not be evaluated: `updated:` is unparseable — failing open; the boundary reads `updated:` as a proxy for the terminal transition)'
      if (!day || day >= CHECKLIST_GATE_SINCE) {
        const back = String(c.fm['pre-block-column'] ?? '').trim() || 'dev'
        if (c.boxes.total === 0) {
          add({
            rule: 'TERMINAL-WITHOUT-CHECKLIST',
            severity: 'error',
            id: c.id,
            filePath: c.filePath,
            message: `is '${c.column}' with NO acceptance checklist — the completion gate is written over boxes that are unchecked, so a card with no boxes passes it having PROVEN NOTHING. Nothing records what this card promised or whether it delivered. Move it back to '${back}', write the checklist, then close it${boundaryNote}`,
            autofixable: false,
          })
        } else if (c.boxes.open > 0) {
          add({
            rule: 'TERMINAL-WITH-OPEN-BOX',
            severity: 'error',
            id: c.id,
            filePath: c.filePath,
            message: `is '${c.column}' with ${c.boxes.open} of ${c.boxes.total} acceptance box(es) still unchecked — a false completion. Either the work is not done (move it back to '${back}') or the box is obsolete and must be struck through with its reason, never silently ticked${boundaryNote}`,
            autofixable: false,
          })
        }
      }
    }

    // ================= `updated:` IN THE FUTURE = a TYPED timestamp =================
    // The board sorts on `updated:`, so a future value parks a card at the top until real time
    // catches up. It has exactly one cause worth guarding: an agent WROTE the timestamp from its
    // own idea of the time instead of reading a clock. That is not hypothetical — it happened four
    // times in one session on 2026-08-29 (13:18/13:34/13:46/13:58 written while the clock read
    // 12:37), and the prose lesson forbidding it was already on file and had been read.
    //
    // Prose did not hold, so this is the check. The skew allowance is deliberately generous: the
    // values carry their own UTC offset, so this compares absolute instants and a legitimately
    // clock-skewed contributor is still nowhere near an hour out — while every instance of the
    // typed-it-from-memory bug has been tens of minutes at least.
    const FUTURE_SKEW_MS = 10 * 60 * 1000
    const updatedRaw = String(c.fm['updated'] ?? '').trim()
    if (updatedRaw) {
      const t = Date.parse(updatedRaw)
      // An UNPARSEABLE value is not this rule's business — `frontmatterDay` above already fails
      // open on it, and two rules reporting one defect is noise.
      if (Number.isFinite(t) && t > Date.now() + FUTURE_SKEW_MS) {
        add({
          rule: 'UPDATED-IN-THE-FUTURE',
          severity: 'error',
          id: c.id,
          filePath: c.filePath,
          message: `has \`updated: ${updatedRaw}\`, which is in the FUTURE — the board sorts on this field, so the card parks at the top until real time catches up. The cause is almost always a timestamp TYPED from memory rather than read: use \`date +%Y-%m-%dT%H:%M:%S%z\` and paste what it prints`,
          autofixable: false,
        })
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

    // ---- a PARKED card must carry a RUNNABLE blocker probe (TRDD-CV5KDCB7) ----
    //
    // A blocker recorded as a VALUE ("the refresh tokens are dead") has a silent timestamp
    // and rots while reading as current — measured 4-in-5 stale across five parked cards in
    // one sitting, and the parking is exactly what stops anyone re-reading it. Recorded as a
    // PREDICATE (`blocker-probe:` argv + `blocker-holds-if:`) it is re-answerable by a
    // machine forever, at zero cost. This is the one step that needs a human, so it is the
    // one step worth enforcing.
    //
    // "Parked" = `column: blocked`, a non-empty `blocked-by:`, a FUTURE `review-after:`, or a
    // `hub-blocked` / `fleet-ask` label. Two false-fire directions this repo has shipped in
    // other gates, both pinned by tests: never fire on an UNPARKED card (a rule that reddens
    // correct work gets routed around), and never accept an EMPTY probe as present (a
    // condition written only over the bad items is vacuous on an empty set).
    //
    // `match:` is TWO-valued where the runner needs THREE: a timeout, a missing script, or an
    // emitter that drifted all produce no-match, which reads as "the blocker cleared" —
    // fail-open, silently, forever. So a `match:` probe MUST declare a canary (a string the
    // HEALTHY output always contains); its absence is verdict "could not run", never
    // "cleared". `not-match:` on a success sentinel is already fail-closed and needs none.
    {
      // LOCAL calendar day — `review-after:` is written local, and `frontmatterDay(new Date())`
      // would go through toISOString() = the UTC day, making a just-expired park read as parked
      // for the hours the two days disagree (review fork, 2026-08-27; test U2 pins it).
      // Built from the getters, NOT `toLocaleDateString('en-CA')`: that is locale DATA standing
      // in for a format — a small-icu Node falls back to en-US and returns `8/27/2026`, which
      // silently breaks every comparison here (review fork, 2026-08-27).
      const now = new Date()
      const todayDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      // The "other" park forms (future review-after, hub-blocked/fleet-ask label) are decided by
      // the shared predicate in lib/trdd-vocabulary.ts — the same call lib/trdd-store.ts makes
      // when it gates entry into `blocked` (TRDD-4P798U6P). The REASON is taken from that call
      // too, never re-derived here from the fields, so the message below can only name a form
      // the predicate actually honoured.
      const otherReason = parkReason(c.fm, todayDay)
      const parked = c.column === 'blocked' || blockedBy.length > 0 || otherReason !== null
      if (parked) {
        const probe = String(c.fm['blocker-probe'] ?? '').trim()
        const holds = String(c.fm['blocker-holds-if'] ?? '').trim()
        const canary = String(c.fm['blocker-probe-canary'] ?? '').trim()
        const day = frontmatterDay(c.fm['updated'])
        // Unparseable `updated:` fails toward error, as the checklist gate does.
        const sev: Finding['severity'] = !day || day >= PROBE_GATE_SINCE ? 'error' : 'warn'
        if (probe === '' || holds === '') {
          add({
            rule: 'BLOCKED-WITHOUT-PROBE',
            severity: sev,
            id: c.id,
            filePath: c.filePath,
            message: `is parked (${c.column === 'blocked' ? 'column blocked' : blockedBy.length ? 'blocked-by non-empty' : otherReason === 'review-after' ? `review-after ${frontmatterDay(c.fm['review-after'])}` : `${otherReason} label`}) with no runnable blocker probe — its blocker is a VALUE with a silent timestamp and will rot while reading as current. Add \`blocker-probe: <argv>\` + \`blocker-holds-if: exit-0|exit-nonzero|match:<re>|not-match:<re>\` (take the needle from the EMITTER's source, never from vocabulary seen elsewhere)`,
            autofixable: false,
          })
        } else if (!BLOCKER_HOLDS_IF_RE.test(holds)) {
          add({
            rule: 'BLOCKER-PROBE-BAD-PREDICATE',
            severity: 'error',
            id: c.id,
            filePath: c.filePath,
            message: `\`blocker-holds-if: ${holds}\` is not one of exit-0 | exit-nonzero | match:<re> | not-match:<re> — a predicate nothing can evaluate is a value wearing a predicate's field`,
            autofixable: false,
          })
        } else if (holds.startsWith('match:') && canary === '') {
          add({
            rule: 'BLOCKER-PROBE-NO-CANARY',
            severity: sev,
            id: c.id,
            filePath: c.filePath,
            message: `\`blocker-holds-if: match:\` without \`blocker-probe-canary:\` — a timeout, a missing script or a drifted emitter all read as "cleared" (fail-open). Declare \`blocker-probe-canary: match:<a string HEALTHY output always contains>\`, or assert the success sentinel with \`not-match:\``,
            autofixable: false,
          })
        }
        // NOTE: `blocker-probe` is checked ABOVE for presence and grammar ONLY — this
        // doctor never EXECUTES it. The field is git-tracked and agent-writable, so
        // making `validate` run an arbitrary `sh -c` string out of frontmatter would be
        // arbitrary command execution for every caller that lints this corpus (CI, the
        // janitor heartbeat, and any cloner of this PUBLIC repo). Release is judged
        // DECLARATIVELY below instead, off `blocked-by:`, never by spawning anything.
      }
    }

    // ---- declarative blocker resolution (TRDD-U1EYWIPT) ----
    //
    // A `column: blocked` card names its blockers in `blocked-by:`. Each id is resolved
    // through the SAME cross-zone `byId` map the NPT-ordering check and the graph
    // delegation below already use (case/prefix-insensitive, via `normalizeTrddRef`) —
    // this is the `findTrdd`-equivalent lookup, not a re-implementation of it. When
    // EVERY blocker resolves to a terminal-done column, nothing is left holding the
    // block and BLOCKER-RELEASED fires; it never auto-moves the card (a release is a
    // decision the owner records against `pre-block-column:`). A blocker id that
    // resolves to NO card in any zone cannot be judged either way, so it is reported
    // BLOCKER-UNRESOLVED and the card stays blocked — fail-open, the same direction as
    // every other probe-adjacent rule in this file, because silently treating an
    // unresolved reference as "cleared" is how a stale block reads as current.
    // Cards parked only by a future `review-after:` or a `hub-blocked`/`fleet-ask`
    // label carry no `blocked-by:` and are out of scope here — nothing in that shape
    // claims to be waiting on another CARD, so there is nothing to resolve.
    if (c.column === 'blocked' && blockedBy.length > 0) {
      const unresolved = blockedBy.filter((b) => !byId.get(b)?.[0])
      if (unresolved.length > 0) {
        add({
          rule: 'BLOCKER-UNRESOLVED',
          severity: 'warn',
          id: c.id,
          filePath: c.filePath,
          message: `\`blocked-by:\` names ${unresolved.join(', ')} which resolve(s) to no card in any zone — cannot judge whether the block still holds, so it stays blocked (fail-open)`,
          autofixable: false,
        })
      } else {
        const resolved = blockedBy.map((b) => ({ id: b, card: byId.get(b)![0] }))
if (resolved.every((r) => SHIPPED.has(r.card.column))) {
          const restore = String(c.fm['pre-block-column'] ?? '').trim()
          add({
            rule: 'BLOCKER-RELEASED',
            severity: 'error',
            id: c.id,
            filePath: c.filePath,
            message: `\`blocked-by:\` [${resolved.map((r) => `${r.id}:${r.card.column}`).join(', ')}] are ALL terminal-done — nothing is left holding this block. Restore to \`${restore || 'no restore point recorded — pre-block-column: is empty'}\` (this doctor never auto-moves a card; the release is a decision the owner records)`,
            autofixable: false,
          })
        }
      }
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
    // The THIRD arm of the same invariant, and the one that was missing.
    //
    // `approved: false` means "nobody has signed off" — pending, or overtaken by a newer card. The
    // governance overlay states it as `approved: false ⟺ column ∈ {proposal, superseded}`. The two
    // arms above cover `rejected` and `true`; a card claiming `approved: false` from a WORKING
    // column was checked by nothing, so the board could show it as authorized work while the card
    // itself said the opposite. Measured 2026-08-05: NINE such cards in `design/tasks/`, four of
    // them at a `manager`/`user` floor — i.e. sitting in the authorized folder awaiting an approval
    // that nobody had been told was outstanding.
    //
    // WARN, not ERROR, deliberately. Each of the nine needs a HUMAN judgement — mis-filed, or
    // genuinely pending and needing routing to its approver — and an ERROR here would redden the
    // corpus gate over a governance backlog, which is how a linter gets routed around rather than
    // read. Not autofixable for the same reason: moving a card between zones is a governance act,
    // not a format repair.
    const PENDING_COLUMNS = new Set(['proposal', 'superseded'])
    if (approved === false && c.column && !PENDING_COLUMNS.has(c.column)) {
      const floor = String(c.fm['min-approval-requirement'] ?? 'none')
      add({
        rule: 'APPROVAL-UNAPPROVED-IN-WORK-ZONE',
        severity: 'warn',
        id: c.id,
        filePath: c.filePath,
        message:
          `approved: false but column is '${c.column}' — the card sits in the authorized-work set while asserting nobody approved it` +
          (floor === 'none'
            ? '. Its floor is `none`, so it is a self-mandate and `approved: true` is almost certainly the missing edit'
            : `. Its floor is '${floor}', so it is genuinely awaiting that approver and belongs in \`design/proposals/\` (column: proposal) until they rule`),
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
  // The two non-local-blocker kinds are WARN, not ERROR: the blocker is real and correctly
  // recorded — the local graph just cannot resolve it (TRDD-PTFPGSLV).
  const GRAPH_WARN_KINDS = new Set(['externalBlocker', 'crossProjectBlocker'])
  for (const v of checkTrddInvariants(nodes)) {
    const id = normalizeTrddRef(v.id)
    add({
      rule: `GRAPH-${v.kind.replace(/([A-Z])/g, '-$1').toUpperCase()}`,
      severity: GRAPH_WARN_KINDS.has(v.kind) ? 'warn' : 'error',
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
  // Through the graph's OWN per-field helper, so a non-local `blocked-by:` spelling is
  // dropped here exactly as it is by the graph and the index (TRDD-PTFPGSLV) — two feeders
  // of one ranker must drop the same edge for the same reason.
  return BLOCKER_FIELDS.flatMap((f) => localRefList(f, c.fm[f]))
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
    return !c || SHIPPED.has(c.column)
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
  /**
   * Whether this card's `updated:` was moved. False for a purely MECHANICAL repair set —
   * see the `record` helper in `fixCorpus` for the test and why it matters.
   */
  bumped: boolean
}

/**
 * Card-to-card reference fields — depth-1 edges for the neighbourhood fixer below
 * (TRDD reference-consistency, Phase 6). `relevant-rules` is deliberately excluded: it
 * points at PRRD rules, not TRDD cards, so it plays no part in this graph.
 */
const CARD_REFERENCE_FIELDS = ['blocked-by', 'npt', 'eht', 'parent-trdd', 'supersedes', 'superseded-by'] as const

/**
 * `unblock-when: [<pred>, ...]` predicates of kind `trdd:` are also card references (the
 * IND base rule, `trdd-design-tasks.md`). Every other kind (`issue:`, `file:`, `log:`,
 * `date:`, `decision:`) names something that is not a TRDD card, so it is excluded here.
 * Accepts both the string form (`"trdd: TRDD-XXXXXXXX"`) and an object form (`{ trdd: '...' }`)
 * — the grammar is not yet pinned in this codebase, so both are read defensively.
 */
function unblockWhenTrddRefs(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const pred of v) {
    if (typeof pred === 'string') {
      const m = pred.match(/^\s*trdd\s*:\s*(.+?)\s*$/i)
      if (m) out.push(normalizeTrddRef(m[1]))
    } else if (pred && typeof pred === 'object' && typeof (pred as Record<string, unknown>).trdd === 'string') {
      out.push(normalizeTrddRef((pred as Record<string, unknown>).trdd as string))
    }
  }
  return out.filter(Boolean)
}

/** Every card `c` references, over `CARD_REFERENCE_FIELDS` plus `unblock-when: [trdd: …]`. */
function cardReferences(c: Card): string[] {
  const out: string[] = []
  for (const field of CARD_REFERENCE_FIELDS) out.push(...refList(c.fm[field]))
  out.push(...unblockWhenTrddRefs(c.fm['unblock-when']))
  return out
}

/**
 * The rule codes a neighbourhood repair (`fixCorpus`'s `neighbourhoodOf`) is allowed to
 * apply to a card OTHER than the one it was asked to fix. Reference-consistency findings
 * are the ones whose fact is partly owned by ANOTHER card — repairing them can require
 * touching that other card. Every other autofixable finding (a date re-spelling, a missing
 * title, …) is local to its own card and stays target-only.
 *
 * Membership in this set is the WHOLE test, checked at each repair's own site — never a
 * per-rule judgement call, or "minimize intervention" has no enforceable meaning.
 */
export const REFERENCE_CONSISTENCY_RULES: ReadonlySet<string> = new Set([
  // derived/parent back-link (npt:/eht: <-> derived:/derived-kind:/parent-trdd:)
  'DERIVED-FLAG-MISSING',
  'GRAPH-TWO-PARENTS',
  'GRAPH-KIND-MISMATCH',
  'GRAPH-PARENT-MISMATCH',
  'GRAPH-CHILD-DERIVED-FALSE',
  'GRAPH-PARENT-IS-DERIVED',
  'GRAPH-UNCLAIMED',
  'GRAPH-DEPTH1',
  // dangling reference (npt:/eht:/parent-trdd:/blocked-by: naming a card that does not exist)
  'GRAPH-CHILD-MISSING',
  'GRAPH-UNKNOWN-BLOCKER',
  // blocker resolution (blocked-by: vs. the blocker's own column)
  'BLOCKER-UNRESOLVED',
  'BLOCKER-RELEASED',
  // supersede attribution (superseded-by: naming a card that does not exist)
  'DANGLING-REF',
])

/**
 * The target card, plus every card that references it, plus every card it references —
 * DEPTH 1 ONLY, over `CARD_REFERENCE_FIELDS` (+ `unblock-when` `trdd:` predicates). This is
 * the write scope `fixCorpus`'s `neighbourhoodOf` narrows to: "broad but only for updating
 * cards referencing or referenced by the target card" (the owner's ruling on issue 160).
 */
export function referenceNeighbourhood(cards: readonly Card[], targetId: string): Set<string> {
  const target = normalizeTrddRef(targetId)
  const neighbours = new Set<string>([target])
  const byId = new Map<string, Card>()
  for (const c of cards) byId.set(c.id, c)
  const targetCard = byId.get(target)
  if (targetCard) for (const ref of cardReferences(targetCard)) neighbours.add(ref)
  for (const c of cards) if (cardReferences(c).includes(target)) neighbours.add(c.id)
  return neighbours
}

/**
 * Repair the mechanical defects. Returns what it changed; writes nothing when `dryRun`.
 *
 * It will NOT invent a column. Every unknown column becomes `todo` — the honest answer
 * to "we do not know", and the only one that keeps the card visible.
 */
export function fixCorpus(
  designDir: string,
  opts: { dryRun?: boolean; now?: string; selector?: (c: Card) => boolean; neighbourhoodOf?: string } = {},
): FixResult[] {
  const { cards } = loadCorpus(designDir)
  // `isoLocal()` replaces an inline `toISOString().replace(/\.\d+Z$/, '+0000')`. That
  // `.replace` existed BECAUSE the raw form is wrong here — it fixed the shape and left
  // the zone as UTC, so the doctor wrote `+0000` while the corpus writes the local offset.
  // Two definitions of one format, and this was the second (TRDD-S13L6R9R). The `opts.now`
  // seam is unchanged: every test injects it, so nothing depended on the default's zone.
  const stamp = opts.now ?? isoLocal().iso
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

  // NEIGHBOURHOOD NARROWING (Phase 6, TRDD reference-consistency): `neighbourhoodOf`
  // narrows the write to the target's depth-1 reference neighbourhood
  // (`referenceNeighbourhood`, defined above `fixCorpus` in this file) — the target, every
  // card that references it, and every card it references. On a card that is NOT the
  // target, only a reference-consistency repair may run (checked against
  // `REFERENCE_CONSISTENCY_RULES` at that repair's own site, below); every OTHER repair is
  // gated `if (isTarget)`. No `neighbourhoodOf` (every caller today) leaves `isTarget`
  // always true, so today's whole-corpus behaviour is unchanged.
  const neighbourhoodTarget = opts.neighbourhoodOf ? normalizeTrddRef(opts.neighbourhoodOf) : null
  const neighbourhood = neighbourhoodTarget ? referenceNeighbourhood(cards, neighbourhoodTarget) : null

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
    // NARROWING THE WRITE, NOT THE READ. `cards` above is the WHOLE corpus (`loadCorpus`)
    // and `claimedBy` above is built over EVERY card, both unfiltered — the repairs below
    // are partly CROSS-CARD (the `derived:` back-link needs every parent's `npt:`/`eht:`).
    // `selector` only decides which card's repair, if any, is actually computed and
    // written in THIS iteration. No `selector` (the whole-corpus batch callers) means
    // every card is still eligible — today's whole-corpus behaviour, unchanged.
    if (opts.selector && !opts.selector(c)) continue
    if (neighbourhood && !neighbourhood.has(c.id)) continue
    const isTarget = !neighbourhoodTarget || c.id === neighbourhoodTarget

    const changes: string[] = []
    let semantic = false
    /**
     * Record a repair AND its verdict. The kind is a REQUIRED argument precisely so a new
     * branch cannot be added without deciding it — an implicit default is how this bug
     * shipped in the first place.
     *
     * The test is the rule's own: does the repair CHANGE WHAT THE CARD ASSERTS?
     *
     * - MECHANICAL — the card asserts exactly what it asserted before. A second copy of a
     *   fact removed, a value re-spelled, a denormalized pointer restored from evidence that
     *   was already on disk. Nothing a reader believes about the card has changed.
     * - SEMANTIC — the card now claims something it did not. A pipeline state invented,
     *   resolved, or lifted into the field consumers actually read; a frontmatter created.
     *
     * When in doubt choose `'mechanical'`. An under-bumped card carries a stale `updated:`
     * until its next real edit corrects it. An over-bumped one reorders the board with
     * nothing in the output saying why, and no later edit can undo that.
     */
    const record = (kind: 'mechanical' | 'semantic', msg: string) => {
      changes.push(msg)
      if (kind === 'semantic') semantic = true
    }
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
    // TARGET-ONLY (Phase 6): a frontmatter-less card carries no reference field at all, so
    // it can never legitimately be a neighbour — but if `opts.selector` alone selects it,
    // keep this repair local, same as every other non-reference-consistency repair below.
    if (!hasFm) {
      if (isTarget) {
        const title = c.h1.replace(/^TRDD-[0-9a-fA-F-]+\s+—\s+/, '').trim()
        const created = gitFirstCommitDate(c.filePath) ?? stamp
        const id = normalizeTrddRef(path.basename(c.filePath).replace(/^TRDD-(?:\d{8}_\d{6}[+-]\d{4}-)?/, '').slice(0, 8))
        const fm = [
          '---',
          `trdd-id: ${id}`,
          `title: ${title.replace(/:/g, ' —')}`,
          // A card with NO frontmatter can prove nothing about its own approval, so the
          // helper lands it at `backburner` (3P-TRDD-11). It used to be hard-coded `todo`,
          // which since 3.0.0 would assert both "approved" and "designed" about a file whose
          // fields we are inventing in this very block.
          `column: ${defaultColumnForMissing(c.fm)}`,
          `created: ${created}`,
          `updated: ${stamp}`,
          'current-owner: main',
          'assignee: main',
          'priority: 3',
          'task-type: feature',
          // DERIVED, not hardcoded. This block synthesizes frontmatter for a card that
          // has none, so a literal `project` here stamps that claim onto a card sitting
          // in a local or user corpus — the same defect the mint path carried until the
          // previous commit, and the one place a repair could reintroduce it.
          //
          // Classifying from the card's own FILE path is deliberate and safe: the
          // classifier scans path SEGMENTS, so a card at <corpus>/<zone>/<file> yields
          // the same verdict as its corpus root would. That also means this is really a
          // scope-of-any-path test; the name says designDir because that is its main
          // caller, not because it requires one.
          `scope: ${scopeOfDesignDir(c.filePath)}`,
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
        // SEMANTIC: the card asserted nothing structured before and now asserts a whole field
        // set, a `column:` among them. (The generated block stamps `updated:` itself above,
        // so the bump below is a no-op replace on the line this branch just wrote.)
        record('semantic', `added a full frontmatter (was: none) — column=${defaultColumnForMissing(c.fm)} per the uncertainty law`)
      }
    } else {
      // TARGET-ONLY (Phase 6): every repair from here through the body-state-claim drop is
      // local to THIS card alone — it reads and writes nothing on any other card, so on a
      // neighbour it would be intervention the plan does not ask for.
      if (isTarget) {
        // ---- frontmatter DATETIME notation → the mandated local offset (TRDD-S13L6R9R) ----
        //
        // MECHANICAL, and the distinction is the entire point: this CONVERTS the instant the
        // card already holds (`isoLocal` takes the parsed Date) rather than stamping `now`.
        // The same instant, re-spelled — which is the canonical mechanical repair described
        // in `record`'s own contract, and why the bump below stays off. Stamping `now` here
        // would be TRDD-R6R9XHZI a second time: a format pass rewriting the board's sort key
        // into an artefact of when someone last ran the fixer.
        //
        // Conversion truncates to the second (the mandated format has no sub-second slot).
        // Accepted and stated rather than discovered — measured 2026-08-22, re-derive with
        // the two greps in TRDD-S13L6R9R: of 1383 frontmatter datetime lines, exactly 25
        // carry milliseconds, and they are precisely the off-format ones this repairs. So
        // no conforming value loses precision, because none of them ever had any.
        for (const [field, value] of Object.entries(c.fm)) {
          const dt = offFormatDatetime(value)
          if (!dt || !dateFieldRepairable(field, c.column)) continue
          const line = new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$`, 'm')
          if (!line.test(text)) continue
          const converted = isoLocal(dt).iso
          text = text.replace(line, `${field}: ${converted}`)
          record('mechanical', `${field}: re-spelled from a UTC-\`Z\` instant to the mandated local offset (${converted}) — same instant`)
        }

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
          record(
            // The two sub-cases are NOT the same kind of repair, which is why the verdict is
            // computed rather than fixed. AGREES: the card said one state twice and now says it
            // once — the assertion set is unchanged. DISAGREES: the card was making TWO competing
            // pipeline claims and one is now gone; `column:` was always the authoritative one, but
            // deleting a claim is still a change to what the card says, and a reader should see
            // the card as recently touched.
            agrees ? 'mechanical' : 'semantic',
            agrees
              ? `dropped \`status: ${statusRaw}\` (a column value, redundant — \`column: ${c.column}\` already says it)`
              : `dropped \`status: ${statusRaw}\`; KEPT \`column: ${c.column}\` (both held a pipeline state and disagreed — the v2 state machine wins)`,
          )
        } else if (statusIsPipelineState) {
          // (b) the pipeline state is only in `status:` → migrate it to its own field. Safe
          // ONLY because the value is a recognised state; no default, no guess.
          const mapped = mappedFromV1 ?? statusKey
          text = text.replace(/^status:.*$/m, `column: ${mapped}`)
          // SEMANTIC, though the VALUE is unchanged: no consumer reads `status:` for a pipeline
          // position, so before this repair the card was column-less to every reader and to the
          // board. It joins the board here, which is a pipeline claim it was not making.
          record('semantic', `status: ${statusRaw} → column: ${mapped} (a column value in the wrong field)`)
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
          // 3P-TRDD-11 / PRRD G11.1 — ONE definition of the fallback, shared with the lint
          // message above so `--fix` can never repair a shape the report did not describe.
          const fallbackColumn = defaultColumnForMissing(c.fm)
          const next = hasColumnKey
            ? text.replace(/^column:.*$/m, `column: ${fallbackColumn}`)
            : text.replace(/^(trdd-id:.*)$/m, `$1\ncolumn: ${fallbackColumn}`)
          // Report only a repair that ACTUALLY LANDED. The push used to be unconditional,
          // so a card whose frontmatter carries no `trdd-id:` line (the anchor) had its
          // replace no-op while `--fix` still claimed the repair, still bumped `updated:`,
          // and still wrote — so the card stayed column-less, the claim repeated every run,
          // and its board sort key floated to the top forever. `--fix` never converged.
          if (next !== text) {
            text = next
            // SEMANTIC, and the clearest case: this INVENTS a pipeline state nobody chose. The
            // card now claims a column on the doctor's authority, and that must be visible.
            record('semantic', `column: ${fallbackColumn} (was missing — the uncertainty law)`)
          }
        }
        // uppercase the id
        if (c.fm['trdd-id'] && !/^[A-Z0-9]{8}$/.test(String(c.fm['trdd-id']))) {
          const short = normalizeTrddRef(String(c.fm['trdd-id']).slice(0, 8))
          text = text.replace(/^trdd-id:.*$/m, `trdd-id: ${short}`)
          // MECHANICAL: ids are matched case-insensitively everywhere (`normalizeTrddRef`, the
          // `-iname` lookups), so this re-spells an identity without changing it.
          record('mechanical', `trdd-id → ${short} (8-char UPPERCASE base36)`)
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
              // MECHANICAL: the title was already IN the document, as the H1. This lifts it into
              // frontmatter — the same denormalization repair as the `derived:` back-link below.
              record('mechanical', 'title lifted from the H1')
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
        //
        //
        //
        //
      //
      //
      //
      //
      // ...AND NOT ON A FROZEN CARD (added TRDD-S13L6R9R, found by a blast-radius dry-run).
        // IND `trdd-design-tasks` step 12 freezes a terminal card's BODY, and grants exactly
        // one exception for a body line: it "MAY be removed" when it FALSELY, MACHINE-VERIFIABLY
        // CONTRADICTS the terminal `column:`. This branch admits only the AGREEING case — so its
        // freeze behaviour was precisely INVERTED: it deleted the lines the freeze protects and
        // left alone the ones the freeze permits removing. Measured on this corpus: 3 archived
        // cards would have had a body line dropped by a `--fix` run whose stated purpose was a
        // date re-spelling. A frozen card's body is not ours to tidy; the lint still reports it.
        const frozen = TERMINAL_DONE.includes(c.column)
        if (!frozen && c.bodyStateClaim && bodyClaimAgreesWithColumn(c.bodyStateClaim, c.column)) {
          const stripped = removeBodyStateClaimLine(text)
          if (stripped !== null) {
            text = stripped
            // MECHANICAL by construction: the guard above admits ONLY the agreeing case, so what
            // is removed is a duplicate of a fact `column:` already carries. The disagreeing case
            // is left byte-for-byte alone and never reaches here.
            record(
              'mechanical',
              `dropped the body's \`Status: ${c.bodyStateClaim.slice(0, 40)}\` line (a second copy of \`column: ${c.column}\`, free to go stale)`,
            )
          }
        }
      }

      // The missing half of a derivation back-link. Only when EXACTLY ONE parent claims
      // this child AND the child already names that same parent — then `derived: true`
      // and `derived-kind:` follow mechanically from the parent's own npt:/eht:. Two
      // claimants means a genuine lineage bug; writing the flag would hide it.
      const claims = claimedBy.get(c.id) ?? []
      const parentField = normalizeTrddRef(String(c.fm['parent-trdd'] ?? '').replace(/^TRDD-/i, ''))
      // REFERENCE-CONSISTENCY (Phase 6): allowed on a neighbour too, because the fact this
      // repairs — the child's `derived:` flag — is partly owned by the PARENT card, not
      // only by this one. `DERIVED-FLAG-MISSING` is in `REFERENCE_CONSISTENCY_RULES`.
      if (
        (isTarget || REFERENCE_CONSISTENCY_RULES.has('DERIVED-FLAG-MISSING')) &&
        c.fm['derived'] !== true &&
        claims.length === 1 &&
        parentField === claims[0].parent
      ) {
        const kind = claims[0].kind
        text = /^derived:/m.test(text)
          ? text.replace(/^derived:.*$/m, 'derived: true')
          : text.replace(/^(parent-trdd:.*)$/m, `$1\nderived: true\nderived-kind: ${kind}`)
        if (!/^derived-kind:/m.test(text)) {
          text = text.replace(/^(derived: true)$/m, `$1\nderived-kind: ${kind}`)
        }
        // MECHANICAL — the headline case. The parent's own `npt:`/`eht:` already asserted the
        // derivation; this restores the child's half of a denormalized pointer and changes no
        // fact the card makes. A corpus-wide back-link repair used to reorder the whole board.
        record('mechanical', `derived: true + derived-kind: ${kind} (TRDD-${claims[0].parent} lists it in its \`${kind}:\` — the back-link was missing)`)
      }
    }

    if (changes.length > 0) {
      // Bump `updated:` ONLY when the repair set changed what the card ASSERTS.
      //
      // This comment used to read "Any repair bumps `updated:` — the board sorts on it",
      // citing as its justification the very clause that now forbids it. The rule was
      // corrected on 2026-07-31 to "a MECHANICAL repair (a format/syntax pass that changes no
      // fact) must NOT bump it, or the repair silently reorders the whole board" — the same
      // sentence flipped from the reason TO bump into the reason not to. Nothing flagged the
      // inversion, because a tool cites a rule's WORDS, not its VERSION (TRDD-R6R9XHZI).
      //
      // The damage was never a wrong timestamp: the board sorts on `updated:`, so a
      // corpus-wide `yarn trdd:fix` reordered the view every human and agent reads into an
      // artefact of when someone last ran a formatter, with nothing saying so. Keeping every
      // `updated:` byte-identical across a mechanical run is also the only cheap proof,
      // afterwards, that the run WAS mechanical.
      if (semantic) {
        text = /^updated:/m.test(text)
          ? text.replace(/^updated:.*$/m, `updated: ${stamp}`)
          : text.replace(/^(created:.*)$/m, `$1\nupdated: ${stamp}`)
      }
      if (!opts.dryRun) fs.writeFileSync(c.filePath, text, 'utf8')
      results.push({ filePath: c.filePath, id: c.id, changes, bumped: semantic })
    }
  }
  return results
}
