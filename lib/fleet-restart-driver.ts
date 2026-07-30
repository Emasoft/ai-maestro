// The R42.7 fleet restart driver — the server-as-daemon restarting harness agents
// after a global change it just applied (TRDD-QZL828OD, capability #1).
//
// WHY THIS EXISTS AT ALL, and why the thing it replaces did not work:
// `services/auto-update-service.ts` has had a `RestartNotifier` seam since it was
// written, and its own doc comment says "server.mjs wires this to the WebSocket
// broadcast which the UI's useRestartQueue picks up". Neither half was true:
// `server.mjs` called `startAutoUpdateScheduler()` with NO argument, so
// `restartNotifier` stayed `null` and the notify step was a no-op on every tick
// forever. And the design it described could not have served the case that matters
// — routing through the UI's `useRestartQueue` means a restart happens only while
// a browser is open, so the unattended host (the one that most needs to pick up a
// plugin update) is exactly the one that never would.
//
// So the driver is SERVER-SIDE. That required a governance ruling, because R42.1
// forbids injecting anything into another agent's session and R42.super names
// `POST /api/sessions/[id]/restart` as one of the routes whose cross-agent case
// R42 revoked. R42.7 grants this narrow case and every one of its six constraints
// is implemented here rather than assumed:
//
//   (a) UNIFORM  — the caller passes the set of agents AFFECTED by the change; this
//                  module never selects one. A targeted restart is R42.1 injection
//                  under another name.
//   (b) NO CONTENT — the command comes from `prepareRelaunchCommand`, which replays
//                  the agent's STORED program/args. Nothing here can express text.
//   (c) SAFE-STATE — `readSubagentCount` + `evaluateExitGate(count, force=false)`,
//                  the same gate the human's Restart button obeys. A busy agent is
//                  SKIPPED, never forced: the update lands at its next restart, and
//                  interrupting work to make the fleet current is the wrong trade.
//   (d) SAME-HOST, HARNESS-ONLY — the caller enumerates through
//                  `checkAuthorizedAgentWorkdir`; a foreign or bogus workdir never
//                  reaches us.
//   (e) AUDITED  — every restart emits a `fleet_restart` ledger entry. An unattended
//                  fan-out nobody can reconstruct afterwards is indistinguishable
//                  from an intrusion, so the audit is part of the grant, not polish.
//   (f) NO AGENT MAY INVOKE IT — this module is imported by `server.mjs`'s own tick
//                  and by nothing else. There is deliberately no route, no script,
//                  and no CLI verb that reaches it; `tests/unit/fleet-restart-driver.test.ts`
//                  pins that absence by scanning the tree, because the constraint is
//                  about who CAN call it, which no test of this function can show.

import type { RelaunchAgentLike } from '@/lib/session-relaunch'

/** One agent the caller has decided is affected by the global change. */
export interface FleetRestartTarget {
  sessionName: string
  agent: RelaunchAgentLike | null | undefined
}

export type FleetRestartDisposition =
  | 'restarted'
  /** Safe-state gate: background subagents still running — R42.7(c). */
  | 'skipped-busy'
  /** `prepareRelaunchCommand` refused (bad args / unresolvable persona). */
  | 'skipped-unprepared'
  /** The stop→poll→relaunch sequence timed out or errored. */
  | 'failed'

export interface FleetRestartOutcome {
  sessionName: string
  disposition: FleetRestartDisposition
  detail?: string
}

export interface FleetRestartDeps {
  prepareRelaunchCommand?: typeof import('@/lib/session-relaunch').prepareRelaunchCommand
  runRestartSequence?: typeof import('@/lib/session-restart').runRestartSequence
  readSubagentCount?: (workingDir: string | undefined | null) => number | null
  evaluateExitGate?: (
    count: number | null,
    force: boolean,
  ) => { blocked: boolean; subagentCount: number | null }
  emitAgentOp?: (op: string, diff: unknown, auth?: unknown) => void
  log?: (msg: string) => void
}

/**
 * Restart every target that is safe to restart, sequentially.
 *
 * SEQUENTIAL on purpose: `runRestartSequence` polls a pane for up to 15 s, and
 * restarting the whole fleet at once would take every agent down in the same
 * window — turning a routine update into a fleet-wide outage. One at a time keeps
 * the blast radius to a single agent even if the sequence misbehaves.
 *
 * Never throws: a per-agent failure is recorded and the fan-out continues, because
 * one unpreparable agent must not stop the rest of the fleet from picking up the
 * update. Returns one outcome per target, for the caller's log and the run summary.
 */
export async function restartHarnessFleet(
  targets: readonly FleetRestartTarget[],
  reason: string,
  deps: FleetRestartDeps = {},
): Promise<FleetRestartOutcome[]> {
  const prepare =
    deps.prepareRelaunchCommand ??
    (await import('@/lib/session-relaunch')).prepareRelaunchCommand
  const runSequence =
    deps.runRestartSequence ?? (await import('@/lib/session-restart')).runRestartSequence
  const safeState = await import('@/lib/session-safe-state')
  const readCount = deps.readSubagentCount ?? safeState.readSubagentCount
  const exitGate = deps.evaluateExitGate ?? safeState.evaluateExitGate
  const emit =
    deps.emitAgentOp ??
    ((op, diff, auth) => {
      // Fire-and-forget by design, and safe HERE specifically because the server is
      // long-lived: `emitAgentOp` does not await its append, so the same call from a
      // short-lived CLI can lose the entry at process exit (that is a real hazard
      // recorded elsewhere, not a hypothetical). Inside the server the loop stays
      // alive long past the write.
      void (import('@/lib/ledger-emit')).then((m) =>
        m.emitAgentOp(op as never, diff as never, auth as never),
      )
    })
  const log = deps.log ?? ((m: string) => console.log(m))

  const outcomes: FleetRestartOutcome[] = []

  for (const target of targets) {
    const { sessionName, agent } = target
    const workdir = agent?.workingDirectory || agent?.sessions?.[0]?.workingDirectory

    // R42.7(c) — the safe-state gate, evaluated BEFORE anything is stopped.
    // `force` is hard-coded false: there is no caller-supplied override, because a
    // daemon that can force is a daemon that can interrupt a working agent, which
    // is the one thing this grant does not cover.
    const gate = exitGate(readCount(workdir), false)
    if (gate.blocked) {
      outcomes.push({
        sessionName,
        disposition: 'skipped-busy',
        detail: `${gate.subagentCount} background subagent(s) running`,
      })
      continue
    }

    const prep = await prepare(agent, sessionName)
    if (prep.kind !== 'ready') {
      outcomes.push({
        sessionName,
        disposition: 'skipped-unprepared',
        detail: prep.kind === 'invalid-args' ? 'programArgs rejected' : prep.reason,
      })
      continue
    }

    const outcome = await runSequence(sessionName, prep.command)
    if (outcome.status === 'ok') {
      outcomes.push({ sessionName, disposition: 'restarted' })
      // R42.7(e) — the audit entry. Records WHAT triggered it, not just that it
      // happened, so a reader months later can tell a plugin-update fan-out from
      // anything else that restarted the fleet.
      emit(
        'fleet_restart',
        { sessionName, agentId: agent?.id ?? null, reason },
        { action: 'fleet-restart', actor: 'system' },
      )
    } else {
      outcomes.push({
        sessionName,
        disposition: 'failed',
        detail: outcome.status === 'timeout' ? 'timeout waiting for shell' : outcome.detail,
      })
    }
  }

  const tally = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.disposition] = (acc[o.disposition] ?? 0) + 1
    return acc
  }, {})
  log(
    `[fleet-restart] ${reason}: ` +
      (Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ') || 'no targets'),
  )

  return outcomes
}
