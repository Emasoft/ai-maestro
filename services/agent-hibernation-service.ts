// Hibernation roster — the I/O half of the "asleep or broken?" question (TRDD-14HI8ZPR).
//
// `lib/agent-hibernation.ts` holds the PURE derivation and takes no clock, spawns nothing and reads
// no file. This module is the thin layer that gathers the three facts it needs and hands them over.
// The split is what lets the classification be tested exhaustively without a registry, a tmux
// server, or a repointed `$HOME`.
//
// ── WHO MAY CALL THIS, AND WHY IT IS NOT A CLI ───────────────────────────────────────────────────
// Agent status is NOT public data — a roster names every agent, its uuid and its tmux session name,
// which is a map of the fleet. `GET /api/agents` already carries the ruling in its own comment
// ("CC-GOV-008: Auth required to prevent metadata leaks via Tailscale"), and this is the same class
// of data.
//
// So there are exactly TWO callers, both inside the server process:
//   1. `app/api/agents/hibernation/route.ts` — behind `authenticateFromRequest`, i.e. the server
//      validates the caller on every request.
//   2. the in-server daemon publisher, which writes each janitor the slice it is entitled to.
//
// An earlier revision of this work shipped a standalone CLI that read `~/.aimaestro` directly with
// no authentication and worked with the server DOWN. That was reverted (3f069c22). The reasoning
// that produced it is worth naming, because it is the tempting one: `aimaestro-agent.sh` runs
// `check_api_running || exit 1` and passes an `$AID_AUTH` bearer, the janitor daemon has neither,
// and so the gate LOOKED like an obstacle to route around. It is the boundary. With no server there
// is nothing to validate signatures against, so nothing may execute — and the janitor never needed
// to call in at all: the daemon publishes to it.

import { listAgents } from '@/lib/agent-registry'
import { loadPersistedSessions } from '@/lib/session-persistence'
import { getRuntime } from '@/lib/agent-runtime'
import { computeSessionName } from '@/types/agent'
import {
  buildHibernationRoster,
  type HibernationRoster,
  type AgentHibernationRecord,
  type HibernationState,
} from '@/lib/agent-hibernation'

/** Injectable seams so a test drives the gather without a registry or a live tmux server. */
export interface GatherDeps {
  listAgents?: typeof listAgents
  loadPersistedSessions?: typeof loadPersistedSessions
  listTmuxSessionNames?: () => Promise<string[]>
}

/**
 * Read the three facts and classify the whole harness.
 *
 * The tmux read is ONE `runtime.listSessions()` for the fleet, not `sessionExists` per agent —
 * that would spawn one subprocess per agent to answer what a single call answers. The runtime's
 * parser captures a session name as `[^:]+`, which is safe here because agent names are validated
 * `/^[a-zA-Z0-9_@.-]+$/` (lib/create-agent-schema.ts) and so can never contain a colon. If that
 * regex is ever widened to allow one, a mis-parsed name silently drops its session and the agent
 * reads as `crashed` — a false alarm — so widen the runtime's parser in the same change.
 */
export async function gatherHibernationRoster(deps: GatherDeps = {}): Promise<HibernationRoster> {
  const list = deps.listAgents ?? listAgents
  const loadPersisted = deps.loadPersistedSessions ?? loadPersistedSessions
  const listTmux = deps.listTmuxSessionNames ?? (async () => (await getRuntime().listSessions()).map((s) => s.name))

  // `false` ⇒ live agents only. A deleted agent is not part of the harness, and reporting one would
  // resurrect it in every consumer's view of the fleet.
  const summaries = list(false)
  const persisted = loadPersisted()
  const liveTmuxSessions = new Set(await listTmux())

  return buildHibernationRoster({
    agents: summaries.map((s) => ({
      id: s.id,
      name: s.name,
      sessionName: computeSessionName(s.name || 'unknown', 0),
      // "has the registry EVER recorded a session" — deliberately NOT
      // `getAgentSessionStatus().hasSession`, which returns true for any named agent and so could
      // never surface `never_woken`. See the field's docstring in lib/agent-hibernation.ts.
      hasSession: (s.sessions?.length ?? 0) > 0,
      // Same fallback chain `defaultFleetScanDeps` uses: an AgentSummary does not always carry the
      // workdir directly, but the index-0 session record does.
      workingDirectory: s.sessions?.find((x) => x.index === 0)?.workingDirectory ?? null,
    })),
    persisted,
    liveTmuxSessions,
  })
}

/**
 * What ONE agent's janitor is entitled to see: its own record, plus fleet-wide COUNTS.
 *
 * LEAST PRIVILEGE, and the reason it is a function rather than a convention. A per-agent janitor
 * guards its OWN session; the fleet-wide view is the daemon's job. Publishing the full roster into
 * every agent workdir would put a complete map of the fleet — every uuid, name and session name —
 * inside every agent's own directory, so compromising any one agent would yield the whole fleet.
 * The counts are enough for a janitor to know whether it is looking at a healthy host, and they
 * name nobody.
 *
 * Returns null when the agent is not in the roster, so a caller cannot accidentally publish an
 * empty-but-plausible file for an agent that does not exist.
 */
export function agentScopedView(
  roster: HibernationRoster,
  agentId: string,
): { agent: AgentHibernationRecord; counts: Record<HibernationState, number> & { orphaned: number } } | null {
  const agent = roster.agents.find((a) => a.agentId === agentId)
  if (!agent) return null
  return { agent, counts: roster.counts }
}
