/**
 * Portfolio MINT-authority gate (R28.2 / R29 / R30) — who may mint which token.
 *
 * Deny-by-default issuer→allowed-scope matrix. This is authorization for an
 * AGENT-callable route, so it relies PURELY on the AID-derived AuthContext
 * (title + own standing authority). R32: it MUST NOT consult sudo.
 *
 *  - MANAGER (`ctx.governanceTitle === 'manager'`) → may mint ANY token for any
 *    subject (incl. the `team:create` mandate and AUTONOMOUS/MAINTAINER
 *    lifecycle approvals — R29.1/R29.3/R30.1).
 *  - CHIEF-OF-STAFF → may mint `mandate` tokens ONLY for its OWN team's MEMBERs
 *    and ONLY for MEMBER-class scopes. A COS may NOT mint `team:create` and may
 *    NOT empower a non-member (R30.3).
 *  - SYSTEM-OWNER / USER (dashboard, `ctx.isSystemOwner`) → may mint.
 *  - Anyone else → refused.
 */

import type { AuthContext } from '@/lib/agent-auth'
import type { PortfolioTokenKind } from '@/types/portfolio'

export interface IssueRequestBody {
  kind: PortfolioTokenKind
  scope: string
  subject_agent_id: string
  target_agent_id?: string
  target_team_id?: string
}

export interface IssueDecision {
  ok: boolean
  reason?: string
}

/**
 * Scopes a COS is permitted to grant — strictly MEMBER-class lifecycle/work
 * scopes. Deliberately NARROW (security-first); a COS can never grant
 * team:create or any governance-configuration scope. Extend only as R30
 * directs.
 */
const COS_ALLOWED_SCOPES = new Set<string>([
  'agent:create',
])

/** Scopes only a MANAGER (or the USER) may ever grant. */
const MANAGER_ONLY_SCOPES = new Set<string>([
  'team:create',
])

/**
 * Decide whether `ctx` may mint the requested token. Pure decision — no
 * side effects, no sudo. `getTeam`/membership lookups are synchronous registry
 * reads.
 */
export function canIssue(ctx: AuthContext, body: IssueRequestBody): IssueDecision {
  if (!body || typeof body.scope !== 'string' || !body.scope.includes(':')) {
    return { ok: false, reason: 'Invalid token scope (expected "resource:action").' }
  }
  if (!body.subject_agent_id || typeof body.subject_agent_id !== 'string') {
    return { ok: false, reason: 'Missing subject_agent_id (the empowered agent).' }
  }
  if (body.kind !== 'approval' && body.kind !== 'mandate') {
    return { ok: false, reason: `Invalid token kind "${String(body.kind)}".` }
  }

  // ── SYSTEM-OWNER / USER (dashboard) — the mint authority of last resort ──
  if (ctx.isSystemOwner) {
    return { ok: true }
  }

  const title = (ctx.governanceTitle || '').toLowerCase()

  // ── MANAGER — may mint anything for anyone (R29.1/R29.3/R30.1) ──
  if (title === 'manager') {
    return { ok: true }
  }

  // ── CHIEF-OF-STAFF — narrow: own-team MEMBER mandate, member scopes only ──
  if (title === 'chief-of-staff') {
    if (body.kind !== 'mandate') {
      return { ok: false, reason: 'A CHIEF-OF-STAFF may mint only mandate tokens.' }
    }
    if (MANAGER_ONLY_SCOPES.has(body.scope)) {
      return { ok: false, reason: `A CHIEF-OF-STAFF may not mint "${body.scope}" — that scope is MANAGER-only.` }
    }
    if (!COS_ALLOWED_SCOPES.has(body.scope)) {
      return { ok: false, reason: `A CHIEF-OF-STAFF may not mint scope "${body.scope}".` }
    }
    // The subject MUST be a member of the COS's own team (R30.3).
    if (!ctx.teamId) {
      return { ok: false, reason: 'CHIEF-OF-STAFF has no team — cannot empower a member.' }
    }
    if (!isAgentInTeam(body.subject_agent_id, ctx.teamId)) {
      return { ok: false, reason: 'A CHIEF-OF-STAFF may only empower members of its OWN team.' }
    }
    return { ok: true }
  }

  // ── Everyone else — denied ──
  return { ok: false, reason: `Title "${title || 'none'}" may not mint portfolio tokens.` }
}

/**
 * Synchronous team-membership check via the team registry. Returns false on
 * any read error (fail closed). Uses require() to avoid a top-level cycle
 * (team-registry → agent-registry → … pulls a large graph).
 */
function isAgentInTeam(agentId: string, teamId: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const teamRegistry = require('@/lib/team-registry') as {
      loadTeams: () => Array<{ id: string; agentIds: string[] }>
    }
    const team = teamRegistry.loadTeams().find(t => t.id === teamId)
    return !!team && team.agentIds.includes(agentId)
  } catch (err) {
    console.warn('[portfolio-issue-guard] team-membership lookup failed, denying:', err)
    return false
  }
}
