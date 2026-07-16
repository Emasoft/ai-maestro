/**
 * Route-level sudo / agent-authorization guard (R32 dual-path).
 *
 * Route handlers classified "strict" in security-registry.json call
 * `requireSudoToken(request, method, pathTemplate)` as the FIRST statement
 * in their handler, before any side effects. Under R32 the guard is
 * AGENT-AWARE and splits the caller into exactly two paths:
 *
 *   USER / SYSTEM-OWNER path (valid aim_session cookie, no Bearer → no agentId):
 *     1. Read the X-Sudo-Token header.
 *     2. verifyAndConsumeSudoToken checks validity, TTL, subject AND operation
 *        binding, then consumes (one-shot) ONLY on a full match — a wrong-subject
 *        or wrong-op attempt is rejected WITHOUT burning a still-valid token.
 *     3. On failure, return a 403 NextResponse to short-circuit.
 *     4. On success, return null and the handler proceeds.
 *   This is the ONLY path that consumes a sudo token — a sudo password is
 *   requested only of the USER, only via the UI (R32.2).
 *
 *   AGENT path (Bearer aim_tk_* / mst_* / amp_* → agentId set):
 *     Agents NEVER face a sudo gate (R32.1/R32.3). Authorization is the
 *     R28 chain — (1) identity (AID, already verified by the time the guard
 *     reaches the agent branch), (2) TITLE privilege via the shared
 *     lib/authorization.ts::authorize(), and (3) a portfolio/mandate token
 *     (a future R28 check, pre-wired here as a no-op). The agent branch goes
 *     to `requireAidTitle` and NEVER touches verifyAndConsumeSudoToken.
 *
 * SECURITY (SUDO-04): the guard AUTHENTICATES FIRST. A forged/expired session
 * cookie sets `auth.error` and the guard returns 401 BEFORE the sudo token is
 * ever read or consumed — a forged cookie can no longer burn a token.
 *
 * This is a deliberate in-handler check (rather than middleware) because
 * sudo-auth.ts and agent-auth.ts use argon2 / crypto / in-memory Maps that are
 * Node-only and incompatible with the Edge runtime that runs middleware.ts.
 *
 * The reference implementation of this exact dual-path is
 * `app/api/teams/[id]/orchestrator/route.ts::authorizeOrchestratorChange`.
 *
 * USAGE (unchanged for callers):
 *   export async function DELETE(request: NextRequest) {
 *     const guard = requireSudoToken(request, 'DELETE', '/api/agents/[id]')
 *     if (guard) return guard
 *     // ... proceed with the destructive operation ...
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAndConsumeSudoToken } from './sudo-auth'
import { requiresSudo } from './security-registry'
import {
  authenticateFromRequest,
  buildAuthContext,
  type AgentAuthResult,
} from './agent-auth'
import { authorize, type AuthAction } from './authorization'
import { getAgentBySession } from './agent-registry'
import { OPERATIONS_REQUIRING_TOKEN } from './portfolio-check'
import { findActiveTokens } from './portfolio-store'
import { verifyPortfolioToken } from './portfolio-sign'
import type { PortfolioToken } from '@/types/portfolio'

export function requireSudoToken(
  request: NextRequest,
  method: string,
  pathTemplate: string
): NextResponse | null {
  // Skip entirely if the route is NOT classified strict — keep behavior
  // idempotent so callers can add the guard unconditionally without
  // harming normal routes.
  if (!requiresSudo(method, pathTemplate)) {
    return null
  }

  // ── AUTH FIRST (SUDO-04) ──────────────────────────────────────────────
  // Authenticate before reading/consuming any sudo token. A forged or expired
  // credential sets `auth.error`; we return its 401/403 here, so a fake cookie
  // can never burn a one-shot sudo token. An unrecognized token type (e.g. an
  // IBCT `eyJ` token on this sync path) fails CLOSED — it falls through to the
  // AMP auth path which rejects it, setting `error` → 401 here.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }
  const ctx = buildAuthContext(auth)

  // ── AGENT path (R32): NEVER sudo — authorize by AID + title (+portfolio) ──
  if (!ctx.isSystemOwner) {
    return requireAidTitle(auth, method, pathTemplate, request)
  }

  // ── USER / SYSTEM-OWNER path: sudo token, subject- and op-bound ──────────
  const token = request.headers.get('x-sudo-token')

  // SUDO-02: which subjects may this session consume a token for?
  //
  // R37.4 SUBJECT-BINDING (the model-ON fix): the mint route binds the token's
  // subject to `ctx.userId ?? 'system-owner'` (sudo-password/route.ts), so the
  // accepted subject DIFFERS by model:
  //   - model OFF (default): ctx.userId is undefined at mint time, so the ONLY
  //     valid subject is the legacy sentinel 'system-owner'. This branch is
  //     byte-equivalent to pre-model behavior — the acceptance set is exactly
  //     {'system-owner'} and `getActiveMaestroUserId()` is never consulted.
  //   - model ON: we only reach here past the `!ctx.isSystemOwner` gate above,
  //     i.e. the caller IS the ACTIVE MAESTRO (maestro or acting delegate). The
  //     mint stored that user's id as the subject, so we additionally accept
  //     the currently-active-maestro id. A delegate suspends the maestro, so
  //     getActiveMaestroUserId() resolves to the same id the mint stored.
  // Without this, EVERY sudo-gated strict route 403s with the model on (the
  // mint emits a UUID subject the unchanged R32 consume check rejected) — a
  // complete fail-secure feature break (assign-delegate, set-password, …).
  //
  // The legacy sentinel is ALWAYS accepted (covers model-OFF and any unbound
  // token minted before the flip). This only WIDENS the subject set under the
  // model, never weakens it: a non-active-maestro UUID subject is still rejected.
  //
  // Computed BEFORE the consume (below) because verifyAndConsumeSudoToken checks
  // the subject BEFORE it burns the token — a wrong-subject attempt must not
  // consume a still-valid token (SUDO-02 token-burn hardening).
  const validSubjects = new Set<string>(['system-owner'])
  try {
    const { isUserAuthorityModelEnabled } = require('./governance') as typeof import('./governance')
    if (isUserAuthorityModelEnabled()) {
      const { getActiveMaestroUserId } = require('./user-registry') as typeof import('./user-registry')
      const activeMaestroId = getActiveMaestroUserId()
      if (activeMaestroId) validSubjects.add(activeMaestroId)
    }
  } catch {
    // Fail-safe: if the model flag or user registry can't be read, fall back to
    // the legacy {'system-owner'}-only set — never widen the subject set on an
    // error, so a misconfiguration can only DENY (fail-secure), never grant.
  }

  // AUTHENTICATE-BEFORE-CONSUME (SUDO-01/02): the store verifies validity, the
  // subject predicate, AND the operation binding, and burns the token ONLY on a
  // full match. A wrong-subject / wrong-op / expired / replayed request returns
  // a reason WITHOUT consuming a still-valid token.
  const result = verifyAndConsumeSudoToken(token, {
    operation: { method, path: pathTemplate },
    acceptSubject: (subject) => validSubjects.has(subject),
  })

  if (result.ok) return null

  if (result.reason === 'subject_mismatch') {
    return NextResponse.json(
      {
        error: 'sudo_subject_mismatch',
        message: 'That confirmation does not belong to this session. Please re-enter your governance password.',
        devHint: `Sudo token subject is not an accepted subject (expected "system-owner"${validSubjects.size > 1 ? ' or the active-maestro user id' : ''}).`,
        route: `${method} ${pathTemplate}`,
      },
      { status: 403 }
    )
  }

  if (result.reason === 'operation_mismatch') {
    return NextResponse.json(
      {
        error: 'sudo_operation_mismatch',
        message: 'That confirmation was for a different action. Please re-enter your governance password.',
        devHint: `Sudo token was minted for a different operation than ${method} ${pathTemplate}.`,
        route: `${method} ${pathTemplate}`,
      },
      { status: 403 }
    )
  }

  // missing | expired | unknown → sudo_required
  const reason = result.reason
  // Clean, user-facing copy that the sudo modal displays verbatim.
  // Keep these short and free of API plumbing — the modal body already
  // explains the TTL and "cannot be replayed" invariant separately.
  const message =
    reason === 'missing'
      ? 'Confirm with your governance password to continue.'
      : reason === 'expired'
        ? 'Your confirmation expired. Please re-enter your governance password.'
        : 'That confirmation could not be used. Please enter your governance password again.'

  // Developer-facing hint that explains the exact API contract. Separate
  // from `message` so the modal never leaks API plumbing into end-user UX
  // (Issue A from SCEN-016 smoke test, 2026-04-12).
  const devHint =
    reason === 'missing'
      ? 'POST /api/auth/sudo-password with the governance password to obtain a token, then retry with X-Sudo-Token header.'
      : reason === 'expired'
        ? 'Sudo token expired. Request a fresh one.'
        : 'Sudo token invalid or already used (tokens are one-shot).'

  return NextResponse.json(
    {
      error: 'sudo_required',
      reason,
      message,
      devHint,
      route: `${method} ${pathTemplate}`,
    },
    { status: 403 }
  )
}

/**
 * Strict routes that NO agent may reach — they mirror the routes' own
 * `enforceSystemOwner` gate (or are operator-only auto-update routes). For
 * any agent caller, `requireAidTitle` returns 403 immediately, matching the
 * route's own system-owner-only behavior.
 *
 * GUARDRAIL (Risk R-2): a test asserts this set is a SUPERSET of every strict
 * route whose handler imports `enforceSystemOwner`. Drift here would let an
 * agent slip past a system-owner-only route via the guard's title branch.
 *
 * GUARDRAIL (TRDD-6A2I6ZO0): a second test asserts every strict route in
 * security-registry.json is DECLARED — in this set, in STRICT_AGENT_RULES, or
 * in AGENT_POLICY_PENDING. A strict route in none of them still fails closed,
 * but silently and with a misleading "not available to agents" message.
 */
export const SYSTEM_OWNER_ONLY_STRICT = new Set<string>([
  'POST /api/governance/password',
  // TRDD-P7XKV3N9: setting/removing the recovery email establishes (or tears down) the
  // MAESTRO's remote password-reset relay. Both handlers gate on enforceSystemOwner —
  // owner-only, never an agent — so classifying them strict (security-registry.json)
  // requires declaring them here too (Risk R-2 superset guardrail).
  'POST /api/governance/email/configure',
  'DELETE /api/governance/email',
  'PATCH /api/settings/security',
  'DELETE /api/settings/marketplaces',
  'PATCH /api/settings/auto-update',
  'POST /api/settings/auto-update/run',
  'POST /api/agents/import',

  // ── TRDD-K2WJH7RF Part 2 (USER-approved 2026-07-09) ──────────────────────
  // These five moved here from AGENT_POLICY_PENDING. NO BEHAVIOUR CHANGES: they
  // refused every agent before and refuse every agent now. What changes is that
  // the refusal is a STATED decision instead of a shrug.
  //
  // Each is a root-of-trust operation, and each fails in the same direction:
  //   • maestro-delegate — delegates the HUMAN OWNER's authority. An agent that
  //     could delegate the maestro could mint its own owner.
  //   • foreign-approvals — admits an agent from ANOTHER HOST. A MANAGER here is
  //     "plausible and useful"; it is also exactly how a compromised MANAGER on
  //     one host would admit itself to another. Cross-host trust is the sharpest
  //     edge in the system, so it stays owner-only until someone argues the
  //     MANAGER case properly — the burden belongs on widening, not on closing.
  //   • aid-recover — recovers an agent IDENTITY, the root of the whole trust
  //     chain. Whoever can recover an AID can become any agent.
  'POST /api/governance/maestro-delegate',
  'DELETE /api/governance/maestro-delegate',
  'POST /api/agents/foreign-approvals/[id]/approve',
  'POST /api/agents/foreign-approvals/[id]/reject',
  'POST /api/system/aid-recover',
])

/**
 * Strict routes whose AGENT policy has never been decided (TRDD-6A2I6ZO0).
 *
 * These behave exactly as they did before this set existed — `requireAidTitle`
 * refuses every agent caller. Nothing here is a new restriction. What changes
 * is that the refusal is now a STATED position rather than the fall-through
 * default, and that adding a strict route without deciding its agent policy
 * fails a test instead of shipping a dead endpoint.
 *
 * Why they are here rather than in SYSTEM_OWNER_ONLY_STRICT: "system-owner
 * only" is itself a policy claim, and for these it may well be the wrong one.
 * Declaring an undecided route owner-only would quietly ratify a bug — which is
 * exactly what nearly happened to the panel/queue/prompt trio, built FOR the
 * janitor (an agent) and reachable by no agent at all.
 *
 * That trio, and `PATCH /api/agents/[id]`, were decided by the USER on
 * 2026-07-09 (TRDD-D3RP7KQZ) and now live in STRICT_AGENT_RULES: an agent may
 * drive its own surface, never reconfigure itself. What remains below are the
 * questions that decision did not answer.
 *
 * This set is a DEBT LEDGER: the coverage test pins it to an exact inventory,
 * so it can shrink as policies are decided but cannot silently grow.
 */
export const AGENT_POLICY_PENDING = new Set<string>([
  // EMPTY — the ledger is discharged (TRDD-K2WJH7RF, USER-approved 2026-07-09).
  //
  // The ten routes that sat here are now DECIDED, not merely refused:
  //   • the five governance routes  → SYSTEM_OWNER_ONLY_STRICT (owner-only)
  //   • the five /api/trdd/* verbs  → STRICT_AGENT_RULES, action 'manage-trdd'
  //
  // Emptying this set is the whole point of the epic. It was a DEBT LEDGER, and
  // the debt it tracked was real: `aimaestro-trdd.sh` was half a tool — the
  // janitor could read the board and could not touch it, and every agent that
  // tried got a 403 that correctly said nobody had decided
  // (ai-maestro-janitor#76, which told the janitor to SKIP the TRDD write verbs).
  //
  // Keep the set. It is not dead code: the coverage guardrail requires every NEW
  // strict route to be declared in exactly one of the three sets, so a route
  // added tomorrow without a decided agent policy lands HERE and fails a test,
  // instead of shipping as a dead endpoint.
])

/**
 * Map a strict (method, pathTemplate) to the RBAC AuthAction the agent branch
 * checks via lib/authorization.ts::authorize(). The fine per-target check (self
 * bans, COS own-team scoping) stays in each route's own pipeline (DeleteAgent
 * Gate-0 / ChangeTitle / updateAgentById → authorize()), which re-runs AFTER
 * the guard — so the guard is deliberately COARSE and never consumes the body.
 *
 * `targetFromPathId: true` ⇒ resolve targetAgentId from the path `[id]` (UUID).
 * `session: true` ⇒ the `[id]` is a tmux SESSION name (= agent name), not an
 * agent UUID; resolve it to an agentId via a synchronous registry read (D1).
 * Neither flag ⇒ body-target / global routes → coarse title check only.
 */
interface StrictAgentRule {
  action: AuthAction
  /** Resolve targetAgentId from the path `[id]` segment (UUID). */
  targetFromPathId?: boolean
  /** The path `[id]` is a tmux session name → resolve to agentId (D1). */
  session?: boolean
  /**
   * TRDD-K2WJH7RF. The guard CANNOT decide this route, and must not pretend to.
   *
   * `manage-trdd` is keyed on the target TRDD's approval TIER — a fact that
   * lives on disk, in that TRDD's frontmatter. The guard is deliberately coarse:
   * it never consumes the body and never reads the task corpus. So for these
   * routes it admits any AUTHENTICATED AGENT past the title gate and the ROUTE
   * performs the real `authorize(auth, 'manage-trdd', undefined, trddContext)`
   * with the tier, assignee and author resolved. That is exactly the split
   * K2WJH7RF chose: the route resolves the tier and passes it in, so authorize()
   * stays synchronous and honest about what it knows.
   *
   * This is NOT a hole. `authorize()` FAILS CLOSED on a `manage-trdd` call with
   * no TrddAuthContext, and `tests/unit/manage-trdd-authorization.test.ts` pins
   * that every deferring route actually calls it. A route that forgot would deny
   * everything, loudly — never allow everything, silently. The coarse gate here
   * cannot be tighter than "is an agent", because a MEMBER may legitimately
   * `edit` a TRDD it is assigned: no TITLE can be excluded up front.
   */
  deferToRoute?: boolean
}

const STRICT_AGENT_RULES: Record<string, StrictAgentRule> = {
  // ── TRDD-K2WJH7RF Part 1: the 3-pillars TRDD lifecycle write verbs ────────
  // `[id]` here is a TRDD id, NOT an agent id — so `targetFromPathId` must stay
  // OFF. Resolving it as an agent UUID would silently look up a nonexistent
  // agent and hand authorize() a garbage target.
  //
  // These are what ai-maestro-janitor#76 told the janitor to SKIP, because they
  // 403'd every agent. They are the reason `aimaestro-trdd.sh` was half a tool:
  // read the board, never touch it.
  'PATCH /api/trdd/[id]': { action: 'manage-trdd', deferToRoute: true },
  'POST /api/trdd/[id]/approve': { action: 'manage-trdd', deferToRoute: true },
  'POST /api/trdd/[id]/refuse': { action: 'manage-trdd', deferToRoute: true },
  'POST /api/trdd/[id]/promote': { action: 'manage-trdd', deferToRoute: true },
  'POST /api/trdd/[id]/archive': { action: 'manage-trdd', deferToRoute: true },

  'DELETE /api/agents/[id]': { action: 'delete-agent', targetFromPathId: true },
  'POST /api/agents/[id]/transfer': { action: 'change-title', targetFromPathId: true },
  // TRDD-I75EMTK0: the "New Session" R17 self-heal route. Same shape as the
  // agent-UUID-targeted routes above — [id] is the agent, not a session name.
  //
  // TRDD-BF3JN4TL (R42): re-mapped from 'restart-session' to 'modify-agent'.
  // Its handler runs ensureCorePluginInstalled — a PLUGIN (RE)INSTALL, i.e. a
  // filesystem + registry write. It is CONFIGURATION, not a session drive: it
  // never injects a keystroke into anyone's pane, and 'restart-session' was only
  // ever a convenient label ("the caller will want to relaunch afterwards"), not
  // a claim about what the route does. R42 revokes cross-agent DRIVE while R42.6
  // explicitly preserves cross-agent CONFIGURATION, so leaving it on the drive
  // action would have taken the R17 self-heal away from MANAGER/COS as collateral
  // damage — a governance-legitimate operation lost to a mislabel.
  // ZERO-REGRESSION: authorize() treats the two actions identically for every
  // caller class here — self denied (neither is a SELF_DRIVE action), MANAGER
  // (other) allowed, COS own-team allowed, everyone else denied.
  'POST /api/agents/[id]/ensure-core': { action: 'modify-agent', targetFromPathId: true },
  'DELETE /api/agents/[id]/session': { action: 'delete-session', targetFromPathId: true },
  // TRDD-1LX5LMBD: team creation is a privileged operation (auto-creates an
  // agent + AID keypair + installs a role-plugin for the auto-COS) but was
  // never sudo-gated. Web UI (system-owner) previously created teams with NO
  // password prompt at all; a non-MANAGER agent could create one by supplying
  // a matching `governancePassword` in the body — a weaker, untested,
  // inconsistent mechanism compared to every other team-mutating route
  // (DELETE/PUT below), which are all uniformly `manage-team`-gated. This
  // entry retires that legacy body-password path (removed in
  // app/api/teams/route.ts) in favor of the same dual-path gate: USER gets a
  // sudo-token modal, AGENT gets the authorize('manage-team') MANAGER-only
  // check — identical rules to DELETE/PUT/orchestrator below.
  'POST /api/teams': { action: 'manage-team' },
  // code-review F2: create-with-project is the same createNewTeam operation
  // as POST /api/teams (with an optional GitHub Project link bolted on) --
  // it was gated ONLY by an in-body password (verifyPassword), missing this
  // entry entirely, which let ANY non-MANAGER agent create a team merely by
  // knowing the governance password string. Gated identically to POST /api/teams.
  'POST /api/teams/create-with-project': { action: 'manage-team' },
  'DELETE /api/teams/[id]': { action: 'manage-team' },
  'PUT /api/teams/[id]': { action: 'manage-team' },
  'PUT /api/teams/[id]/orchestrator': { action: 'manage-team' },
  'DELETE /api/teams/[id]/orchestrator': { action: 'manage-team' },
  // TRDD-D3RP7KQZ (USER decision, 2026-07-09) — the agent-control surface.
  // These three DRIVE an agent's surface rather than change its configuration,
  // so they share `send-command`.
  //
  // TRDD-BF3JN4TL / R42 (USER mandate, 2026-07-14) narrowed what that means:
  // `send-command` is now SELF-ONLY. Self is ALLOWED (SELF_DRIVE_ACTIONS in
  // lib/authorization.ts) — an agent enqueuing `/compact` on itself or painting
  // its own panel is the primary use case, and it is what the janitor does.
  // ANOTHER agent is DENIED for every title, MANAGER and own-team COS included:
  // an injected command is the victim's own action, so it bypasses the victim's
  // judgment entirely. Messaging is the only channel of agent-to-agent influence.
  //
  // CAUTION: unlike most entries here, `panel` has NO route-level authorize() of
  // its own, and `queue` has none at enqueue time (only later, on drain). For
  // those two this guard is the ONLY authorization check. Do not weaken it on
  // the assumption that a downstream pipeline re-runs a finer one.
  'POST /api/agents/[id]/panel': { action: 'send-command', targetFromPathId: true },
  'POST /api/agents/[id]/queue': { action: 'send-command', targetFromPathId: true },
  'POST /api/agents/[id]/prompt/answer': { action: 'send-command', targetFromPathId: true },
  // #54 (TRDD-ED9A4VVY): the IMMEDIATE twin of `queue` — PATCH …/session types
  // arbitrary text straight into a live pane. Only its arbitrary-`command` branch
  // calls the guard (the curated `commandKey` allowlist branch stays open), so a
  // USER needs a fresh sudo token and an AGENT the same send-command matrix as
  // queue — which since R42 is SELF-ONLY (no title reaches another agent's pane).
  // Without this entry the route would be strict-in-registry yet undeclared → the
  // coverage guardrail fails closed.
  'PATCH /api/agents/[id]/session': { action: 'send-command', targetFromPathId: true },
  // Configuration, not surface. PATCH is a router: it dispatches ChangeTitle /
  // ChangePlugin / ChangeClient / ChangeTeam / ChangeName / …. No agent may
  // reconfigure ITSELF; MANAGER (any) and COS (own team) may reconfigure others.
  // Coarse by design — the guard never reads the body, and each Change* pipeline
  // re-runs its own finer authorize() (ChangeTitle's rule is stricter still: it
  // bans self-title-change even for a MANAGER).
  'PATCH /api/agents/[id]': { action: 'modify-agent', targetFromPathId: true },
  'POST /api/agents/cemetery': { action: 'delete-agent' },
  'DELETE /api/agents/cemetery': { action: 'delete-agent' },
  'DELETE /api/agents/role-plugins': { action: 'manage-skills' },
  'POST /api/agents/role-plugins/install': { action: 'manage-skills' },
  'DELETE /api/agents/role-plugins/install': { action: 'manage-skills' },
  // Session routes — D1: `[id]` is a tmux SESSION name, resolved to an agentId
  // inside the guard. The resolution still matters under R42, but its purpose has
  // INVERTED: it used to prove "the target is in the COS's team" (a grant); it now
  // proves "the target IS the caller" (the only remaining grant). An unresolvable
  // session name yields `undefined`, and authorize() denies — fail closed.
  //
  // R42: stop/restart do `tmux send-keys … C-c` + `-l '/exit'` + `Enter`. That is
  // keystroke injection, whatever the route is named — so no agent may aim it at
  // another agent. Killing a session at the PROCESS level is a different act and
  // stays with MANAGER/COS: that is 'delete-session' / hibernate, below.
  'POST /api/sessions/[id]/stop': { action: 'restart-session', session: true },
  'POST /api/sessions/[id]/restart': { action: 'restart-session', session: true },
  'POST /api/sessions/[id]/kill': { action: 'delete-session', session: true },
  'DELETE /api/sessions/[id]': { action: 'delete-session', session: true },
}

/**
 * Extract the path `[id]` segment value from a pathname given its template.
 * Compares segment-by-segment; the value under a `[...]` template segment is
 * the id. Returns undefined if no `[...]` segment exists or the shapes don't
 * line up. Used ONLY for the guard's coarse target resolution — never the body;
 * the route's own param parsing remains the source of truth.
 */
function extractPathId(pathname: string, pathTemplate: string): string | undefined {
  const reqSegs = pathname.split('/').filter(Boolean)
  const tplSegs = pathTemplate.split('/').filter(Boolean)
  if (reqSegs.length !== tplSegs.length) return undefined
  for (let i = 0; i < tplSegs.length; i++) {
    if (tplSegs[i].startsWith('[') && tplSegs[i].endsWith(']')) {
      return reqSegs[i]
    }
  }
  return undefined
}

/**
 * Map a strict (method, pathTemplate) to the portfolio OPERATION name that
 * `OPERATIONS_REQUIRING_TOKEN` is keyed by (the SAME operation names the
 * service-layer pipelines pass to `matchPortfolioToken`, e.g. 'CreateAgent',
 * 'CreateTeam'). A route absent from this map is never portfolio-gated at the
 * guard layer. Kept NARROW (security-first): only the agent-callable strict
 * routes whose pipeline ALSO runs the service-layer portfolio check belong
 * here, so the guard and the pipeline agree on which ops are gated.
 *
 * NOTE (TRDD-1LX5LMBD): `POST /api/teams` is now BOTH strict AND in
 * STRICT_AGENT_RULES ('manage-team'), so its 'CreateTeam' entry below is no
 * longer dormant for the AGENT-caller title check — but `matchPortfolioToken`
 * itself still no-ops until `OPERATIONS_REQUIRING_TOKEN['CreateTeam']` is
 * populated (it ships `{}` — see portfolio-check.ts D2), so the PORTFOLIO
 * token requirement specifically remains OFF regardless. `POST /api/agents`
 * ('CreateAgent') is still absent from STRICT_AGENT_RULES, so that entry
 * stays fully dormant until it too is classified strict.
 */
const STRICT_ROUTE_TO_PORTFOLIO_OP: Record<string, string> = {
  'POST /api/teams': 'CreateTeam',
  // code-review F2: create-with-project delegates to the same createNewTeam
  // service call as POST /api/teams -- mirror its portfolio-op mapping.
  'POST /api/teams/create-with-project': 'CreateTeam',
  'POST /api/agents': 'CreateAgent',
}

/**
 * Coarse scope match for the GUARD-layer pre-check — exact match or a held
 * `resource:*` / `*:*` wildcard covering the required scope's resource. This is
 * the same normalization rule `lib/portfolio-check.ts::scopeSatisfies` and the
 * IBCT scope check apply; duplicated as a one-liner here (rather than exporting
 * the private helper) to keep the guard's import surface minimal.
 */
function guardScopeSatisfies(heldScope: string, requiredScope: string): boolean {
  if (heldScope === requiredScope) return true
  if (heldScope === '*:*') return true
  const [reqResource] = requiredScope.split(':')
  return heldScope === `${reqResource}:*`
}

/**
 * R28 check #3 — portfolio / mandate token (server-stored secure enclave).
 *
 * This is the GUARD-LAYER, SYNCHRONOUS, DELIBERATELY COARSE pre-check (mirrors
 * how `requireAidTitle` is coarse and lets the route's own pipeline re-run the
 * fine check). The AUTHORITATIVE portfolio check — including the R34
 * ledger-anchor requirement and the one-shot consume-after-success — is the
 * ASYNC `matchPortfolioToken` wired into the service-layer pipelines
 * (`CreateAgent` G01e / `createNewTeam`). The guard cannot be async (21 strict
 * routes call `requireSudoToken` synchronously), so the ledger anchor stays in
 * the service layer; the guard only does a coarse "is there a satisfying,
 * host-signed active token?" pre-screen.
 *
 * D2 (zero-regression): while `OPERATIONS_REQUIRING_TOKEN` is EMPTY (the
 * shipped state), `OPERATIONS_REQUIRING_TOKEN[op]` is undefined for every op,
 * so this returns `{ allowed: true }` immediately — a pure no-op. Enabling an
 * op there (the only behavior-changing flip) activates the gate, and the
 * service-layer check enforces R34 + consume authoritatively.
 *
 * Bypass authority (mirrors matchPortfolioToken): a caller with no agentId
 * (system-owner) and a MANAGER caller are the mint authority for their own R29
 * authority and are not gated here — only DELEGATED callers (COS and below) are.
 */
function requirePortfolioToken(
  auth: AgentAuthResult,
  method: string,
  pathTemplate: string
): { allowed: boolean; reason?: string } {
  const operation = STRICT_ROUTE_TO_PORTFOLIO_OP[`${method} ${pathTemplate}`]
  // Route not portfolio-mapped at the guard layer → nothing to check.
  if (!operation) return { allowed: true }

  const requiredScope = OPERATIONS_REQUIRING_TOKEN[operation]
  // Operation not gated. This is the case for EVERY op while the map is empty
  // (D2 no-op). Enabling an op flips this branch.
  if (!requiredScope) return { allowed: true }

  // Bypass authority — system-owner (no agentId) and MANAGER are the mint
  // authority; gate only the delegated callers.
  if (!auth.agentId) return { allowed: true }
  if ((auth.governanceTitle || '').toLowerCase() === 'manager') {
    return { allowed: true }
  }

  // Coarse pre-screen: a host-signed, currently-active token whose scope
  // satisfies the required scope. (Target pinning + the R34 ledger anchor are
  // enforced authoritatively by the async service-layer matchPortfolioToken.)
  const tokens = findActiveTokens(auth.agentId)
  const hasToken = tokens.some(
    (t: PortfolioToken) =>
      guardScopeSatisfies(t.scope, requiredScope) && verifyPortfolioToken(t),
  )
  if (hasToken) return { allowed: true }

  return {
    allowed: false,
    reason: `Operation "${operation}" requires an approval/mandate token with scope "${requiredScope}" granted by a MANAGER (or your team's CHIEF-OF-STAFF).`,
  }
}

/**
 * AGENT-path authorization (R32 / R28). Identity (#1) is already verified by
 * the time we get here (the guard returned 401 on `auth.error`). This does the
 * TITLE-privilege check (#2) via the shared authorize(), plus the pre-wired
 * portfolio hook (#3). Returns null (allow → the route's own pipeline runs the
 * fine per-target check) or a 403 NextResponse.
 *
 * `request` is needed to read the live pathname for path-id / session
 * resolution; it is optional so the function can be unit-tested with a synthetic
 * pathname-free auth, in which case target-scoped routes fall back to the coarse
 * (targetAgentId=undefined) decision authorize() already makes for them.
 */
export function requireAidTitle(
  auth: AgentAuthResult,
  method: string,
  pathTemplate: string,
  request?: NextRequest
): NextResponse | null {
  const routeKey = `${method} ${pathTemplate}`

  // (a) System-owner-only strict routes → fully deny ANY agent, mirroring the
  // route's own enforceSystemOwner gate.
  if (SYSTEM_OWNER_ONLY_STRICT.has(routeKey)) {
    return NextResponse.json(
      {
        error: 'aid_title_forbidden',
        message: 'This operation is restricted to the system owner.',
        route: routeKey,
      },
      { status: 403 }
    )
  }

  // (a2) TRDD-6A2I6ZO0 — strict routes whose agent policy is undecided. Same
  // refusal as the fail-closed default below, but the caller is told the truth:
  // this is an unanswered governance question, not a deliberate exclusion. An
  // agent (the janitor) hitting "not available to agents" on the very routes
  // built for it is how the epic's whole write surface stayed inert unnoticed.
  if (AGENT_POLICY_PENDING.has(routeKey)) {
    return NextResponse.json(
      {
        error: 'agent_policy_undefined',
        message: 'Agent access to this operation has not been defined yet.',
        devHint:
          'The route is strict but absent from STRICT_AGENT_RULES. Decide its agent policy ' +
          '(AuthAction + target semantics) and move it out of AGENT_POLICY_PENDING in lib/sudo-guard.ts.',
        route: routeKey,
      },
      { status: 403 }
    )
  }

  // (b) Title-gated strict routes → map to an AuthAction and authorize().
  const rule = STRICT_AGENT_RULES[routeKey]
  if (!rule) {
    // A strict route with no agent rule and not in the system-owner-only set is
    // unmapped. Fail CLOSED — an unmapped strict route must not silently
    // authorize an agent. (Covers DELETE /api/v1/agents/me being dropped from
    // the registry, plus any future strict route added without a rule here.)
    return NextResponse.json(
      {
        error: 'aid_title_forbidden',
        message: 'This operation is not available to agents.',
        route: routeKey,
      },
      { status: 403 }
    )
  }

  // (b2) TRDD-K2WJH7RF — routes the guard REFUSES to decide.
  //
  // `manage-trdd` turns on the target TRDD's approval tier, which lives on disk.
  // The guard does not read the task corpus (or the body), so deciding here would
  // mean guessing a tier — and a guessed tier is a guessed approval. Admit the
  // authenticated agent past the TITLE gate and let the route run the real
  // authorize() with the tier, assignee and author it resolved.
  //
  // Safe because authorize() FAILS CLOSED without a TrddAuthContext: a route that
  // forgets the check denies everything loudly, rather than allowing everything
  // silently. A test pins that each of these routes really does call it.
  if (rule.deferToRoute) {
    return null
  }

  // Resolve targetAgentId for the (still coarse) authorize() decision.
  let targetAgentId: string | undefined
  const pathname = request?.nextUrl?.pathname
  if (pathname) {
    if (rule.session) {
      // D1: `[id]` is a tmux SESSION name. Resolve session → agentId via a
      // synchronous registry read (NOT the body) so an own-team COS restarting
      // a session is authorized exactly as the route's pipeline would.
      const sessionName = extractPathId(pathname, pathTemplate)
      if (sessionName) {
        const agent = getAgentBySession(sessionName)
        targetAgentId = agent?.id
      }
    } else if (rule.targetFromPathId) {
      targetAgentId = extractPathId(pathname, pathTemplate)
    }
  }

  // R28 #2 — TITLE privilege via the single source of truth. The guard passes
  // the AgentAuthResult it already has (agentId + governanceTitle + teamId), so
  // authorize() needs no second lookup. The route's own pipeline re-runs the
  // fine per-target check afterward.
  const decision = authorize(auth, rule.action, targetAgentId)
  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: 'aid_title_forbidden',
        message: decision.reason ?? 'Your title does not permit this operation.',
        route: routeKey,
      },
      { status: 403 }
    )
  }

  // R28 #3 — portfolio / mandate token (pre-wired no-op).
  const portfolio = requirePortfolioToken(auth, method, pathTemplate)
  if (!portfolio.allowed) {
    return NextResponse.json(
      {
        error: 'portfolio_token_required',
        message: portfolio.reason ?? 'This operation requires an approval token.',
        route: routeKey,
      },
      { status: 403 }
    )
  }

  return null
}
