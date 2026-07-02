import fs from 'fs'
import { loadAgents } from '@/lib/agent-registry'
import { loadPersistedSessions, savePersistedSessions, type PersistedSession } from '@/lib/session-persistence'
import { computeSessionName } from '@/types/agent'

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
