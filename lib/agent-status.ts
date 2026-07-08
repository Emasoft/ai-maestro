import type { SessionActivityStatus } from '@/hooks/useSessionActivity'

/**
 * Resolve the visual status indicator for an agent.
 *
 * Priority model (matching CLAUDE.md "Session Control Architecture", extended
 * with the two API-class states from TRDD-TBGGUA2V P3):
 *   1. Exited (gray, no pulse) — programRunning === false
 *   2. Rate limited (purple, pulse) — notificationType 'rate_limited' (throttled,
 *      auto-resumes once the quota window clears; from the hook's StopFailure)
 *   3. API error (red, pulse) — notificationType 'api_error' (auth/billing/5xx;
 *      the turn died but the process is alive — needs attention)
 *   4. Permission (orange, pulse) — permission_prompt
 *   5. Waiting (amber, pulse) — idle_prompt or 'waiting' activity
 *   6. Active (green, pulse) — terminal actively producing output
 *   7. Idle (green, no pulse) — online but no specific signal yet
 *
 * The two API-class states rank above permission/idle because they are the most
 * recent + most actionable signal (the hook fully rewrites state per event, so a
 * 'rate_limited'/'api_error' notificationType means the last event WAS the
 * StopFailure; it self-clears on the agent's next turn).
 *
 * The optional `icon` field is a SEMANTIC hint ('lock' | 'clock' | 'alert') for
 * the states that warrant a glyph next to the dot; callers map it to a concrete
 * icon component (this module stays free of any UI/lucide import). Absent for the
 * plain-dot states.
 *
 * Single source of truth for the status ladder — shared by AgentBadge (sidebar
 * cards), AgentStatusIndicator (sidebar list rows) and TaskKanbanBoard (kanban
 * card avatars) so the priority logic is never re-implemented per consumer.
 */
export function resolveAgentStatus(
  isOnline: boolean,
  isHibernated: boolean,
  activityStatus?: SessionActivityStatus,
  notificationType?: string,
  programRunning?: boolean,
  subagentCount?: number,
): { color: string; ringColor: string; label: string; pulse: boolean; icon?: 'lock' | 'clock' | 'alert' } {

  if (isOnline) {
    // Priority 1: Program exited — tmux session alive but the AI program stopped.
    if (programRunning === false) {
      return { color: 'bg-gray-400', ringColor: 'ring-gray-400/30', label: 'Exited', pulse: false }
    }
    // Priority 2: Rate limited — the last turn died throttled/overloaded. Distinct
    // from a hard error: it auto-resumes when the quota window clears. (Set by the
    // hook's classifyStopFailure on a StopFailure event — TRDD-TBGGUA2V P3.)
    // icon:'clock' — conveys "throttled, time-windowed" so the purple dot is not
    // mistaken for any other state at a glance (mirrors the Permission lock pattern).
    if (notificationType === 'rate_limited') {
      return { color: 'bg-purple-500', ringColor: 'ring-purple-500/30', label: 'Rate limited', pulse: true, icon: 'clock' }
    }
    // Priority 3: API error — the last turn died with an API-class failure
    // (auth/billing/5xx). The process is alive but stuck and needs attention.
    if (notificationType === 'api_error') {
      return { color: 'bg-red-600', ringColor: 'ring-red-600/30', label: 'API error', pulse: true, icon: 'alert' }
    }
    // Priority 4: Permission prompt — Claude is blocked asking for tool approval.
    if (notificationType === 'permission_prompt') {
      return { color: 'bg-orange-500', ringColor: 'ring-orange-500/30', label: 'Permission', pulse: true, icon: 'lock' }
    }
    // Priority 5: Waiting — Claude finished and shows its input prompt.
    // TRDD-O8NCNRWO: since CC 2.1.198 subagents run in the background by
    // default, so an idle prompt with a provably-positive subagent counter is
    // NOT the safe state — label it distinctly so Stop/Restart affordances and
    // the human don't mistake it for "nothing running". Same amber family
    // (still a waiting flavor), clock icon = "work still in flight".
    if (notificationType === 'idle_prompt' || activityStatus === 'waiting') {
      if (typeof subagentCount === 'number' && subagentCount > 0) {
        return { color: 'bg-amber-600', ringColor: 'ring-amber-600/30', label: `Waiting (${subagentCount} subagent${subagentCount === 1 ? '' : 's'})`, pulse: true, icon: 'clock' }
      }
      return { color: 'bg-amber-500', ringColor: 'ring-amber-500/30', label: 'Waiting', pulse: true }
    }
    // Priority 6: Active — Claude is currently processing.
    if (activityStatus === 'active') {
      return { color: 'bg-green-500', ringColor: 'ring-green-500/30', label: 'Active', pulse: true }
    }
    // Priority 7: Idle — online but no specific activity signal yet.
    return { color: 'bg-green-500', ringColor: 'ring-green-500/30', label: 'Idle', pulse: false }
  }

  if (isHibernated) {
    return { color: 'bg-slate-500', ringColor: 'ring-slate-500/30', label: 'Hibernated', pulse: false }
  }

  return { color: 'bg-gray-500', ringColor: 'ring-gray-500/30', label: 'Offline', pulse: false }
}
