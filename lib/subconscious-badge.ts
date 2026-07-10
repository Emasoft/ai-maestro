/**
 * The per-agent subconscious badge's state machine (TRDD-WNZ72SFO).
 *
 * This lives outside the component because it used to live INSIDE it, as a chain
 * of inline ternaries, and that is precisely why it was never tested — and why
 * two tautologies survived in it for so long. The badge branched on
 * `isWarmingUp`, which the service hardcoded to `false`, and on `initialized`,
 * which the service hardcoded to `true` until TRDD-YEE33F3A. A component with no
 * test asserts nothing about what it can and cannot say.
 *
 * There are exactly four states and they are totally ordered by precedence. A
 * fetch in flight beats everything (we do not know yet); an error beats a stale
 * status (we know the answer is untrustworthy); otherwise the subconscious is
 * running or it is not.
 *
 * There is deliberately no `warming` state. See `agents-subconscious-service.ts`:
 * the window it would describe is sub-millisecond against a 30s poll, so no user
 * could ever observe it. The GLOBAL `/api/subconscious` has a real `isWarmingUp`
 * — different endpoint, different meaning, and it keeps it.
 */

export type SubconsciousBadgeState = 'loading' | 'error' | 'running' | 'inactive'

export interface SubconsciousBadgeInput {
  loading: boolean
  /** Any error: the fetch failed, or the last message check reported one. */
  hasError: boolean
  isRunning: boolean
}

export function subconsciousBadgeState(input: SubconsciousBadgeInput): SubconsciousBadgeState {
  if (input.loading) return 'loading'
  if (input.hasError) return 'error'
  if (input.isRunning) return 'running'
  return 'inactive'
}

/** Tooltip on the icon button. */
export const SUBCONSCIOUS_BADGE_TITLE: Record<SubconsciousBadgeState, string> = {
  loading: 'Loading...',
  error: 'Subconscious Error',
  running: 'Subconscious Active',
  inactive: 'Subconscious Inactive',
}

/**
 * Label in the popover's Status row. `loading` and `error` never reach it — the
 * popover renders its own loading and error bodies — but the map is total so
 * that adding a state cannot silently fall through to a wrong label.
 */
export const SUBCONSCIOUS_BADGE_LABEL: Record<SubconsciousBadgeState, string> = {
  loading: 'Loading',
  error: 'Error',
  running: 'Running',
  inactive: 'Inactive',
}

export const SUBCONSCIOUS_BADGE_ICON_CLASS: Record<SubconsciousBadgeState, string> = {
  loading: 'text-gray-500 animate-pulse',
  error: 'text-red-400',
  running: 'text-purple-400 animate-pulse',
  inactive: 'text-gray-500',
}

export const SUBCONSCIOUS_BADGE_LABEL_CLASS: Record<SubconsciousBadgeState, string> = {
  loading: 'text-gray-400',
  error: 'text-red-400',
  running: 'text-purple-400',
  inactive: 'text-gray-400',
}
