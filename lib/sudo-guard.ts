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

  // SUDO-02: the consumed token must belong to the USER. Under R32 the mint
  // route always issues subject 'system-owner', so any other subject is a
  // legacy/agent token that must not authorize a USER-path strict op.
  if (result.subject !== 'system-owner') {
    return NextResponse.json(
      {
        error: 'sudo_subject_mismatch',
        message: 'That confirmation does not belong to this session. Please re-enter your governance password.',
        devHint: `Sudo token subject "${result.subject}" is not "system-owner".`,
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
 * R28 check #3 PRE-WIRE — portfolio / mandate token (server-stored secure
 * enclave, future TRDD). Today a NO-OP returning allow. When the enclave
 * ships, the portfolio approval/mandate check wires in HERE at exactly ONE
 * call site (operations that "require approval" — cross-team transfer,
 * manage-team — are its future consumers). See R28.2 check #3.
 */
function requirePortfolioToken(
  _auth: AgentAuthResult,
  _method: string,
  _pathTemplate: string
): { allowed: boolean; reason?: string } {
  // R28 #3: no enclave yet — allow. DO NOT add logic here without the enclave.
  return { allowed: true }
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
