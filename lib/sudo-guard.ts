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
 *     2. Validate + consume it (one-shot, TTL, subject-bound, op-bound).
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
 *     to `requireAidTitle` and NEVER touches validateAndConsumeSudoToken.
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
import { validateAndConsumeSudoToken } from './sudo-auth'
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

  // ── USER / SYSTEM-OWNER path: sudo token, now subject- and op-bound ──────
  const token = request.headers.get('x-sudo-token')
  const result = validateAndConsumeSudoToken(token)

  if (!result.ok) {
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

  // SUDO-02: the consumed token must belong to the USER on THIS session.
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
  // token minted before the flip). One-shot, op-binding, and subject-binding
  // are all preserved — this only WIDENS the subject set under the model, never
  // weakens it: a non-active-maestro UUID subject is still rejected.
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
  if (!validSubjects.has(result.subject)) {
    return NextResponse.json(
      {
        error: 'sudo_subject_mismatch',
        message: 'That confirmation does not belong to this session. Please re-enter your governance password.',
        devHint: `Sudo token subject "${result.subject}" is not an accepted subject (expected "system-owner"${validSubjects.size > 1 ? ' or the active-maestro user id' : ''}).`,
        route: `${method} ${pathTemplate}`,
      },
      { status: 403 }
    )
  }

  // SUDO-01 (two-phase, R-3): if the token was minted for a specific operation,
  // it may be consumed ONLY for that exact (method, pathTemplate). A token with
  // no `operation` (legacy / unbound) is tolerated during the rollout.
  if (
    result.operation &&
    (result.operation.method !== method || result.operation.path !== pathTemplate)
  ) {
    return NextResponse.json(
      {
        error: 'sudo_operation_mismatch',
        message: 'That confirmation was for a different action. Please re-enter your governance password.',
        devHint: `Sudo token bound to ${result.operation.method} ${result.operation.path}, but the request is ${method} ${pathTemplate}.`,
        route: `${method} ${pathTemplate}`,
      },
      { status: 403 }
    )
  }

  return null
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
 */
export const SYSTEM_OWNER_ONLY_STRICT = new Set<string>([
  'POST /api/governance/password',
  'PATCH /api/settings/security',
  'DELETE /api/settings/marketplaces',
  'PATCH /api/settings/auto-update',
  'POST /api/settings/auto-update/run',
  'POST /api/agents/import',
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
}

const STRICT_AGENT_RULES: Record<string, StrictAgentRule> = {
  'DELETE /api/agents/[id]': { action: 'delete-agent', targetFromPathId: true },
  'PATCH /api/agents/[id]/title': { action: 'change-title', targetFromPathId: true },
  'POST /api/agents/[id]/transfer': { action: 'change-title', targetFromPathId: true },
  'DELETE /api/agents/[id]/session': { action: 'delete-session', targetFromPathId: true },
  'DELETE /api/teams/[id]': { action: 'manage-team' },
  'PUT /api/teams/[id]': { action: 'manage-team' },
  'PUT /api/teams/[id]/orchestrator': { action: 'manage-team' },
  'DELETE /api/teams/[id]/orchestrator': { action: 'manage-team' },
  'POST /api/agents/cemetery': { action: 'delete-agent' },
  'DELETE /api/agents/cemetery': { action: 'delete-agent' },
  'DELETE /api/agents/role-plugins': { action: 'manage-skills' },
  'POST /api/agents/role-plugins/install': { action: 'manage-skills' },
  'DELETE /api/agents/role-plugins/install': { action: 'manage-skills' },
  // Session routes — D1: `[id]` is a tmux SESSION name, resolved to an agentId
  // inside the guard so an own-team COS restarting a session stays authorized.
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
 * NOTE: none of the routes currently in this map are strict-and-agent-callable
 * today (CreateAgent/CreateTeam are not in STRICT_AGENT_RULES), so the seam is
 * dormant on the live request path until those routes are both classified
 * strict and enabled in OPERATIONS_REQUIRING_TOKEN — at which point the entry
 * below activates with zero further code change.
 */
const STRICT_ROUTE_TO_PORTFOLIO_OP: Record<string, string> = {
  'POST /api/teams': 'CreateTeam',
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
