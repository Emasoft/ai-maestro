// Fleet-recovery escalation ladder — CHN16JXZ Phase B (PURE logic, no actuation).
//
// This is the server-side mirror of the janitor daemon's RECOVERY_LADDER
// (audit report §2.4 / janitor `lib/session_liveness.py:144-166`). It decides WHICH
// rung to apply for a given diagnosis + attempt count; the ACTUATION of each rung
// (the authenticated #60 injection) is wired separately so this decision layer stays
// pure and testable. Keeping the ladder identical to the janitor's means the server
// recovers a frozen agent exactly as the janitor would have, so behaviour does not
// change when the chore moves from the daemon to the server.
//
// The gentle→hard ordering is load-bearing: we always try the cheapest, least
// disruptive rung first (dismiss a modal, re-arm the heartbeat) and only escalate to
// process-killing rungs after the gentle ones fail. The three HARD rungs are gated
// behind an explicit opt-in (mirrors the janitor's default-OFF FLEET_HARD_RESTART_ENABLED)
// so a misclassification can never kill a live process without the operator's consent.

/** The recovery rungs, gentlest first. Identical order to the janitor's ladder. */
export const RECOVERY_LADDER = [
  'esc_nudge', // dismiss a stuck modal (ESC) + kick a fresh turn
  'rearm', // /janitor-arm — restore the heartbeat cron
  'reload', // /reload-plugins — pick up an update's new hooks
  'update', // ensure the latest plugin version, then nudge again
  'relaunch', // claude --continue in the same pane (resume transcript)   [HARD]
  'force_restart', // external kill of the stuck pid + claude --continue    [HARD]
  'resurrect', // background claude that kills+relaunches the stuck one     [HARD]
] as const

export type RecoveryRung = (typeof RECOVERY_LADDER)[number]

/** The process-disruptive rungs — gated behind an explicit opt-in. */
export const HARD_RUNGS: ReadonlySet<RecoveryRung> = new Set<RecoveryRung>(['relaunch', 'force_restart', 'resurrect'])

export function isHardRung(rung: RecoveryRung): boolean {
  return HARD_RUNGS.has(rung)
}

/** How the server diagnoses a non-healthy agent (server-side names for the janitor's
 *  diagnosis→entry-rung map). */
export type RecoveryDiagnosis =
  | 'frozen' // idle at prompt but stalled — full ladder from the top
  | 'cron_dead' // heartbeat cron gone — start at rearm
  | 'version_mismatch' // running a stale plugin version — start at reload
  | 'dead' // process gone — start at relaunch (a hard rung)

/** Diagnosis → the rung to ENTER the ladder at (janitor `session_liveness.py:204-209`). */
const ENTRY_RUNG: Record<RecoveryDiagnosis, RecoveryRung> = {
  frozen: 'esc_nudge',
  cron_dead: 'rearm',
  version_mismatch: 'reload',
  dead: 'relaunch',
}

/**
 * PURE: the rung to apply for `diagnosis` on attempt `attempt` (0-based), or null when
 * the chosen rung is HARD and hard recovery is not enabled. Escalates one rung per
 * attempt from the diagnosis's entry rung, CLAMPED to the last rung (repeated failures
 * eventually reach the strongest rung, exactly like the janitor's `recovery_action_for`).
 * A negative attempt is treated as 0.
 */
export function recoveryRungFor(
  diagnosis: RecoveryDiagnosis,
  attempt: number,
  hardEnabled: boolean,
): RecoveryRung | null {
  const entryIdx = RECOVERY_LADDER.indexOf(ENTRY_RUNG[diagnosis])
  const step = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0
  const idx = Math.min(entryIdx + step, RECOVERY_LADDER.length - 1)
  const rung = RECOVERY_LADDER[idx]
  if (isHardRung(rung) && !hardEnabled) return null // hard recovery gated off ⇒ stop here
  return rung
}
