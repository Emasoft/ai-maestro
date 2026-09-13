import path from 'path'
import { getAgent } from '@/lib/agent-registry'
import { defaultDesignDir } from '@/lib/trdd-store'

/**
 * TRDD-KJQZEYXW — resolve which project's `design/` directory a /api/trdd call
 * operates on. With an explicit `agentId` it targets THAT agent's
 * `<workingDirectory>/design` (so the janitor can manage any fleet agent's TRDD
 * corpus); with none it defaults to the AI Maestro server's own repo `design/`.
 *
 * Pure lib→lib (getAgent from the registry) — no service dependency, no cycle.
 */
export function resolveDesignDir(
  auth: { agentId?: string | null } | null,
  requestedAgentId: string | null,
): string {
  // SECURITY: an authenticated AGENT (`auth.agentId` set) ALWAYS gets its own
  // corpus — a caller-supplied `requestedAgentId` is ignored, so an agent can
  // never point a request at another agent's design/ (and thereby at the
  // frontmatter authorizeTrddVerb() trusts: min-approval, assignee, created-by).
  // Only the system owner (auth.agentId absent) may target another project via
  // requestedAgentId.
  const effectiveAgentId = auth?.agentId || requestedAgentId
  if (effectiveAgentId) {
    const agent = getAgent(effectiveAgentId)
    if (agent?.workingDirectory) {
      return path.join(agent.workingDirectory, 'design')
    }
  }
  return defaultDesignDir()
}

/** TRDD ids are 8-char base36 (A-Z0-9), NOT UUIDs — validate accordingly. */
export function isValidTrddId(id: string): boolean {
  return /^[A-Za-z0-9]{8}$/.test(id)
}
