// Agent hibernation state — the ONE derivation of "is this agent deliberately asleep, or broken?"
//
// WHY THIS MODULE EXISTS. There is no stored hibernation fact to read. `Agent['status']` is
// `active | idle | offline | deleted` (types/agent.ts:465) — four values, NONE of them
// `hibernated`. (This said three until ai-maestro#114 caught the omission; the argument is
// unchanged, but a reader who checked it against the real type found a mismatch that made a
// correct claim look wrong.) So a hibernated agent, a crashed one, and one that was never woken
// are ALL recorded as `offline` — measured 2026-08-05 on the live registry: 9 non-deleted agents,
// every single one `offline`, of which 6 were cleanly hibernated and 3 had crashed. Anything that
// reports from `status` alone therefore cannot distinguish a deliberate sleep from an outage, and a
// fleet guardian that reports deliberate hibernation as a fault is worse than one that reports
// nothing — it manufactures alarms nobody can act on.
//
// WHY IT IS SEPARATE FROM `fleet-liveness.ts` DESPITE LIVING THERE FIRST. The decision below WAS
// embedded in `classifyLiveness`, reachable only from inside the running server. The janitor needs
// the same answer from outside it (`harness_backend.instance_is_server_owned` documents that
// `aimaestro-agent.sh list` 401s the daemon, which holds no `$AID_AUTH`), and the settings-page
// JANITOR REPORT needs it too. Three consumers, so the decision is extracted ONCE and
// `classifyLiveness` now calls it. It is deliberately NOT re-implemented per consumer: a second
// copy of a four-way classification drifts, and the direction it drifts is "an agent the fleet
// thinks is fine".
//
// THE LOAD-BEARING FACT THAT MAKES `crashed` HONEST. `hibernateAgent` calls
// `unpersistSession(sessionName)` (services/agents-core-service.ts:2587), so a clean hibernate
// ALWAYS removes the persisted record. A session that is still persisted while its tmux is gone
// therefore means the clean path never ran — a reboot, an outside `tmux kill-session`, an OOM. If
// that call is ever removed, `crashed` silently becomes a false positive on every hibernated agent
// and this whole module inverts. Do not remove it without changing the classifier here.

/**
 * The four states an agent can be in with respect to hibernation. Distinct from
 * `LivenessClass` on purpose: that one answers "should we try to recover it", this one answers
 * "is it asleep or is it broken". A `running` agent is simply handed on to the liveness ladder.
 */
export type HibernationState =
  | 'running' // a live tmux session exists — say nothing about whether it is healthy
  | 'hibernated' // no tmux and not persisted — asleep BY DESIGN. A healthy state, never a fault.
  | 'crashed' // no tmux but STILL persisted — the clean hibernate path never ran
  | 'never_woken' // the registry has no session record at all — created but never started

/**
 * The observed facts the classification is made from. All three are cheap, read-only and available
 * both inside the server and from a standalone process, which is what lets one function serve the
 * watchdog, the CLI and the report.
 */
export interface HibernationInput {
  /**
   * The registry has ever recorded a session for this agent.
   *
   * ⚠ This is NOT `getAgentSessionStatus().hasSession`, which returns `true` for ANY named agent
   * and so can never be false in practice. Callers that mean "was this agent ever woken" must pass
   * `(agent.sessions?.length ?? 0) > 0`. The classifier is pure over what it is given, so the two
   * callers may legitimately source this differently — but a caller that passes the always-true
   * variant simply never observes `never_woken`, which is correct for the liveness path and wrong
   * for a roster.
   */
  hasSession: boolean
  /** A tmux session with this agent's computed session name exists right now. */
  exists: boolean
  /**
   * The agent is still in the server's session-persistence record (`~/.aimaestro/sessions.json`,
   * added on wake, removed on hibernate). This is the ONLY crashed-vs-hibernated discriminator.
   * Absent/undefined ⇒ treated as NOT persisted, i.e. the benign `hibernated` reading — an unknown
   * must never be reported as a crash.
   */
  isPersisted?: boolean
}

export interface HibernationVerdict {
  state: HibernationState
  /** Human-readable justification, safe to render in a report cell. */
  reason: string
}

/**
 * PURE classifier. Order matters and is the safe-first ordering: the two states that mean "nothing
 * is wrong" (`never_woken`, `running`) are decided before the pair that needs the persistence
 * discriminator, so an agent can never be called `crashed` on the strength of a missing record
 * alone.
 */
export function classifyHibernation(input: HibernationInput): HibernationVerdict {
  if (!input.hasSession) {
    return { state: 'never_woken', reason: 'no session record — created but never started' }
  }
  if (input.exists) {
    return { state: 'running', reason: 'a live tmux session exists' }
  }
  // No tmux. The persistence record is what separates a deliberate sleep from a broken one: a clean
  // hibernate unpersists (see the module header), so a surviving record means it never completed.
  if (input.isPersisted) {
    return {
      state: 'crashed',
      reason: 'still persisted but tmux is gone — the clean hibernate path never ran (reboot, outside kill, or crash)',
    }
  }
  return { state: 'hibernated', reason: 'not persisted and no tmux — cleanly hibernated' }
}

/** True when this state means "nothing is wrong" — the guard a reporter uses so it cannot alarm on
 *  a deliberate sleep. Exported rather than left to each caller's `=== 'crashed'` test, because the
 *  set of healthy states is the thing likely to change (a future `paused`), not the test. */
export function isHealthyHibernationState(state: HibernationState): boolean {
  return state !== 'crashed'
}

// ── Roster ────────────────────────────────────────────────────────────────────────────────────
// The per-agent classification above, applied across the whole harness, plus the one fleet-level
// finding that only appears when you look at the WHOLE set rather than agent by agent.

/** One agent's facts, already gathered. Structural so the roster is testable with no registry. */
export interface RosterAgentInput {
  id: string
  name?: string
  /** The tmux session name computed for index 0 (`computeSessionName`). */
  sessionName: string
  /** The registry has ever recorded a session — see `HibernationInput.hasSession`. */
  hasSession: boolean
  /**
   * The agent's own working directory, carried through so the daemon publisher can DERIVE where to
   * deposit this agent's response without a second registry read. It is validated against
   * `AGENTS_ROOT` at the point of write, never trusted from here — a hand-edited or corrupted
   * registry row must not be able to aim the writer at an arbitrary directory.
   */
  workingDirectory?: string | null
}

/** A persisted row as it appears in `sessions.json` — `id` is the SESSION NAME, not an agent id. */
export interface RosterPersistedInput {
  id: string
  agentId?: string
  name?: string
}

export interface RosterInput {
  /** Live (non-deleted) agents only. A deleted agent is not part of the harness. */
  agents: RosterAgentInput[]
  persisted: RosterPersistedInput[]
  /** tmux session names that exist right now. */
  liveTmuxSessions: Set<string>
}

export interface AgentHibernationRecord extends HibernationVerdict {
  agentId: string
  name?: string
  sessionName: string
  persisted: boolean
  tmux: boolean
  /** Carried through from the input — see `RosterAgentInput.workingDirectory`. */
  workingDirectory?: string | null
  /**
   * Epoch SECONDS of the newest ARCHIVED transition into the current state — i.e. "in this state
   * since". DERIVED from the daemon's transition archive on every read, NEVER stored
   * (TRDD-X2JGDOSM / ai-maestro#113): a stored `hibernatedAt` would be a second writer of a fact
   * the transition archive already owns, and the two would drift. `null` whenever the surviving
   * archive does not actually record the transition — the archive is pruned to a bounded depth and
   * lags a live change by up to one publish beat, and in both cases the honest answer is "not
   * derivable", never a guess.
   */
  since?: number | null
}

/**
 * A persisted row whose `agentId` matches no live agent. Reported SEPARATELY from the per-agent
 * states because it is not a state any agent is in — it is a row that outlived its agent.
 *
 * WHY IT IS WORTH ITS OWN SECTION. This is the exact class behind the 2026-07-25 incident where
 * three hard-deleted agents kept regrowing `~/agents/<name>/.claude/rules/` after every manual
 * `rm -rf`: a stale `PersistedSession` outlived them and the server kept restoring what the record
 * said should exist. It looked like a haunting and it was an orphan row. 14 of them were present on
 * this host when the probe was written.
 */
export interface OrphanedPersistedSession {
  sessionId: string
  agentId?: string
  name?: string
  reason: string
}

export interface HibernationRoster {
  agents: AgentHibernationRecord[]
  orphanedPersistedSessions: OrphanedPersistedSession[]
  counts: Record<HibernationState, number> & { orphaned: number }
}

/**
 * PURE roster builder over already-gathered facts. Takes no clock, spawns nothing and reads no file,
 * so the whole classification is testable without a registry, a tmux server, or a repointed `$HOME`
 * — which matters because `lib/session-persistence.ts` resolves its state dir at MODULE LOAD, so a
 * test that repoints `$HOME` after import would otherwise read the developer's real `~/.aimaestro`.
 */
export function buildHibernationRoster(input: RosterInput): HibernationRoster {
  const persistedAgentIds = new Set(
    input.persisted.map((p) => p.agentId).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )

  const agents: AgentHibernationRecord[] = input.agents.map((a) => {
    const tmux = input.liveTmuxSessions.has(a.sessionName)
    const persisted = persistedAgentIds.has(a.id)
    const verdict = classifyHibernation({ hasSession: a.hasSession, exists: tmux, isPersisted: persisted })
    return {
      agentId: a.id,
      name: a.name,
      sessionName: a.sessionName,
      workingDirectory: a.workingDirectory ?? null,
      persisted,
      tmux,
      ...verdict,
    }
  })

  const liveAgentIds = new Set(input.agents.map((a) => a.id))
  const orphanedPersistedSessions: OrphanedPersistedSession[] = input.persisted
    // A row with NO agentId is not an orphan — it is a legacy row that predates the link field
    // (`agentId?` is documented as "optional for backward compatibility"). Calling it orphaned
    // would report an unknown as a fault, which is the direction this module exists to avoid.
    .filter((p) => typeof p.agentId === 'string' && p.agentId.length > 0 && !liveAgentIds.has(p.agentId))
    .map((p) => ({
      sessionId: p.id,
      agentId: p.agentId,
      name: p.name,
      reason: 'persisted session references an agent that is not in the live registry',
    }))

  const counts = { running: 0, hibernated: 0, crashed: 0, never_woken: 0, orphaned: orphanedPersistedSessions.length }
  for (const a of agents) counts[a.state] += 1

  return { agents, orphanedPersistedSessions, counts }
}

// ── Derived `since` (TRDD-X2JGDOSM / ai-maestro#113) ──────────────────────────────────────────────
// "How long has this agent been hibernated?" has NO stored answer anywhere (`hibernatedAt` and
// friends: zero hits repo-wide, asserted by tests/governance/no-stored-hibernation-timestamp), and
// must never gain one — the daemon's transition archive already records each real state change as a
// timestamped file, and a second writer of the same fact would drift from it. So `since` is derived
// here, purely, from observations a caller extracted from that archive.

/** One archived observation of one agent's state, at the archive file's envelope timestamp. */
export interface StateObservation {
  /** Epoch SECONDS (the archive envelope's `ts`). */
  ts: number
  state: HibernationState
}

/** One archived full-roster snapshot, already parsed — the shape the INSTALL_ROOT archive holds. */
export interface ArchivedRosterSnapshot {
  /** Epoch SECONDS (the archive envelope's `ts`). */
  ts: number
  agents: Array<{ agentId: string; state: HibernationState }>
}

/**
 * PURE. The epoch-seconds stamp of the newest archived transition INTO `currentState`, or null.
 *
 * Null is deliberate in every ambiguous case — the field's contract is "what the archive RECORDS",
 * never a guess:
 *   · no observations — the agent never appears in the surviving archive;
 *   · the newest observation disagrees with the live state — the archive lags the change by up to
 *     one publish beat, so the transition is not recorded YET;
 *   · every surviving observation already shows `currentState` — the transition itself was pruned
 *     away (the archive keeps a bounded depth) or predates the archive, and "since at least the
 *     oldest surviving file" is a different claim than the field makes.
 */
export function deriveSince(observations: StateObservation[], currentState: HibernationState): number | null {
  const obs = [...observations].sort((a, b) => a.ts - b.ts)
  if (obs.length === 0) return null
  if (obs[obs.length - 1].state !== currentState) return null
  let i = obs.length - 1
  while (i > 0 && obs[i - 1].state === currentState) i--
  if (i === 0) return null
  return obs[i].ts
}

/**
 * PURE decoration: a NEW roster whose agent records carry `since`, derived per agent from the
 * archived snapshots. A snapshot that does not mention an agent contributes no observation for it
 * (an absence is not a state). The input roster is not mutated.
 *
 * NOTE ON CONVERGENCE, for the publisher path: the archived files themselves now carry `since`
 * inside `data`, and the publisher archives on any `data` change — so one real transition archives
 * TWO files (the state change with `since: null`, then the next beat's backfill once the archive
 * records the transition). That second file IS a real data change, the sequence is stable from the
 * third beat on, and the alternative — deriving `since` from a file not yet written — would be a
 * guess. Bounded, honest, deliberate.
 */
export function withDerivedSince(roster: HibernationRoster, snapshots: ArchivedRosterSnapshot[]): HibernationRoster {
  const byAgent = new Map<string, StateObservation[]>()
  for (const snap of snapshots) {
    for (const rec of snap.agents) {
      if (!rec?.agentId) continue
      const list = byAgent.get(rec.agentId)
      if (list) list.push({ ts: snap.ts, state: rec.state })
      else byAgent.set(rec.agentId, [{ ts: snap.ts, state: rec.state }])
    }
  }
  return {
    ...roster,
    agents: roster.agents.map((a) => ({ ...a, since: deriveSince(byAgent.get(a.agentId) ?? [], a.state) })),
  }
}
