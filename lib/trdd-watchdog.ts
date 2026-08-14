/**
 * TRDD §D4 approval-ladder watchdog — the checks `lib/trdd-doctor.ts` does NOT own.
 *
 * WHY A SECOND MODULE (TRDD-AYBAMFN2, ai-maestro#146). The doctor already enforces
 * §D4 steps 3-6 against DECLARED fields (MANDATE-FORGED, the platelet invariants via
 * trdd-graph, the completion gates, the approval-record invariant). What nothing
 * enforced was the half that makes self-classification auditable at all:
 *
 *   1. THE D3 OBJECTIVE FLOOR (§D4 steps 1-2) — compute each card's minimum
 *      `min-approval-requirement` from mechanical signals in its content, and flag
 *      declared < floor. Without this, the declared floor is self-certified and the
 *      doctor's mandate check verifies forgeries against the forger's own number.
 *   2. MANDATE vs the COMPUTED floor (§D4 step 3) — the overlay says the mandate is
 *      verified "using the corrected floor from step 2, not the declared value". Two
 *      evidence tiers feed it: content signals (below), and — the 3P-ZON-11 / TRDD-8F8PJEXI
 *      half — the CHANGED PATHS of the commits citing the card (`implementation-commits:`),
 *      which is the only evidence the card's author does not control. A frontmatter-derived
 *      floor moves the self-declaration one field across; the diff does not lie.
 *   3. SUPERSEDE AUTHORITY (§D4 step 7) — only `T_new.created-by` may declare that
 *      T_new replaces T_old; plus the drift half (a non-empty `superseded-by:` on a
 *      card whose column is not `superseded`).
 *
 * These live here rather than in `lintCorpus` because the floor check is a HEURISTIC
 * CLASSIFIER, not a format lint: its text-signal tier is deliberately warn-only (the
 * MANAGER queue §D4 prescribes for ambiguous cases), and folding heuristic warns into
 * the doctor — whose findings gate commits and tests — is how a linter grows a wall of
 * warnings and gets routed around. The CLI (`scripts/trdd-watchdog.mjs`) runs BOTH
 * modules and prints the consolidated §D4 report the MANAGER drains on idle.
 *
 * SCAN SET: `design/tasks/` + `design/proposals/` ONLY — mirroring §D4's own scan set.
 * Archived/refused cards are frozen (IND base step 12); flagging them names no broken
 * consumer (measured once at 218 findings of pure wall).
 *
 * TIERING DISCIPLINE (§D3: "keep the floors narrow and objective"):
 *   - UNAMBIGUOUS signals read pure frontmatter (`release-via`, `impacts`) → ERROR.
 *   - AMBIGUOUS signals read prose (a `.github/` path, a governance-file mention) →
 *     WARN, flagged for the MANAGER queue, never auto-judged. A card DISCUSSING a
 *     surface and a card TOUCHING it are indistinguishable to a regex — safety
 *     documentation is indistinguishable from the attack it describes — so prose
 *     signals can only ever nominate suspects.
 *
 * KNOWN BLIND SPOTS, pinned as data (a detector's silence must not read as absence):
 *   - The `chief-of-staff` floor ("affects other members of the same team") has no
 *     mechanical signal in a mono-agent corpus — never computed here.
 *   - Supersede attribution needs the introducing commit to carry an `Agent:` trailer
 *     (the commit-authorship self-identification convention — this module CONSUMES the
 *     trailer, it does not enforce that rule, so no rule id is cited here: the coverage
 *     scanner classifies a rule cited in lib/ as ENFORCED, and a reader is not an
 *     enforcer). Commits without one are counted in `supersedeUnattributed`, not
 *     guessed at: we can only see the hand when it signed.
 */
import { execFileSync } from 'child_process'
import path from 'path'
import { listTrddFiles, parseTrddFile, type TrddZone } from './trdd-store'
import { normalizeTrddRef } from './trdd-graph'
import { AUTHORITY_RANK, TIER_TO_REQUIREMENT } from './trdd-vocabulary'

export interface WatchdogFinding {
  rule: string
  severity: 'error' | 'warn'
  id: string
  filePath: string
  message: string
}

export interface WatchdogReport {
  findings: WatchdogFinding[]
  scanned: number
  errors: number
  warnings: number
  /**
   * Superseded cards whose `superseded-by:` line could not be attributed to any agent
   * (no `Agent:` trailer on the introducing commit, or no git history for the file).
   * Counted, never flagged — an unverifiable authority is a blind spot, not a finding.
   */
  supersedeUnattributed: number
  /**
   * `implementation-commits:` shas whose diff could not be read (unknown sha, no git).
   * Same discipline: a floor we could not compute is counted, never guessed.
   */
  commitFloorUnresolved: number
}

/** Scalar-or-list frontmatter value → string list (the scalar-`npt:` lesson, applied here). */
function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

interface FloorSignal {
  rung: string
  /** true → prose-derived, warn tier; false → frontmatter-derived, error tier. */
  ambiguous: boolean
  label: string
}

export interface FloorVerdict {
  /** The highest rung any signal establishes; 'none' when nothing fires. */
  floor: string
  /** true when NO unambiguous signal reaches the floor rung — §D4's MANAGER-queue case. */
  ambiguous: boolean
  signals: string[]
}

/**
 * The D3 objective floor — computed from what the card mechanically declares/touches.
 *
 * Rung sources, mirroring `aimaestro-trdd-approval.md` §D3's table:
 *   manager — `release-via: publish|deploy` (frontmatter, unambiguous); a `.github/`
 *             path, a ratified-baseline surface, or a governance file in the prose
 *             (ambiguous).
 *   user    — breaking public-API change: `impacts:` includes `public-api` AND
 *             release-via publish|deploy (frontmatter, unambiguous); a golden-rule
 *             edit surface in the prose (ambiguous).
 * The chief-of-staff rung is deliberately absent — see the blind-spot note above.
 */
export function objectiveFloor(fm: Record<string, unknown>, text: string): FloorVerdict {
  const signals: FloorSignal[] = []
  const releaseVia = String(fm['release-via'] ?? '').trim().toLowerCase()
  const impacts = strList(fm['impacts']).map((s) => s.toLowerCase())

  if (releaseVia === 'publish' || releaseVia === 'deploy') {
    signals.push({
      rung: 'manager',
      ambiguous: false,
      label: `release-via: ${releaseVia} enters the release pipeline (§D3 → manager)`,
    })
    if (impacts.includes('public-api')) {
      signals.push({
        rung: 'user',
        ambiguous: false,
        label: `breaking public-API change: impacts includes public-api with release-via ${releaseVia} (§D3 → user)`,
      })
    }
  }

  // Prose signals — nominate suspects only (warn tier). Each regex is deliberately
  // NARROW: a false floor raised on a card that merely cites a rule file is the wall
  // that gets a watchdog routed around.
  if (/\.github\//.test(text)) {
    signals.push({ rung: 'manager', ambiguous: true, label: 'names a `.github/` path — workflow/ruleset surface (§D3 → manager)' })
  }
  if (/baseline-(?:history-protect|pr-and-checks|tag-protect)|bypass_actors?/.test(text)) {
    signals.push({ rung: 'manager', ambiguous: true, label: 'names a ratified-baseline ruleset surface (§D3 → manager)' })
  }
  if (/GOVERNANCE-RULES\.md|rules\/aimaestro\//.test(text)) {
    signals.push({ rung: 'manager', ambiguous: true, label: 'names a governance file (§D3 → manager)' })
  }
  if (/\bgolden\b[^\n]{0,60}\brules?\b|\brules?\b[^\n]{0,60}\bgolden\b|prrd-edit\.py[^\n]{0,40}\bgolden\b/i.test(text)) {
    signals.push({ rung: 'user', ambiguous: true, label: 'golden-PRRD-rule surface (§D3 → user)' })
  }

  if (signals.length === 0) return { floor: 'none', ambiguous: false, signals: [] }
  const rank = (r: string) => AUTHORITY_RANK[r] ?? 0
  const floor = signals.reduce((a, s) => (rank(s.rung) > rank(a) ? s.rung : a), 'none')
  const atFloor = signals.filter((s) => s.rung === floor)
  return {
    floor,
    ambiguous: atFloor.every((s) => s.ambiguous),
    signals: atFloor.map((s) => s.label),
  }
}

/**
 * The card's DECLARED floor: `min-approval-requirement`, falling back to the deprecated
 * `approval-tier` alias (decode-only — the doctor separately nags the migration), and
 * normalizing the retired `maestro` spelling to the ladder's canonical `user`.
 */
export function declaredFloor(fm: Record<string, unknown>): string {
  const named = String(fm['min-approval-requirement'] ?? '').trim().toLowerCase()
  if (named) return named === 'maestro' ? 'user' : named
  const decoded = TIER_TO_REQUIREMENT[String(fm['approval-tier'] ?? '').trim()]
  return decoded ?? 'none'
}

/**
 * The `Agent:` trailer of the commit that introduced this file's `superseded-by:` line,
 * or null when unattributable (no trailer, no history, no git). Injectable so tests can
 * drive the disagree/agree/blind branches without a fixture repository.
 */
export function supersedeSetterFromGit(filePath: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['log', '-S', 'superseded-by:', '--format=%(trailers:key=Agent,valueonly)', '--', path.basename(filePath)],
      { cwd: path.dirname(filePath), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    // Oldest-to-newest is not needed: -S lists every commit that changed the count of
    // matches; the trailer of ANY of them naming a different agent than T_new's author
    // is what the check reads, and the first non-empty line is the newest such hand.
    const trailer = out.split('\n').map((l) => l.trim()).find(Boolean)
    return trailer ?? null
  } catch {
    return null
  }
}

/**
 * The changed paths of one commit, or null when unreadable. Injectable seam — tests drive
 * the floor derivation without a fixture repository.
 */
export function changedPathsFromGit(sha: string, cwd: string): string[] | null {
  try {
    const out = execFileSync('git', ['show', '--name-only', '--format=', sha], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return null
  }
}

/**
 * The 3P-ZON-11 objective floor from CHANGED PATHS — repo-relative, author-uncontrolled.
 *
 * Path → rung, mirroring §D3's manager row (`.github/` workflows or rulesets · SILVER
 * PRRD / persona / governance file). The `user` rung is NOT derivable from a path alone
 * (a PRRD edit's golden-vs-silver split lives in the diff CONTENT) — a golden edit floors
 * at `manager` here, which under-reports by one rung rather than fabricating evidence.
 * Pinned as data in the tests so the blind spot cannot silently grow.
 */
export function pathFloor(paths: string[]): { floor: string; hits: string[] } {
  const hits = paths.filter(
    (p) =>
      p.startsWith('.github/') ||
      p.startsWith('rules/aimaestro/') ||
      p === 'docs/GOVERNANCE-RULES.md' ||
      p.startsWith('design/specs/') ||
      p.endsWith('design/requirements/PRRD.md'),
  )
  return hits.length ? { floor: 'manager', hits } : { floor: 'none', hits: [] }
}

const WATCHDOG_ZONES: readonly TrddZone[] = ['tasks', 'proposals']

/**
 * The §D4 sweep over `design/tasks/` + `design/proposals/`.
 *
 * Streaming: each card's body is read once, reduced to its floor verdict + a handful of
 * frontmatter fields, and released — nothing retains the corpus (the 4.45 GB lesson).
 */
export function watchdogSweep(
  designDir: string,
  opts: {
    supersedeSetter?: (filePath: string) => string | null
    changedPaths?: (sha: string) => string[] | null
  } = {},
): WatchdogReport {
  const supersedeSetter = opts.supersedeSetter ?? supersedeSetterFromGit
  const changedPaths = opts.changedPaths ?? ((sha: string) => changedPathsFromGit(sha, designDir))
  const findings: WatchdogFinding[] = []
  let scanned = 0
  let supersedeUnattributed = 0
  let commitFloorUnresolved = 0

  // Pass 1 needs `created-by` for every card ANY card's `superseded-by:` names — and the
  // replacement may live in a zone outside the scan set (a superseding card is often
  // itself archived later). Small map: two strings per card, all four zones.
  const createdBy = new Map<string, string>()
  for (const zone of ['tasks', 'proposals', 'archived', 'refused'] as const) {
    for (const file of listTrddFiles(designDir, zone)) {
      const t = parseTrddFile(file, zone)
      if (!t || t.parseError) continue
      const author = String(t.frontmatter['created-by'] ?? '').trim()
      if (author) createdBy.set(t.id, author)
    }
  }

  for (const zone of WATCHDOG_ZONES) {
    for (const file of listTrddFiles(designDir, zone)) {
      const t = parseTrddFile(file, zone)
      if (!t) continue
      scanned++
      if (t.parseError) continue // the doctor owns UNPARSEABLE; judging unparsed fields is guessing
      const fm = t.frontmatter
      const id = t.id

      // ---- §D4 steps 1-2: declared floor vs the D3 objective floor ----
      const declared = declaredFloor(fm)
      const computed = objectiveFloor(fm, `${t.title}\n${t.body}`)
      const rankDeclared = AUTHORITY_RANK[declared] ?? 0
      const rankComputed = AUTHORITY_RANK[computed.floor] ?? 0
      const under = rankDeclared < rankComputed
      if (under && !computed.ambiguous) {
        findings.push({
          rule: 'D3-FLOOR-UNDERCLASSIFIED',
          severity: 'error',
          id,
          filePath: file,
          message: `declares min-approval-requirement '${declared}' but its objective D3 floor is '${computed.floor}' (${computed.signals.join('; ')}) — under-classification dodges the approval queue; raise the floor and, if it sat authorized in design/tasks/, route it back through design/proposals/`,
        })
      } else if (under && computed.ambiguous) {
        // Noise gate: a card whose mandate CLAIMS an issuer at or above the suspected floor
        // dodged nothing — the approval the floor would demand is already asserted. Warn-tier
        // only: the claim itself is audited by the commit-diff check below, so suppressing the
        // consistency nag here re-opens no bypass.
        const by = String(fm['mandated-by'] ?? '').trim().toLowerCase()
        const rankBy = fm['mandate'] === true ? (AUTHORITY_RANK[by === 'self' ? 'none' : by] ?? 0) : 0
        if (rankBy < rankComputed) {
          findings.push({
            rule: 'D3-FLOOR-SUSPECT',
            severity: 'warn',
            id,
            filePath: file,
            message: `declares '${declared}' while its prose suggests a '${computed.floor}' floor (${computed.signals.join('; ')}) — ambiguous signal, flagged for the MANAGER queue per §D4, never auto-judged`,
          })
        }
      }

      // ---- §D4 step 3: mandate verified against the COMPUTED floor ----
      // The doctor's MANDATE-FORGED compares against the DECLARED floor; the overlay says
      // the watchdog uses "the corrected floor from step 2, not the declared value" —
      // otherwise an under-classified floor plus a self-issued mandate is a full bypass.
      if (fm['mandate'] === true && rankComputed > 0) {
        const by = String(fm['mandated-by'] ?? '').trim().toLowerCase()
        const rankBy = AUTHORITY_RANK[by === 'self' ? 'none' : by] ?? 0
        if (rankBy < rankComputed) {
          findings.push({
            rule: computed.ambiguous ? 'MANDATE-BELOW-SUSPECT-FLOOR' : 'MANDATE-BELOW-OBJECTIVE-FLOOR',
            severity: computed.ambiguous ? 'warn' : 'error',
            id,
            filePath: file,
            message: `\`mandate: true\` issued by '${by || '?'}' (rank ${rankBy}) while the COMPUTED D3 floor is '${computed.floor}' (rank ${rankComputed}; ${computed.signals.join('; ')}) — §D4 step 3 verifies mandates against the corrected floor, not the declared one${computed.ambiguous ? '. Ambiguous signal: MANAGER queue, not auto-revocation' : ''}`,
          })
        }
      }

      // ---- 3P-ZON-11: the mandate vs the floor of what the card actually TOUCHED ----
      // The changed paths of the citing commits are the one input the author does not
      // control. TRDD-8F8PJEXI's verification: a `mandated-by: self` card whose citing
      // commit touches `.github/` MUST produce MANDATE-FORGED — and the complementary
      // neuter (compare against the declared floor instead) must green it, proving the
      // objective floor is what catches it. Necessarily RETROSPECTIVE: no commits, no
      // evidence, no finding.
      if (fm['mandate'] === true) {
        const shas = strList(fm['implementation-commits'])
        const touched: string[] = []
        for (const sha of shas) {
          const paths = changedPaths(sha)
          if (paths === null) commitFloorUnresolved++
          else touched.push(...paths)
        }
        const objective = pathFloor(touched)
        const rankObjective = AUTHORITY_RANK[objective.floor] ?? 0
        const by = String(fm['mandated-by'] ?? '').trim().toLowerCase()
        const rankBy = AUTHORITY_RANK[by === 'self' ? 'none' : by] ?? 0
        if (rankObjective > 0 && rankBy < rankObjective) {
          findings.push({
            rule: 'MANDATE-FORGED',
            severity: 'error',
            id,
            filePath: file,
            message: `\`mandate: true\` issued by '${by || '?'}' (rank ${rankBy}) but its citing commits touched ${objective.hits.slice(0, 4).join(', ')}${objective.hits.length > 4 ? ` (+${objective.hits.length - 4} more)` : ''} — objective floor '${objective.floor}' (rank ${rankObjective}) from evidence the author does not control (3P-ZON-11). Revoke the mandate and route the card through its real approver`,
          })
        }
      }

      // ---- §D4 step 7: supersede — drift half + authority half ----
      const supers = strList(fm['superseded-by']).map((r) => normalizeTrddRef(r.replace(/^TRDD-/i, '')))
      if (supers.length > 0 && t.column !== 'superseded') {
        findings.push({
          rule: 'SUPERSEDED-BY-WITHOUT-COLUMN',
          severity: 'error',
          id,
          filePath: file,
          message: `carries superseded-by: [${supers.join(', ')}] while column is '${t.column}' — a card a replacement has overtaken must say \`column: superseded\`, or the board shows the same work as both live and replaced`,
        })
      }
      if (supers.length > 0) {
        const setter = supersedeSetter(file)
        if (setter === null) {
          supersedeUnattributed++
        } else {
          for (const ref of supers) {
            const author = createdBy.get(ref)
            if (author && author.toLowerCase() !== setter.toLowerCase()) {
              findings.push({
                rule: 'SUPERSEDE-AUTHORITY',
                severity: 'error',
                id,
                filePath: file,
                message: `superseded-by: ${ref} was set by '${setter}' (the introducing commit's Agent: trailer) but TRDD-${ref} was created by '${author}' — only the replacement's author may declare that it replaces something (§D4 step 7)`,
              })
            }
          }
        }
      }
    }
  }

  return {
    findings,
    scanned,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
    supersedeUnattributed,
    commitFloorUnresolved,
  }
}
