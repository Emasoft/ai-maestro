// Fleet inbox-nudge — the AMP-delivery leg of the fleet-liveness watchdog (TRDD-7HRDAD0U).
//
// WHY. AMP local delivery is pure-filesystem: a message is written straight into the recipient's
// ~/.agent-messaging/<id>/messages/inbox — the server is never called. An idle agent only checks
// that inbox when its Claude session runs a turn and the plugin's Notification hook
// (idle_prompt | agent_needs_input | SessionStart) fires checkUnreadMessages. But a freshly-
// launched, never-PROMPTED worker sits at its first prompt and NEVER fires idle_prompt — proven
// empirically: both SCEN-031 workers received only SessionStart+SessionEnd over 25 min (their
// hook-debug.log). So a mandate delivered after startup is never noticed, and the fleet organizes
// then stalls at the first handoff. TRDD-YPIRL5RA (press-Enter on the notification) is the
// NECESSARY companion but insufficient alone, because the chain that would fire it never runs.
//
// This tick closes the gap server-side: it periodically finds any agent with unread AMP mail and,
// when the agent is safely idle, injects ONE inbox-check turn. The inject goes through
// sendAgentSessionCommand with requireIdle:true — which 409s if the pane is busy (so it is NEVER
// injected mid-turn) and Enter-submits when idle — under a server-internal system auth context.
// It deliberately does NOT use the command-queue: the queue drains on the idle_prompt hook signal,
// the very signal these workers never fire, so it could never wake them. A directly-gated inject
// is the whole point. Everything is injectable so the tick is unit-tested without a live fleet.

import { listAgents, getAgent } from '@/lib/agent-registry'
import { listInboxMessages } from '@/lib/messageQueue'
import { sendAgentSessionCommand } from '@/services/agents-core-service'
import { buildSystemAuthContext } from '@/lib/agent-auth'
import { readHookNotification } from '@/lib/session-safe-state'
import { fleetActuationBlocked } from '@/lib/janitor-control'

export interface InboxNudgeDeps {
  /** Online-and-not-deleted agents to consider (id, name, workingDirectory for the hook-state read). */
  listAgents: () => Array<{ id: string; name: string; workingDirectory: string | null }>
  /** Count of UNREAD inbox messages for the agent (0 ⇒ nothing to deliver). */
  countUnread: (agentId: string) => Promise<number>
  /** Gated inject. `ok` is true ONLY when a turn was actually submitted; status 409 ⇒ not idle. */
  inject: (agentId: string, prompt: string) => Promise<{ ok: boolean; status: number }>
  /** The 5-state hook notification for a workdir (null when unknown) — used only to skip blocked panes. */
  getHookNotification: (wd: string | null) => { status: string | null; notificationType: string | null } | null
  /** Machine-wide STOP gate (janitor kill-switch / pause). When blocked, nothing is injected. */
  actuationBlocked: () => { blocked: boolean; reason: unknown }
}

/** Per-agent nudge bookkeeping, threaded across ticks (the tick itself is stateless). */
export interface InboxNudgeState {
  lastNudgeMs: number
}

export interface InboxNudgeResult {
  scanned: number
  nudged: Array<{ agentId: string; name: string; unread: number }>
  skipped: Array<{ agentId: string; name: string; reason: string }>
  actuationBlocked: boolean
}

/** Cooldown so an agent that ignores the nudge (or peeks without marking read) is not re-nudged every
 *  tick. Env-overridable; default 5 min ≈ one watchdog interval. */
const NUDGE_COOLDOWN_MS = Number(process.env.AIM_INBOX_NUDGE_COOLDOWN_MS) || 5 * 60 * 1000

/** notificationTypes that mean "blocked, the USER must act" — never inject over one of these. */
const BLOCKED_NOTIFICATION_TYPES = new Set(['permission_prompt', 'elicitation_dialog'])

/** The one-line inbox-check turn injected into an idle agent with unread mail. Single line (it is
 *  sent literally with Enter); benign + idempotent if the agent has in fact already read them. */
export function buildNudgePrompt(unread: number): string {
  const n = unread === 1 ? '1 unread inter-agent message' : `${unread} unread inter-agent messages`
  return `[AMP] You have ${n}. Read your inbox now with the agent-messaging skill (amp-inbox.sh, then amp-read.sh to mark each read) and act on any mandate or request before continuing.`
}

/**
 * One inbox-nudge pass. Never throws (a bad agent is skipped and the pass continues). Returns a
 * summary the watchdog logs. Injects at most one turn per agent per pass, only when the agent is
 * safely idle (requireIdle gate) and not on cooldown.
 */
export async function runInboxNudgeTick(
  deps: InboxNudgeDeps,
  store: Map<string, InboxNudgeState>,
  now: () => number = Date.now,
): Promise<InboxNudgeResult> {
  const result: InboxNudgeResult = { scanned: 0, nudged: [], skipped: [], actuationBlocked: false }

  // Machine-wide STOP (kill-switch / pause) — do not touch any agent.
  if (deps.actuationBlocked().blocked) {
    result.actuationBlocked = true
    return result
  }

  const t = now()
  for (const agent of deps.listAgents()) {
    result.scanned++

    let unread = 0
    try {
      unread = await deps.countUnread(agent.id)
    } catch (err) {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: `countUnread error: ${(err as Error)?.message || err}` })
      continue
    }
    if (unread <= 0) continue

    // A permission/elicitation prompt is the USER's to answer — never inject over it (belt-and-braces
    // beyond the requireIdle activity-timestamp gate, which cannot see a blocked-on-user pane).
    const hook = deps.getHookNotification(agent.workingDirectory)
    if (hook?.notificationType && BLOCKED_NOTIFICATION_TYPES.has(hook.notificationType)) {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: `blocked: ${hook.notificationType}` })
      continue
    }

    // Cooldown — don't re-nudge an agent we nudged within the window.
    const prev = store.get(agent.id)
    if (prev && t - prev.lastNudgeMs < NUDGE_COOLDOWN_MS) {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: 'cooldown' })
      continue
    }

    // Gated inject. requireIdle inside sendAgentSessionCommand 409s a busy pane, so a mid-turn agent
    // is skipped WITHOUT setting the cooldown → retried next tick. Only a submitted turn (ok) sets it.
    let injected: { ok: boolean; status: number }
    try {
      injected = await deps.inject(agent.id, buildNudgePrompt(unread))
    } catch (err) {
      result.skipped.push({ agentId: agent.id, name: agent.name, reason: `inject error: ${(err as Error)?.message || err}` })
      continue
    }
    if (injected.ok) {
      store.set(agent.id, { lastNudgeMs: t })
      result.nudged.push({ agentId: agent.id, name: agent.name, unread })
    } else {
      result.skipped.push({
        agentId: agent.id,
        name: agent.name,
        reason: injected.status === 409 ? 'not idle' : `inject status ${injected.status}`,
      })
    }
  }

  return result
}

/** Wire the tick to the real substrate. Injection uses a server-internal system auth context, so it
 *  is never an agent-to-agent drive (R42-safe), mirroring the fleet-recovery actuator. */
export function defaultInboxNudgeDeps(): InboxNudgeDeps {
  return {
    // ONLINE sessions only, matching this dep's documented contract (and the sibling
    // fleet-continuity wiring). A hibernated agent has no pane to type into, so every tick would
    // spend a registry read plus a failed sendAgentSessionCommand (a tmux sessionExists exec) on it
    // — and because the cooldown is only set on a SUCCESSFUL inject, it would retry forever.
    listAgents: () =>
      listAgents(false)
        .filter((s) => s.sessions?.some((x) => x.status === 'online'))
        .map((s) => {
          const full = getAgent(s.id)
          const wd = full?.workingDirectory ?? s.sessions?.find((x) => x.index === 0)?.workingDirectory ?? null
          return { id: s.id, name: s.name, workingDirectory: wd }
        }),
    countUnread: async (agentId) => (await listInboxMessages(agentId, { status: 'unread' })).length,
    inject: async (agentId, prompt) => {
      const auth = buildSystemAuthContext('fleet-inbox-nudge')
      const r = await sendAgentSessionCommand(agentId, { command: prompt, requireIdle: true, addNewline: true }, auth)
      return { ok: !!r.data?.success, status: r.status }
    },
    getHookNotification: (wd) => readHookNotification(wd),
    actuationBlocked: () => fleetActuationBlocked(),
  }
}
