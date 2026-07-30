// Turning "a global change landed" into the SET of harness agents to restart —
// R42.7(a) uniform fan-out + R42.7(d) same-host/harness-only (TRDD-QZL828OD).
//
// Split from `lib/fleet-restart-driver.ts` on purpose. The driver answers "how do I
// restart one agent safely?"; this file answers "WHICH agents, and am I allowed to
// touch them?" Those are the two independent ways this feature can be wrong, and
// keeping them apart is what lets each be tested for its own failure:
//   - a driver bug restarts a busy agent,
//   - a fan-out bug restarts an agent that is not ours.
//
// The workdir gate is `checkAuthorizedAgentWorkdir` — the ONE workdir authority
// (lib/agent-workdir-policy.ts). It is NOT re-derived here, and that is deliberate:
// the last time this repo re-implemented the `~/agents/` rule in a second place, the
// two copies diverged and an adopted agent's session could never start. The gate
// also matters concretely rather than cosmetically — a legacy `default` agent in the
// registry carries `workingDirectory: "/"`, and an ungated fan-out would happily try
// to restart it.

import type { FleetRestartOutcome, FleetRestartTarget } from '@/lib/fleet-restart-driver'

export interface FanoutDeps {
  loadAgents?: () => Array<Record<string, unknown>>
  checkAuthorizedAgentWorkdir?: (
    cwd: string | null | undefined,
    agentName?: string,
  ) => { ok: boolean; reason?: string }
  restartHarnessFleet?: typeof import('@/lib/fleet-restart-driver').restartHarnessFleet
  log?: (msg: string) => void
}

/** Registry agents that are live, have a workdir, and pass the workdir authority. */
async function authorizedHarnessAgents(deps: FanoutDeps) {
  const loadAgents =
    deps.loadAgents ?? (await import('@/lib/agent-registry')).loadAgents as unknown as () => Array<Record<string, unknown>>
  const checkWorkdir =
    deps.checkAuthorizedAgentWorkdir ??
    (await import('@/lib/agent-workdir-policy')).checkAuthorizedAgentWorkdir
  return loadAgents()
    .filter((a) => !a.deletedAt && a.workingDirectory)
    .filter((a) => checkWorkdir(a.workingDirectory as string, a.name as string).ok)
}

/**
 * Restart the harness agents whose tmux sessions are named in `sessionNames`.
 *
 * The caller (the auto-update tick) derives that list from the updates it ACTUALLY
 * applied, which is what makes the fan-out uniform rather than targeted under
 * R42.7(a): this function never picks an agent, it only filters the caller's set
 * down to the agents it is permitted to touch.
 *
 * A named session with no authorized registry agent behind it is DROPPED, not
 * guessed at — a session we cannot attribute to a registry entry is not provably a
 * harness agent, and R42.7(d) is a boundary, not a heuristic.
 */
export async function restartFleetForSessions(
  sessionNames: readonly string[],
  reason: string,
  deps: FanoutDeps = {},
): Promise<FleetRestartOutcome[]> {
  const log = deps.log ?? ((m: string) => console.log(m))
  if (sessionNames.length === 0) return []

  const agents = await authorizedHarnessAgents(deps)
  const wanted = new Set(sessionNames)
  const targets: FleetRestartTarget[] = []

  for (const name of wanted) {
    const agent = agents.find(
      (a) =>
        a.name === name ||
        (Array.isArray(a.sessions) &&
          (a.sessions as Array<Record<string, unknown>>).some((s) => s.index === 0 && a.name === name)),
    )
    if (!agent) {
      log(`[fleet-restart] skipping session "${name}" — no authorized harness agent claims it`)
      continue
    }
    targets.push({ sessionName: name, agent: agent as FleetRestartTarget['agent'] })
  }

  const run =
    deps.restartHarnessFleet ?? (await import('@/lib/fleet-restart-driver')).restartHarnessFleet
  return run(targets, reason, { log })
}

/**
 * Restart EVERY authorized harness agent — for a change that affects all of them
 * rather than a known set of sessions (a user-scope plugin update, or a
 * `~/.claude/settings.json` runtime-env re-apply, which every agent reads at launch).
 *
 * This is the shape R42.7 was written for: no selection at all, the whole harness or
 * nothing. Agents that are busy are skipped by the driver's safe-state gate, so
 * "restart everything" never means "interrupt everything".
 */
export async function restartEntireHarnessFleet(
  reason: string,
  deps: FanoutDeps = {},
): Promise<FleetRestartOutcome[]> {
  const log = deps.log ?? ((m: string) => console.log(m))
  const agents = await authorizedHarnessAgents(deps)
  const targets: FleetRestartTarget[] = agents
    .filter((a) => typeof a.name === 'string' && a.name)
    .map((a) => ({ sessionName: a.name as string, agent: a as FleetRestartTarget['agent'] }))

  const run =
    deps.restartHarnessFleet ?? (await import('@/lib/fleet-restart-driver')).restartHarnessFleet
  return run(targets, reason, { log })
}
