// Fleet-wide GitHub-config audit — the sixth absorbed janitor chore (TRDD-14HI8ZPR).
//
// WHY THIS EXISTS. While an ai-maestro server owns the host, the janitor daemon does not spawn at
// all (`global_state.py::ensure_daemon_running` → `if _server_owns_host(): return False`, no
// per-chore granularity). The suppression is BINARY and the absorption is PARTIAL, so whatever the
// server does not do, nobody does. `github-config-audit` is the ONE of the six formerly-unowned
// chores that we can absorb, because it is the only one whose population is DATA rather than live
// host processes. Cost of it being dark: fleet-wide branch-protection drift goes unnoticed.
//
// ── THE POPULATION MUST COME FROM THE CATALOG, NEVER FROM `ecosystem-constants.ts` ──────────────
//
// This is the load-bearing decision in this file and it was very nearly got wrong. The obvious
// move is to reuse `PREDEFINED_ROLE_PLUGIN_NAMES` + the repo constants we already hold — and
// MEASURED against what the janitor actually audits, those two sets disagree in BOTH directions:
//
//     overlap                                    10   the 8 role-plugins + assistant-role + plugin
//     the janitor audits, we cannot name          4   janitor, visual-communicator, web-scenario-
//                                                     tester, webdesign  (in the catalog; we hold
//                                                     no constant for any of them)
//     we hold, it never audits                    5   the app upstream, agent-identity,
//                                                     AgentlensPro, the marketplace, claude-plugin
//
// So an audit driven off our constants covers 10 of 14 — and STAMPING that would commit the exact
// violation recorded as lesson ATOM-6U79-6OHD in `.claude/project/memory/janitor-chore-
// absorbability.md`: a stamp asserts "this chore is on cadence", the janitor reads it as
// permission to stop covering the rest, and those 4 repos end up audited by NOBODY. Reading the
// same catalog the janitor reads makes the two populations identical BY CONSTRUCTION rather than
// by a coincidence that drifts the next time a plugin is published.
//
// ── EVERYTHING HERE IS READ-ONLY ────────────────────────────────────────────────────────────────
//
// Every probe is a `gh api` GET. This module NEVER mutates a repo — the janitor's on-demand
// `/janitor-github-config-fix` skill does that, deliberately behind a human. Measured cost of one
// beat: ~5-8 GETs per admin repo × 14 repos ≈ 70-110 GETs / 4 h, ~2% of one hour's authenticated
// budget.
//
// ── THE SILENCE RULES ARE THE POINT ─────────────────────────────────────────────────────────────
//
// Every probe is TRI-STATE: a definite answer, or `null` meaning "could not determine". The
// classifier is silent on `null` — it never claims a gap it could not prove. An audit that
// invents findings when the network is flaky is worse than no audit, because it trains the reader
// to ignore it. This mirrors `github_config_audit.classify_repo` exactly; the port is faithful so
// that the same repo yields the same findings whichever side ran the sweep.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { MARKETPLACE_REPO, statePath } from './ecosystem-constants'
import { stampChoreRun } from './janitor-chore-stamp'

const execFileAsync = promisify(execFile)

/** One `gh api` call ceiling. A single repo probe that hangs must not stall the whole sweep. */
const GH_TIMEOUT_MS = 15_000

/** Findings land here. Deliberately the SAME BASENAME the janitor's own detector reads from its
 *  global-state dir, so the cross-repo ask (`ai-maestro-janitor#196`) is a one-line path change on
 *  their side rather than a format negotiation. We do NOT write into their directory: the standing
 *  USER directive in `lib/write-boundary.ts` is that the only writes are `~/.aimaestro` and
 *  `~/agents`, and the established direction of travel is that the server publishes and the
 *  janitor consumes (as with `server-liveness.json`). */
export const FINDINGS_FILENAME = 'github-config-findings.json'

/** The fixed finding vocabulary. Ported verbatim from `github_config_audit.FINDING_CODES` — these
 *  strings are a cross-process contract, not labels we may reword. */
export const FINDING_CODES = [
  'UNPROTECTED',
  'LINEAR_HISTORY',
  'NO_PR_REVIEW',
  'NO_REQUIRED_CHECKS',
  'NO_CI',
  'NO_TAG_PROTECT',
] as const

export type FindingCode = (typeof FINDING_CODES)[number]

/** Ported verbatim so the wording lives in one place across both implementations. */
export const FINDING_BLURB: Record<FindingCode, string> = {
  UNPROTECTED:
    'no branch ruleset and no classic protection — anyone with write access can force-push, ' +
    'rewrite history, or delete the default branch',
  LINEAR_HISTORY:
    'a ruleset requires linear history — this BLOCKS merge commits and jams the many-agent ' +
    'merge workflow (Claude cannot merge)',
  NO_PR_REVIEW: 'no ruleset requires a pull request — changes can be merged with no review',
  NO_REQUIRED_CHECKS: 'CI exists but no ruleset requires status checks — a red build can merge',
  NO_CI: 'no .github/workflows — the repo runs no CI at all',
  NO_TAG_PROTECT:
    'release tags are unprotected — a leaked token could move/delete a published vX.Y.Z tag ' +
    'and re-point installers',
}

export interface Finding {
  slug: string
  code: FindingCode
  detail: string
}

/**
 * Everything the classifier needs about ONE repo, all gathered read-only.
 *
 * `null` on an optional field means the probe could NOT determine the answer, which is DISTINCT
 * from an empty list or `false` (definite negatives the classifier may act on).
 */
export interface RepoFacts {
  slug: string
  admin: boolean | null
  defaultBranch?: string | null
  /** Per-ruleset detail objects (with their `rules` array); null = the LIST probe failed. An entry
   *  whose own DETAIL fetch failed is kept as its list summary tagged `_detail_unresolved` (see
   *  `fullRulesets`): it still carries `target`/`enforcement`, so it counts as protection, but its
   *  rule set is unknown rather than empty. */
  rulesets?: Array<Record<string, unknown>> | null
  /** true = 200, false = definitive 404, null = indeterminate. */
  classicProtected?: boolean | null
  hasWorkflows?: boolean | null
}

export interface FleetAudit {
  generated_at: number
  repos_scanned: number
  findings: Finding[]
}

// ── population ──────────────────────────────────────────────────────────────────────────────────

/** The marketplace catalog the janitor derives its audit population from. The directory name is
 *  the repo half of `MARKETPLACE_REPO` so the name has one source; the FILE is read rather than
 *  our constants for the reason in the header. */
export function marketplaceCatalogPath(): string {
  const marketplaceName = MARKETPLACE_REPO.split('/')[1]
  return path.join(
    os.homedir(),
    '.claude',
    'plugins',
    'marketplaces',
    marketplaceName,
    '.claude-plugin',
    'marketplace.json',
  )
}

const REPO_SLUG_RE = /github\.com[:/]+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/

/**
 * Every fleet repo `owner/repo`, parsed from the catalog's per-plugin `source.url`. Deduped and
 * sorted. PURE over the file — no network.
 *
 * Returns `[]` when the catalog is unreadable or malformed, and the caller MUST treat that as
 * "no fleet to audit" and write NO stamp. "I could not read the population" and "I audited the
 * population and it was clean" are different facts, and only one of them may be reported healthy.
 */
export function fleetRepoSlugs(catalogPath: string = marketplaceCatalogPath()): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const plugins = (parsed as { plugins?: unknown }).plugins
  if (!Array.isArray(plugins)) return []

  const slugs = new Set<string>()
  for (const entry of plugins) {
    if (!entry || typeof entry !== 'object') continue
    const source = (entry as { source?: unknown }).source
    if (!source || typeof source !== 'object') continue
    const url = (source as { url?: unknown }).url
    if (typeof url !== 'string') continue
    const m = REPO_SLUG_RE.exec(url.trim())
    if (m) slugs.add(m[1])
  }
  return [...slugs].sort()
}

// ── the pure classifier (ported from `classify_repo`) ────────────────────────────────────────────

function activeRulesets(
  rulesets: Array<Record<string, unknown>>,
  target: 'branch' | 'tag',
): Array<Record<string, unknown>> {
  return rulesets.filter(
    rs => rs && typeof rs === 'object' && rs.target === target && rs.enforcement === 'active',
  )
}

function ruleTypes(ruleset: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  const rules = ruleset.rules
  if (!Array.isArray(rules)) return out
  for (const rule of rules) {
    if (rule && typeof rule === 'object' && typeof (rule as { type?: unknown }).type === 'string') {
      out.add((rule as { type: string }).type)
    }
  }
  return out
}

/** Tag for a ruleset whose per-ruleset DETAIL fetch failed, so its `rules` array — hence its
 *  rule-type set — is UNKNOWN rather than empty. Same key as the janitor's
 *  `github_config_audit._detail_unresolved` (their janitor#244), deliberately: the two sides must
 *  stay interchangeable, and a facts blob written by one has to mean the same thing to the other. */
const DETAIL_UNRESOLVED = '_detail_unresolved'

function detailUnresolved(rs: Record<string, unknown>): boolean {
  return rs[DETAIL_UNRESOLVED] === true
}

function finding(slug: string, code: FindingCode): Finding {
  return { slug, code, detail: FINDING_BLURB[code] }
}

/**
 * PURE, total classifier: RepoFacts → findings. Ported from `github_config_audit.classify_repo`,
 * including its silence rules, which are the whole reason the audit is trustworthy:
 *
 *   admin is not true  → []  the viewer cannot fix it, so nagging is pure noise
 *   rulesets is null   → []  we could not read them, so we cannot prove any gap
 *   a branch ruleset is unresolved → no NO_PR_REVIEW / NO_REQUIRED_CHECKS: those two are inferred
 *                                    from the UNION of rule types, and a union missing an unread
 *                                    member is a LOWER BOUND that proves no absence
 */
export function classifyRepo(facts: RepoFacts): Finding[] {
  if (facts.admin !== true) return []
  const rulesets = facts.rulesets
  if (rulesets == null) return []

  const branchRs = activeRulesets(rulesets, 'branch')
  const tagRs = activeRulesets(rulesets, 'tag')

  // Protection is ADDITIVE: two rulesets each contributing one rule protect jointly, so the
  // classifier reasons over the UNION of rule types rather than any single ruleset.
  const allBranchRuleTypes = new Set<string>()
  for (const rs of branchRs) for (const t of ruleTypes(rs)) allBranchRuleTypes.add(t)

  // A ruleset whose detail we could not read contributes NO rule types, so the union above is a
  // LOWER BOUND rather than the whole truth. Any finding that means "this type is ABSENT" must
  // therefore stand down — see the gate below.
  const anyUnresolved = branchRs.some(detailUnresolved)

  const hasBranchProtection = branchRs.length > 0 || facts.classicProtected === true
  const findings: Finding[] = []

  // UNPROTECTED — only when BOTH negatives are DEFINITIVE. `classicProtected === null` is
  // indeterminate, so we do not claim unprotected on it.
  if (branchRs.length === 0 && facts.classicProtected === false) {
    findings.push(finding(facts.slug, 'UNPROTECTED'))
  }

  // LINEAR_HISTORY — independent of everything else: it jams merges even on an otherwise-fine repo.
  // Deliberately NOT gated on `anyUnresolved`: this fires on a type being PRESENT, so an unread
  // ruleset can only make us miss one, never invent one. Missing a finding is the safe direction;
  // claiming a gap we could not prove is the one this file exists to prevent.
  if (allBranchRuleTypes.has('required_linear_history')) {
    findings.push(finding(facts.slug, 'LINEAR_HISTORY'))
  }

  // The review/checks gaps are inferred from the RULE TYPES of active branch RULESETS, so they may
  // only be claimed when protection is actually expressed AS rulesets. A repo protected only by
  // CLASSIC protection has an empty rule-type set through no fault of its own — its
  // required_pull_request_reviews / required_status_checks live in the classic protection body,
  // which this audit does not read. Gating on `hasBranchProtection` (which classic satisfies)
  // would false-flag a compliant repo, and the fix skill would then mutate it.
  if (branchRs.length > 0 && !anyUnresolved) {
    if (!allBranchRuleTypes.has('pull_request')) {
      findings.push(finding(facts.slug, 'NO_PR_REVIEW'))
    }
    // Only when CI actually exists — no CI at all is the NO_CI finding, not a missing gate.
    if (facts.hasWorkflows === true && !allBranchRuleTypes.has('required_status_checks')) {
      findings.push(finding(facts.slug, 'NO_REQUIRED_CHECKS'))
    }
  }

  // Tag protection is its own ruleset target, and a non-null `rulesets` means we definitively read
  // the tag rulesets too — so this one stays gated on "protected at all", classic included.
  if (hasBranchProtection && tagRs.length === 0) {
    findings.push(finding(facts.slug, 'NO_TAG_PROTECT'))
  }

  // Only when we DEFINITELY saw no workflows (false, not null).
  if (facts.hasWorkflows === false) {
    findings.push(finding(facts.slug, 'NO_CI'))
  }

  return findings
}

// ── probes (read-only; every one never throws and returns null on indeterminate) ─────────────────

/** Run `gh <args>` read-only. Returns `[rc, parsedJsonOrNull]`; `rc === null` means gh is missing
 *  or the call raised — never propagates. Argv array, no shell, ever. */
async function ghJson(args: string[]): Promise<[number | null, unknown]> {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      timeout: GH_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    try {
      return [0, JSON.parse(stdout)]
    } catch {
      return [0, null]
    }
  } catch (err) {
    // A non-zero exit still carries a JSON error body on stdout for `gh api` (e.g. the 404 shape
    // the classifier needs to tell "definitely absent" from "could not tell").
    const stdout = (err as { stdout?: string })?.stdout
    const code = (err as { code?: unknown })?.code
    if (typeof stdout === 'string' && stdout.trim()) {
      try {
        return [typeof code === 'number' ? code : 1, JSON.parse(stdout)]
      } catch {
        /* fall through */
      }
    }
    return [null, null]
  }
}

function statusOf(body: unknown): string | null {
  if (body && typeof body === 'object' && 'status' in body) {
    return String((body as { status: unknown }).status)
  }
  return null
}

async function viewerIsAdmin(slug: string): Promise<boolean | null> {
  const [rc, body] = await ghJson(['api', `repos/${slug}`])
  if (rc === null || rc !== 0) return null
  const perms = (body as { permissions?: { admin?: unknown } })?.permissions
  if (!perms || typeof perms.admin !== 'boolean') return null
  return perms.admin
}

async function detectDefaultBranch(slug: string): Promise<string | null> {
  const [rc, body] = await ghJson(['api', `repos/${slug}`])
  if (rc !== 0) return null
  const b = (body as { default_branch?: unknown })?.default_branch
  return typeof b === 'string' && b ? b : null
}

/**
 * Every ruleset for `slug` WITH its `rules` array resolved. The LIST endpoint returns summaries
 * without the rules, so each ruleset's detail is fetched. Returns null if the LIST probe itself
 * failed (indeterminate → the classifier stays silent).
 *
 * A per-ruleset DETAIL failure KEEPS the ruleset, as its list summary tagged `DETAIL_UNRESOLVED`.
 * This used to `continue` — dropping it — which is the one inference this file forbids everywhere
 * else: a failed read became "this ruleset does not exist". Two false findings followed from it,
 * and the second is the sharp one:
 *
 *   · its rule types vanish from the union → NO_PR_REVIEW / NO_REQUIRED_CHECKS on a repo that may
 *     well have both (the union gate above now stands down instead);
 *   · if it was the repo's ONLY active branch ruleset, `branchRs.length` fell to 0 → UNPROTECTED
 *     on a PROTECTED repo, from one transient 5xx or secondary rate-limit.
 *
 * The summary carries `target` and `enforcement`, so the tagged shell still counts as protection
 * and still classifies as branch-vs-tag — only its rule set is unknown. Mirrors the janitor's
 * `_full_rulesets` (their janitor#244), which hit this first.
 */
export async function fullRulesets(
  slug: string,
  // Injected for the same reason `auditFleet` takes `gather`: the TAGGING below is the load-bearing
  // half of the janitor#244 fix, and a classifier test driving RepoFacts fixtures cannot see it
  // regress. A fake api drives it without mocking node:child_process internals.
  api: (apiPath: string) => Promise<[number | null, unknown]> = p => ghJson(['api', p]),
): Promise<Array<Record<string, unknown>> | null> {
  const [rc, body] = await api(`repos/${slug}/rulesets`)
  if (rc !== 0 || !Array.isArray(body)) return null
  const detailed: Array<Record<string, unknown>> = []
  for (const rs of body) {
    // A non-object entry is not a ruleset at all — it carries no target/enforcement, so there is
    // nothing to keep and `activeRulesets` would drop it anyway.
    if (!rs || typeof rs !== 'object') continue
    const summary = rs as Record<string, unknown>
    const id = summary.id
    if (typeof id === 'number' || typeof id === 'string') {
      const [drc, detail] = await api(`repos/${slug}/rulesets/${id}`)
      if (drc === 0 && detail && typeof detail === 'object') {
        detailed.push(detail as Record<string, unknown>)
        continue
      }
    }
    // Detail unfetchable (bad/missing id, non-zero rc, or a non-object body): unknown, not absent.
    detailed.push({ ...summary, [DETAIL_UNRESOLVED]: true })
  }
  return detailed
}

async function classicProtected(slug: string, branch: string): Promise<boolean | null> {
  const [rc, body] = await ghJson(['api', `repos/${slug}/branches/${branch}/protection`])
  if (rc === null) return null
  if (rc === 0) return true
  if (statusOf(body) === '404') return false
  return null
}

async function hasWorkflows(slug: string): Promise<boolean | null> {
  const [rc, body] = await ghJson(['api', `repos/${slug}/contents/.github/workflows`])
  if (rc === null) return null
  if (statusOf(body) === '404') return false
  if (Array.isArray(body)) {
    return body.some(
      f =>
        f &&
        typeof f === 'object' &&
        /\.ya?ml$/.test(String((f as { name?: unknown }).name ?? '')),
    )
  }
  return null
}

/** READ-ONLY probe of ONE repo. Never throws, never mutates. */
export async function gatherRepoFacts(slug: string): Promise<RepoFacts> {
  const admin = await viewerIsAdmin(slug)
  // If we are not admin (or cannot tell) we could never act on a finding, so skip the remaining
  // probes entirely — it saves API calls on repos we could not fix anyway, and the classifier is
  // silent for this case regardless.
  if (!admin) return { slug, admin: admin === null ? null : false }

  const branch = await detectDefaultBranch(slug)
  return {
    slug,
    admin: true,
    defaultBranch: branch,
    rulesets: await fullRulesets(slug),
    classicProtected: branch ? await classicProtected(slug, branch) : null,
    hasWorkflows: await hasWorkflows(slug),
  }
}

// ── the sweep ───────────────────────────────────────────────────────────────────────────────────

export interface AuditDeps {
  slugs?: string[]
  gather?: (slug: string) => Promise<RepoFacts>
  now?: () => number
}

/** Probe every fleet repo and classify. Returns null when the population could not be resolved —
 *  which the caller must NOT stamp. */
export async function auditFleet(deps: AuditDeps = {}): Promise<FleetAudit | null> {
  const slugs = deps.slugs ?? fleetRepoSlugs()
  if (slugs.length === 0) return null

  const gather = deps.gather ?? gatherRepoFacts
  const now = deps.now ?? Date.now
  const findings: Finding[] = []
  for (const slug of slugs) {
    findings.push(...classifyRepo(await gather(slug)))
  }
  return {
    generated_at: Math.floor(now() / 1000),
    repos_scanned: slugs.length,
    findings,
  }
}

export function findingsPath(): string {
  return statePath(FINDINGS_FILENAME)
}

/** Atomic write (tmp + rename), the `writeServerLiveness` idiom — a reader never sees a partial
 *  findings file. */
function writeAtomic(dest: string, payload: unknown): void {
  const tmp = `${dest}.tmp.${process.pid}`
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8')
  fs.renameSync(tmp, dest)
}

export interface AuditRunResult {
  ran: boolean
  reposScanned: number
  findings: number
  reason?: string
}

/**
 * One beat: audit, publish the findings, stamp the chore.
 *
 * The stamp is written ONLY when the population resolved. An unreadable catalog means we do not
 * know what to audit, and stamping there would tell the janitor this chore is covered while
 * nothing was examined — the precise false-healthy failure the stamp exists to prevent.
 */
export async function runGithubConfigAudit(deps: AuditDeps = {}): Promise<AuditRunResult> {
  const audit = await auditFleet(deps)
  if (!audit) {
    return { ran: false, reposScanned: 0, findings: 0, reason: 'population unresolved' }
  }
  try {
    writeAtomic(findingsPath(), audit)
  } catch (err) {
    // A failed publish is still a completed audit — stamp it, because the chore WAS attempted on
    // cadence, and report the failure rather than swallowing it.
    return {
      ran: true,
      reposScanned: audit.repos_scanned,
      findings: audit.findings.length,
      reason: `findings write failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    stampChoreRun('github-config-audit')
  }
  return { ran: true, reposScanned: audit.repos_scanned, findings: audit.findings.length }
}

// ── the scheduler ───────────────────────────────────────────────────────────────────────────────

/** 4 hours — the USER's cadence (2026-08-05), tighter than the janitor's own 6 h. Env-overridable;
 *  `0` disables. */
const DEFAULT_INTERVAL_MS =
  Number(process.env.AIM_GITHUB_CONFIG_AUDIT_INTERVAL_MS) || 4 * 60 * 60 * 1000

let inFlight = false

async function beat(log: (msg: string) => void): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const r = await runGithubConfigAudit()
    if (!r.ran) log(`[github-config-audit] skipped — ${r.reason}`)
    else if (r.reason) log(`[github-config-audit] ${r.reason}`)
    else if (r.findings > 0) {
      log(`[github-config-audit] ${r.reposScanned} repos scanned, ${r.findings} finding(s)`)
    }
  } catch (err) {
    log(`[github-config-audit] beat threw (non-fatal): ${err instanceof Error ? err.message : err}`)
  } finally {
    inFlight = false
  }
}

/**
 * Start the recurring audit. Returns a stop function, or null when disabled.
 * Same shape as `startJanitorResponsePublisher` / `startFleetLivenessWatchdog`: fires once
 * immediately, `unref`'d so it never holds the process open, and never throws.
 */
export function startGithubConfigAuditScheduler(opts: {
  intervalMs?: number
  log?: (msg: string) => void
} = {}): (() => void) | null {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!intervalMs || intervalMs <= 0) return null
  const log = opts.log ?? ((msg: string) => console.warn(msg))

  void beat(log)
  const timer = setInterval(() => void beat(log), intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
