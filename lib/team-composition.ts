/**
 * Team composition check (R12)
 *
 * WT-010#3 (SCEN-010 P0): R12 is already enforced server-side in
 * `services/element-management-service.ts` (PG06 gate), but it was never
 * surfaced in the UI. This function is the client-side mirror of the
 * PG06 check — given a team and the full agent list, it returns whether
 * the team meets the R12 minimum-composition requirement (all 5 required
 * titles present) and, if not, which titles are missing.
 *
 * The server is still the authority — this is purely a UI hint so users
 * can see at a glance which teams need attention. If the client's view
 * lags behind the server for a moment (registry write vs. UI refetch),
 * a stale badge is an acceptable tradeoff for the feedback.
 */

import type { Team } from '@/types/team'
import type { Agent } from '@/types/agent'

/** The 5 team-scoped titles that R12 requires for a functional team. */
export const REQUIRED_TEAM_TITLES = [
  'chief-of-staff',
  'architect',
  'orchestrator',
  'integrator',
  'member',
] as const

export interface TeamCompositionStatus {
  /** True iff all 5 required titles are present among the team's agents. */
  complete: boolean
  /** Lower-case titles missing from the team, in the canonical order. */
  missing: string[]
}

/**
 * Checks whether a team satisfies R12 (all 5 required titles present).
 *
 * Pure function. Takes the team + the full agent list (both already
 * resident in the client via `useSessions` / team registry hooks) so
 * there is no extra fetch.
 */
export function checkTeamComposition(team: Team, agents: Agent[]): TeamCompositionStatus {
  const teamAgentIds = new Set(team.agentIds || [])
  const presentTitles = new Set<string>()
  for (const agent of agents) {
    if (!teamAgentIds.has(agent.id)) continue
    const title = (agent.governanceTitle || 'autonomous').toLowerCase()
    presentTitles.add(title)
  }
  const missing = REQUIRED_TEAM_TITLES.filter(t => !presentTitles.has(t))
  return { complete: missing.length === 0, missing }
}
