/**
 * IBCT Scope Enforcement.
 *
 * When an agent authenticates via IBCT (JWT/EdDSA), the token carries
 * scope claims (e.g., ["agent:create", "team:manage"]). This module
 * checks that the token's scope includes the required scope for the
 * requested operation.
 *
 * Non-IBCT auth paths (aim_tk_ tokens, session cookies) skip scope
 * checking — they have their own authorization (governance title checks,
 * sudo-mode, system-owner enforcement).
 *
 * Scope format follows AIP (arXiv:2603.24775): "resource:action" pairs.
 */

import type { AuthContext } from '@/lib/agent-auth'

/**
 * Map of Change* operations → required IBCT scope.
 * Operations not listed here have no scope requirement (open to any
 * authenticated caller with appropriate title).
 */
const OPERATION_SCOPES: Record<string, string> = {
  // Agent lifecycle
  CreateAgent: 'agent:create',
  DeleteAgent: 'agent:delete',
  WakeAgent: 'agent:wake',
  HibernateAgent: 'agent:hibernate',

  // Team operations
  CreateTeam: 'team:create',
  DeleteTeam: 'team:delete',
  UpdateTeam: 'team:manage',
  AssignChiefOfStaff: 'team:manage',

  // Title changes
  ChangeTitle: 'title:change',

  // Plugin management
  ChangePlugin: 'plugin:install',
  UninstallPlugin: 'plugin:uninstall',

  // Governance configuration
  ChangeGovernancePassword: 'governance:configure',
  ChangeSecurityConfig: 'governance:configure',

  // Messaging
  BroadcastMessage: 'message:broadcast',
}

/**
 * Check if the AuthContext's IBCT scopes include the required scope
 * for the given operation.
 *
 * Returns null if authorized, or an error string if denied.
 *
 * Skips the check if the auth context has no ibctScope (non-IBCT auth).
 */
export function checkIbctScope(
  ctx: AuthContext,
  operation: string,
): string | null {
  // Non-IBCT auth — scope check not applicable
  if (!ctx.ibctScope || ctx.ibctScope.length === 0) return null

  const requiredScope = OPERATION_SCOPES[operation]
  // Operation has no scope requirement — allow
  if (!requiredScope) return null

  // Check if the token's scope includes the required scope
  if (ctx.ibctScope.includes(requiredScope)) return null

  // Check for wildcard scope (e.g., "agent:*" covers "agent:create")
  const [resource] = requiredScope.split(':')
  if (ctx.ibctScope.includes(`${resource}:*`)) return null

  return `IBCT scope denied: operation "${operation}" requires scope "${requiredScope}" but token has [${ctx.ibctScope.join(', ')}]`
}
