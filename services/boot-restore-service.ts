import { existsSync } from 'fs'
import { loadAgents } from '@/lib/agent-registry'
import { checkAuthorizedAgentWorkdir } from '@/lib/agent-workdir-policy'
import { wakeAgent } from '@/services/agents-core-service'
import { retryTransient } from '@/lib/retry-transient'

// TRDD-WLWHVMKT: the local AGENTS_ROOT const that used to live here was a COPY of the
// same invariant enforced in lib/agent-runtime.ts — and the two drifted, which is the
// whole bug. Workdir authorization now has exactly one home:
// lib/agent-workdir-policy.ts. Do not re-derive it here.

/**
 * Boot restore — relaunch the agents that were active when the host went down.
 *
 * After an unclean shutdown (reboot, power loss) pm2's LaunchAgent brings the
 * AI Maestro server back up, and tmux-continuum recreates empty session shells,
 * but NOTHING relaunches the agent personas (the `claude` / `codex` processes
 * inside their named sessions). This module closes that gap: on startup it
 * re-wakes the set of agents that were running at crash time.
 *
 * Source of truth — the registry's `status: 'active'` set. We deliberately do
 * NOT keep a parallel snapshot file: that would duplicate the registry status
 * field and violate single-source-of-truth.
 *
 * TRDD-YOS36TZI: that field is only trustworthy because every session-state
 * transition now writes it AT THE MOMENT IT HAPPENS — createSession, wakeAgent
 * and hibernateAgent all go through linkSession/unlinkSession. Until then the
 * ONLY writer was a READ path (`GET /api/sessions` → reconcileRegistrySessions),
 * so an agent created on a server nobody was polling — headless mode has no UI at
 * all — stayed `offline` in the registry while its tmux pane ran, and this
 * function restored NOTHING after a restart. If a future change moves a lifecycle
 * transition off those primitives, it silently re-breaks boot-restore: the bug is
 * invisible in the running server and only surfaces on the next restart.
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

// TRDD-JAU1ES1C — transient-failure retry for the per-session wake. A reboot RACES the tmux
// server + pm2 coming back up, so a wakeAgent that THROWS at boot (tmux not ready, transient
// IO) must not permanently drop the agent from the fleet — retry with backoff before recording
// it failed. A governance-gate refusal comes back as a RETURNED `{ error }` (a correct terminal
// skip) and is NEVER retried. This is the boot half of "immortality"; mid-turn-429 and
// network-drop are RUNTIME events handled by the fleet-recovery / account-switcher NPTs
// (TRDD-CHN16JXZ / TRDD-9ZIF82HI), not by boot-restore.
const WAKE_ATTEMPTS = Math.max(1, Number(process.env.AIM_BOOT_RESTORE_WAKE_ATTEMPTS) || 3)
const WAKE_BACKOFF_MS = Number(process.env.AIM_BOOT_RESTORE_WAKE_BACKOFF_MS) || 1000

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

    // Workdir authorization — must agree with what wakeAgent's runtime check will do,
    // or we either skip an agent that would have started fine, or try to restore one
    // that will then throw.
    //
    // TRDD-WLWHVMKT: this used to hard-skip anything outside ~/agents/, on the premise
    // that such an agent could only be a manually-started session the API cannot
    // recreate. That premise stopped being true when external folder adoption shipped
    // (TRDD-57EBNB72): an ADOPTED agent (e.g. a MAINTAINER whose workdir is its real
    // project under ~/Code) is API-created and perfectly restorable — but this gate
    // silently dropped it on every server restart. Both this and the runtime check now
    // ask the single authority, so they cannot disagree again.
    const verdict = checkAuthorizedAgentWorkdir(agent.workingDirectory, name)
    if (!verdict.ok) {
      result.skipped.push({ name, reason: `workdir not authorized: ${verdict.reason}` })
      console.log(`[BootRestore] Skipped ${name}: workdir not authorized — ${verdict.reason}`)
      continue
    }

    // Restore every session index the agent had. Default to [0] for the common
    // single-session case where the registry recorded no session entries.
    const indexes = Array.from(new Set((agent.sessions || []).map(s => s.index)))
    if (indexes.length === 0) indexes.push(0)

    for (const sessionIndex of indexes) {
      const label = `${name}[${sessionIndex}]`
      try {
        const res = await retryTransient(
          () =>
            wakeAgent(agent.id, {
              sessionIndex,
              startProgram: true,
              authContext: { isSystemOwner: true },
            }),
          {
            attempts: WAKE_ATTEMPTS,
            baseDelayMs: WAKE_BACKOFF_MS,
            onRetry: (attempt, err, delay) =>
              console.log(
                `[BootRestore] transient wake failure for ${label} ` +
                  `(attempt ${attempt}/${WAKE_ATTEMPTS}), retrying in ${delay}ms: ` +
                  `${err instanceof Error ? err.message : String(err)}`,
              ),
          },
        )

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
