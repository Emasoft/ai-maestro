import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, resolve, sep } from 'path'
import { loadAgents } from '@/lib/agent-registry'
import { wakeAgent } from '@/services/agents-core-service'

/** ~/agents — the only root an agent workdir may live under (mirrors validateCwd in lib/agent-runtime.ts). */
const AGENTS_ROOT = join(homedir(), 'agents')

/**
 * Boot restore — relaunch the agents that were active when the host went down.
 *
 * After an unclean shutdown (reboot, power loss) pm2's LaunchAgent brings the
 * AI Maestro server back up, and tmux-continuum recreates empty session shells,
 * but NOTHING relaunches the agent personas (the `claude` / `codex` processes
 * inside their named sessions). This module closes that gap: on startup it
 * re-wakes the set of agents that were running at crash time.
 *
 * Source of truth — the registry's frozen `status: 'active'` set.
 * `GET /api/agents` reconciles live tmux against the registry, but that
 * reconciliation is RESPONSE-ONLY (services/agents-core-service.ts builds a
 * result array and returns it; it never calls saveAgents). So after a reboot
 * `registry.json` still records exactly which agents were `active` when the
 * host died — discovery cannot have overwritten it. We deliberately do NOT
 * keep a parallel snapshot file: that would duplicate the registry status
 * field and violate single-source-of-truth.
 *
 * `wakeAgent` is invoked server-internally with `authContext: { isSystemOwner:
 * true }`, which skips Gate 0 (RBAC — there is no human caller at boot) but
 * still runs Gate 1 (manager gate) and the R17 core-plugin gate. A team agent
 * whose team has no MANAGER therefore refuses to wake — that is the correct
 * governance outcome, not a bug, and is recorded as a skip.
 *
 * Disable entirely with AIM_DISABLE_BOOT_RESTORE=1.
 * Tune the inter-launch delay with AIM_BOOT_RESTORE_STAGGER_MS (default 1500).
 */

/** Delay between successive wakes so we don't spawn N clients at once. */
const STAGGER_MS = Number(process.env.AIM_BOOT_RESTORE_STAGGER_MS) || 1500

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export interface BootRestoreResult {
  /** false when AIM_DISABLE_BOOT_RESTORE=1 — no restore was attempted */
  enabled: boolean
  /** `name[index]` of each session relaunched */
  restored: string[]
  /** `name[index]` of each session already running (idempotent no-op) */
  alreadyRunning: string[]
  /** sessions a governance gate refused to wake (e.g. team agent, no MANAGER) */
  skipped: Array<{ name: string; reason: string }>
  /** sessions that threw an unexpected error during wake */
  failed: Array<{ name: string; reason: string }>
}

export async function restoreActiveAgentsOnBoot(): Promise<BootRestoreResult> {
  const result: BootRestoreResult = {
    enabled: true,
    restored: [],
    alreadyRunning: [],
    skipped: [],
    failed: [],
  }

  if (process.env.AIM_DISABLE_BOOT_RESTORE === '1') {
    result.enabled = false
    console.log('[BootRestore] Disabled via AIM_DISABLE_BOOT_RESTORE=1 — skipping agent restore')
    return result
  }

  // Raw on-disk read (no discovery merge) — the status field is the last
  // persisted lifecycle state before the host went down.
  //
  // We deliberately do NOT filter by hostId. registry.json is local-only by
  // design (remote/peer agents live in the separate agent-directory store), so
  // every entry here belongs to this host. An entry's hostId can also be a
  // STALE value from a machine rename (e.g. an agent created while this Mac was
  // "mac.lan", now "mac-mini-di-emanuele"), so a strict `hostId === self` filter
  // would wrongly drop genuinely-local agents. status + !deletedAt is the
  // correct, sufficient selector; wakeAgent always creates a LOCAL session.
  const activeAgents = loadAgents().filter(a => a.status === 'active' && !a.deletedAt)

  if (activeAgents.length === 0) {
    console.log('[BootRestore] No agents were active before shutdown — nothing to restore')
    return result
  }

  console.log(`[BootRestore] Restoring ${activeAgents.length} agent(s) that were active before shutdown`)

  for (const agent of activeAgents) {
    const name = agent.name || agent.id

    // Path validation — never wake an agent whose working directory was deleted.
    // wakeAgent's shell guard FAIL-OPENS when $AGENT_WORK_DIR doesn't resolve, so
    // spawning there would create an UNGUARDED session in a dead dir. Skip + record.
    if (!agent.workingDirectory || !existsSync(agent.workingDirectory)) {
      result.skipped.push({ name, reason: `workingDirectory missing: ${agent.workingDirectory || '(none)'}` })
      console.log(`[BootRestore] Skipped ${name}: workingDirectory missing (${agent.workingDirectory || 'none'})`)
      continue
    }

    // ~/agents/ invariant — wakeAgent's validateCwd (agent-runtime.ts) REFUSES any
    // workdir outside ~/agents/ (the R0 "every agent lives in ~/agents/" rule). An
    // active agent here whose workdir is elsewhere (e.g. ~/Code/<proj>) was a
    // MANUALLY-started tmux session AI Maestro discovered+linked, NOT an API-created
    // agent — the API cannot recreate it. Skip with a clear reason rather than letting
    // wakeAgent fail with the opaque "Failed to create tmux session".
    const resolvedWd = resolve(agent.workingDirectory)
    if (resolvedWd !== AGENTS_ROOT && !resolvedWd.startsWith(AGENTS_ROOT + sep)) {
      result.skipped.push({ name, reason: `workdir outside ~/agents/ (manually-managed; migrate to ~/agents/ to enable auto-restore): ${agent.workingDirectory}` })
      console.log(`[BootRestore] Skipped ${name}: workdir outside ~/agents/ (${agent.workingDirectory})`)
      continue
    }

    // Restore every session index the agent had. Default to [0] for the common
    // single-session case where the registry recorded no session entries.
    const indexes = Array.from(new Set((agent.sessions || []).map(s => s.index)))
    if (indexes.length === 0) indexes.push(0)

    for (const sessionIndex of indexes) {
      const label = `${name}[${sessionIndex}]`
      try {
        const res = await wakeAgent(agent.id, {
          sessionIndex,
          startProgram: true,
          authContext: { isSystemOwner: true },
        })

        if (res.error) {
          // Gate refusal (e.g. R10.5 manager gate, R17 core-plugin gate).
          result.skipped.push({ name: label, reason: res.error })
          console.log(`[BootRestore] Skipped ${label}: ${res.error}`)
        } else if (res.data?.alreadyRunning) {
          result.alreadyRunning.push(label)
        } else {
          result.restored.push(label)
          console.log(`[BootRestore] Restored ${label}`)
        }
      } catch (err) {
        // One agent's failure must never abort the rest of the batch.
        const reason = err instanceof Error ? err.message : String(err)
        result.failed.push({ name: label, reason })
        console.error(`[BootRestore] Failed ${label}: ${reason}`)
      }

      await sleep(STAGGER_MS)
    }
  }

  console.log(
    `[BootRestore] Done — restored ${result.restored.length}, ` +
    `already running ${result.alreadyRunning.length}, ` +
    `skipped ${result.skipped.length}, failed ${result.failed.length}`,
  )
  return result
}
