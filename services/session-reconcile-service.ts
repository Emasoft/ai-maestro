import fs from 'fs'
import { loadAgents } from '@/lib/agent-registry'
import { loadPersistedSessions, savePersistedSessions, type PersistedSession } from '@/lib/session-persistence'
import { computeSessionName } from '@/types/agent'
import { getRuntime } from '@/lib/agent-runtime'
import { getPaneCommand, wakeAgent } from '@/services/agents-core-service'

/**
 * Bootstrap `~/.aimaestro/sessions.json` from the registry IF it is missing/empty.
 *
 * sessions.json is the operational record of sessions the server started
 * (written on wake/createSession, removed on hibernate). If the file is ever
 * deleted, the server loses that record. This rebuilds it from the registry —
 * the source of truth — so the record is never simply absent.
 *
 * NON-DESTRUCTIVE (governance: agents/sessions are never hard-deleted): if the
 * file already has ANY entries it is left completely untouched. We never prune
 * or rewrite existing entries — a stale entry is surfaced by the existing
 * orphan / unregistered-session path, not pruned here. We only synthesize when
 * `loadPersistedSessions()` comes back empty (missing, empty, or unreadable).
 *
 * Each synthesized entry's `workingDirectory` is validated to still exist on
 * disk; an agent whose dir was deleted is skipped (no entry written).
 */
export function ensureSessionsJsonBootstrapped(): { bootstrapped: boolean; written: number; skipped: number } {
  // If the file already has entries, do NOT touch it (non-destructive).
  if (loadPersistedSessions().length > 0) {
    return { bootstrapped: false, written: 0, skipped: 0 }
  }

  const now = new Date().toISOString()
  const synthesized: PersistedSession[] = []
  let skipped = 0

  for (const agent of loadAgents()) {
    if (agent.deletedAt) continue // skip soft-deleted (tombstone) agents
    const workdir = agent.workingDirectory
    if (!workdir || !fs.existsSync(workdir)) {
      skipped++
      continue
    }

    // One entry per session index the agent had; default to [0] for the common
    // single-session case where the registry recorded no session entries.
    const indexes = Array.from(new Set((agent.sessions || []).map(s => s.index)))
    if (indexes.length === 0) indexes.push(0)

    for (const index of indexes) {
      const sessionName = computeSessionName(agent.name || agent.id, index)
      synthesized.push({
        id: sessionName,
        name: sessionName,
        workingDirectory: workdir,
        createdAt: agent.createdAt || now,
        lastSavedAt: now,
        agentId: agent.id,
      })
    }
  }

  savePersistedSessions(synthesized)
  console.log(
    `[SessionReconcile] sessions.json was missing — bootstrapped ${synthesized.length} entry(ies) ` +
    `from registry (${skipped} skipped: workdir gone)`,
  )
  return { bootstrapped: true, written: synthesized.length, skipped }
}

/**
 * TRDD-13MZ7EFO (part 2/2 — reconcile on startup): after a `pm2 restart` (or
 * any server bounce) a tmux pane can survive while the Claude process inside
 * it does not -- the pane sits at a bare shell prompt. If left alone, the
 * next `wakeAgent` call short-circuits on `runtime.sessionExists()` being
 * true and never reaches the R17 wake-gate (the ONLY path that reinstalls a
 * missing core plugin -- agents-core-service.ts wakeAgent ~1895-1978),
 * because it assumes an existing session means Claude is already running.
 *
 * We kill (not reuse) any registered agent's pane that exists but is not
 * running its program, so the next wake creates a fresh, R17-gated session.
 * Killing is preferred over reusing here specifically because a fresh
 * session is the only way to force the gate to re-run.
 *
 * TRDD-FM2ERCE6: after the kill, an agent the registry still lists as `active`
 * is relaunched through `wakeAgent` (the one launch path -- it re-applies the
 * manager / roleMissing / frozen-team / R17 gates, so a hibernated, quarantined
 * or precondition-less agent is refused there, not relaunched here).
 */
// ponytail: relaunch at most ONCE per agent per server process -- a second orphan of the same
// agent means the client crash-loops on start, so we only kill it (old behaviour) rather than
// loop. Upgrade path: a persisted attempt counter + `client-failed` status if a per-boot cap
// proves too loose.
const relaunchedOnce = new Set<string>()
// A boot must not start a whole fleet of clients at once (cost, rate limits): beyond this many
// relaunches in one sweep the remaining orphans are only killed, as before, and wait for a manual wake.
const MAX_RELAUNCHES_PER_SWEEP = 5

export async function reconcileOrphanPanesOnBoot(): Promise<{ checked: number; killed: number; relaunched: number }> {
  const runtime = getRuntime()
  let checked = 0
  let killed = 0
  let relaunched = 0
  let attempts = 0

  for (const agent of loadAgents()) {
    if (agent.deletedAt) continue // skip soft-deleted (tombstone) agents
    const sessionName = agent.name
    if (!sessionName) continue

    let exists: boolean
    try {
      exists = await runtime.sessionExists(sessionName)
    } catch {
      continue // tmux unavailable / transient error -- skip, don't misreport
    }
    if (!exists) continue
    checked++

    const { programRunning } = getPaneCommand(sessionName)
    if (programRunning) continue // Claude (or another program) is alive -- leave it

    try {
      await runtime.killSession(sessionName)
      killed++
      console.log(
        `[SessionReconcile] Killed orphan shell-only pane for "${sessionName}" ` +
        `(no program running) -- next wake will re-run the R17 gate`,
      )
    } catch (err) {
      console.error(
        `[SessionReconcile] Failed to kill orphan pane for "${sessionName}":`,
        err instanceof Error ? err.message : err,
      )
      continue // pane still there -- wakeAgent would only report alreadyRunning
    }

    // The cap counts ATTEMPTS, not successes: a wake that errors may still have started a client.
    if (agent.status !== 'active' || relaunchedOnce.has(agent.id) || attempts >= MAX_RELAUNCHES_PER_SWEEP) continue
    relaunchedOnce.add(agent.id)
    attempts++
    try {
      const res = await wakeAgent(agent.id, { authContext: { isSystemOwner: true } })
      if ('error' in res) {
        console.log(`[SessionReconcile] Not relaunching "${sessionName}": ${res.error}`)
      } else {
        relaunched++
        console.log(`[SessionReconcile] Relaunched client for "${sessionName}" via wakeAgent`)
      }
    } catch (err) {
      console.error(
        `[SessionReconcile] Relaunch of "${sessionName}" threw:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  if (checked > 0) {
    console.log(`[SessionReconcile] Orphan pane sweep: checked ${checked} live session(s), killed ${killed} shell-only orphan(s), relaunched ${relaunched}`)
  }
  return { checked, killed, relaunched }
}
