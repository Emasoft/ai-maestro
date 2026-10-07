/**
 * TRDD-HUSKG52P — the strict-route classification and agent policy, pinned as ONE
 * explicit table, so deriving the portfolio-op map from the rule table (and checking
 * the tables against security-registry.json at load) provably changed nothing.
 *
 * EXPECTED below was computed from the code BEFORE the change (HEAD 7a15273d8):
 * for every route in security-registry.json — agent policy ('owner-only' or the
 * StrictAgentRule fields) and guard-layer portfolio op (null = none). It is written
 * out by hand on purpose: a table computed from the derivation under test could not
 * notice the derivation changing.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import {
  SYSTEM_OWNER_ONLY_STRICT,
  AGENT_POLICY_PENDING,
  STRICT_AGENT_RULES,
  STRICT_ROUTE_TO_PORTFOLIO_OP,
  assertStrictRoutesDeclared,
} from '@/lib/sudo-guard'

type Policy = 'owner-only' | { action: string; targetFromPathId?: true; session?: true; deferToRoute?: true }

const EXPECTED: Array<[route: string, policy: Policy, portfolioOp: string | null]> = [
  ['DELETE /api/agents/[id]', { action: 'delete-agent', targetFromPathId: true }, null],
  ['DELETE /api/agents/[id]/session', { action: 'delete-session', targetFromPathId: true }, null],
  ['DELETE /api/agents/cemetery', { action: 'delete-agent' }, null],
  ['DELETE /api/agents/role-plugins', { action: 'manage-skills' }, null],
  ['DELETE /api/agents/role-plugins/install', { action: 'manage-skills' }, null],
  ['DELETE /api/auth/dev-token', 'owner-only', null],
  ['DELETE /api/governance/email', 'owner-only', null],
  ['DELETE /api/governance/maestro-delegate', 'owner-only', null],
  ['DELETE /api/sessions/[id]', { action: 'delete-session', session: true }, null],
  ['DELETE /api/settings/marketplaces', 'owner-only', null],
  ['DELETE /api/teams/[id]', { action: 'manage-team' }, null],
  ['DELETE /api/teams/[id]/orchestrator', { action: 'manage-team' }, null],
  ['GET /api/agents/[id]/block-state', { action: 'unblock-prompt', targetFromPathId: true }, null],
  ['GET /api/agents/[id]/probe', { action: 'unblock-prompt', targetFromPathId: true }, null],
  ['PATCH /api/agents/[id]', { action: 'modify-agent', targetFromPathId: true }, null],
  ['PATCH /api/agents/[id]/session', { action: 'send-command', targetFromPathId: true }, null],
  ['PATCH /api/auth/dev-token', 'owner-only', null],
  ['PATCH /api/settings/agent-plugin-whitelist', 'owner-only', null],
  ['PATCH /api/settings/auto-update', 'owner-only', null],
  ['PATCH /api/settings/security', 'owner-only', null],
  ['PATCH /api/trdd/[id]', { action: 'manage-trdd', deferToRoute: true }, null],
  ['POST /api/agents', { action: 'create-agent' }, 'CreateAgent'],
  ['POST /api/agents/[id]/continuity/compact', { action: 'send-command', targetFromPathId: true }, null],
  ['POST /api/agents/[id]/ensure-core', { action: 'modify-agent', targetFromPathId: true }, null],
  ['POST /api/agents/[id]/panel', { action: 'send-command', targetFromPathId: true }, null],
  ['POST /api/agents/[id]/prompt/answer', { action: 'unblock-prompt', targetFromPathId: true }, null],
  ['POST /api/agents/[id]/queue', { action: 'send-command', targetFromPathId: true }, null],
  ['POST /api/agents/[id]/transfer', { action: 'change-title', targetFromPathId: true }, null],
  ['POST /api/agents/cemetery', { action: 'delete-agent' }, null],
  ['POST /api/agents/foreign-approvals/[id]/approve', 'owner-only', null],
  ['POST /api/agents/foreign-approvals/[id]/reject', 'owner-only', null],
  ['POST /api/agents/import', 'owner-only', null],
  ['POST /api/agents/role-plugins/install', { action: 'manage-skills' }, null],
  ['POST /api/auth/dev-token', 'owner-only', null],
  ['POST /api/governance/email/configure', 'owner-only', null],
  ['POST /api/governance/maestro-delegate', 'owner-only', null],
  ['POST /api/governance/password', 'owner-only', null],
  ['POST /api/oauth-rotator/reauth/complete', 'owner-only', null],
  ['POST /api/oauth-rotator/reauth/start', 'owner-only', null],
  ['POST /api/sessions/[id]/kill', { action: 'delete-session', session: true }, null],
  ['POST /api/sessions/[id]/restart', { action: 'restart-session', session: true }, null],
  ['POST /api/sessions/[id]/stop', { action: 'restart-session', session: true }, null],
  ['POST /api/settings/auto-update/run', 'owner-only', null],
  ['POST /api/system/aid-recover', 'owner-only', null],
  ['POST /api/teams', { action: 'manage-team' }, 'CreateTeam'],
  ['POST /api/teams/create-with-project', { action: 'manage-team' }, 'CreateTeam'],
  ['POST /api/trdd/[id]/approve', { action: 'manage-trdd', deferToRoute: true }, null],
  ['POST /api/trdd/[id]/archive', { action: 'manage-trdd', deferToRoute: true }, null],
  ['POST /api/trdd/[id]/promote', { action: 'manage-trdd', deferToRoute: true }, null],
  ['POST /api/trdd/[id]/refuse', { action: 'manage-trdd', deferToRoute: true }, null],
  ['PUT /api/teams/[id]', { action: 'manage-team' }, null],
  ['PUT /api/teams/[id]/orchestrator', { action: 'manage-team' }, null],
]

function registryStrictKeys(): string[] {
  const reg = JSON.parse(
    readFileSync(path.resolve(__dirname, '..', '..', 'security-registry.json'), 'utf8'),
  ) as { entries: Record<string, string> }
  return Object.entries(reg.entries)
    .filter(([, level]) => level === 'strict')
    .map(([k]) => k.replace(/^([A-Z]+)_/, '$1 '))
}

/** The effective policy the guard derives for a route, in EXPECTED's shape. */
function derivedPolicy(route: string): Policy | 'PENDING' | 'UNDECLARED' {
  if (SYSTEM_OWNER_ONLY_STRICT.has(route)) return 'owner-only'
  if (AGENT_POLICY_PENDING.has(route)) return 'PENDING'
  const { portfolioOp: _p, ...rule } = STRICT_AGENT_RULES[route] ?? {}
  return STRICT_AGENT_RULES[route] ? (rule as Policy) : 'UNDECLARED'
}

describe('strict-route single source (TRDD-HUSKG52P)', () => {
  it('the pinned table covers exactly the strict routes of security-registry.json', () => {
    expect(EXPECTED.map((r) => r[0]).sort()).toEqual(registryStrictKeys().sort())
  })

  it('every route keeps its pre-change agent policy', () => {
    const got = EXPECTED.map(([route]) => [route, derivedPolicy(route)])
    expect(got).toEqual(EXPECTED.map(([route, policy]) => [route, policy]))
  })

  it('every route keeps its pre-change guard-layer portfolio op, and no route gained one', () => {
    const want = Object.fromEntries(EXPECTED.filter((r) => r[2]).map((r) => [r[0], r[2]]))
    expect(STRICT_ROUTE_TO_PORTFOLIO_OP).toEqual(want)
  })

  it('a strict route with no declaration fails closed with a throw, not a default', () => {
    expect(() =>
      assertStrictRoutesDeclared([...registryStrictKeys(), 'POST /api/brand/new'], {
        ownerOnly: SYSTEM_OWNER_ONLY_STRICT,
        pending: AGENT_POLICY_PENDING,
        rules: Object.keys(STRICT_AGENT_RULES),
      }),
    ).toThrow(/strict but declared nowhere: POST \/api\/brand\/new/)
  })

  it('a declaration for a route that is not strict throws', () => {
    const strict = registryStrictKeys().filter((k) => k !== 'POST /api/teams')
    expect(() =>
      assertStrictRoutesDeclared(strict, {
        ownerOnly: SYSTEM_OWNER_ONLY_STRICT,
        pending: AGENT_POLICY_PENDING,
        rules: Object.keys(STRICT_AGENT_RULES),
      }),
    ).toThrow(/declared but not strict: POST \/api\/teams/)
  })

  it('a route declared in two tables throws', () => {
    expect(() =>
      assertStrictRoutesDeclared(registryStrictKeys(), {
        ownerOnly: [...SYSTEM_OWNER_ONLY_STRICT, 'POST /api/teams'],
        pending: AGENT_POLICY_PENDING,
        rules: Object.keys(STRICT_AGENT_RULES),
      }),
    ).toThrow(/declared in more than one table: POST \/api\/teams/)
  })

  it('the real tables agree with the real registry (this is what the module-load check runs)', () => {
    expect(() =>
      assertStrictRoutesDeclared(registryStrictKeys(), {
        ownerOnly: SYSTEM_OWNER_ONLY_STRICT,
        pending: AGENT_POLICY_PENDING,
        rules: Object.keys(STRICT_AGENT_RULES),
      }),
    ).not.toThrow()
  })
})
