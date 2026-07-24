// Claude Code's continuity EVENTS (TRDD-Y8VPE3NS — Flock-E E3; the ai-maestro#90 contract).
//
// Per-client event definitions live in their own module so the registry stays a table and the
// engine stays client-agnostic. E6 mirrors this file per client. Imports from the registry are
// TYPE-ONLY, so there is no runtime import cycle with the table that consumes these events.

import type { ContinuityEvent } from '@/lib/continuity-registry'

/**
 * BYTE-IDENTICAL to the janitor's `is_retry_wedge`. Two independent processes must agree on what
 * a wedge IS — a server that detected one where the janitor did not (or vice-versa) would make
 * the #90 contract untestable across the pair — so this pattern is copied, never "improved".
 * The capture group is the attempt NUMBER, which the false-positive gate below needs.
 *
 * Note it carries no `m`/`s` flag: `.*` does not cross a newline, so "Retrying in …" and
 * "attempt N/300" must be on the SAME rendered line. That is the janitor's behaviour and
 * therefore ours.
 */
export const RETRY_WEDGE_RE = /retrying\s+in\b.*\battempt\s+(\d+)\s*\/\s*\d+/i

/**
 * Extract the retry attempt number from a RENDERED frame, or null when the frame does not show a
 * retry at all. Pure; safe to call twice per poll (the event uses it for both the match and the
 * progress marker rather than duplicating the pattern).
 *
 * Takes the FIRST match on the frame. Known limitation, accepted deliberately: if a document that
 * quotes this pattern (this TRDD, the #90 issue text) is on screen ABOVE a genuine retry, the
 * static line is parsed instead and the real wedge is missed. Missing a wedge costs one stalled
 * turn the ladder still catches; the alternative — scanning for the highest number — lets a
 * static high number mask a live counter permanently. Fail toward under-detection.
 */
export function parseRetryAttempt(frame: string): number | null {
  const m = RETRY_WEDGE_RE.exec(frame)
  if (!m) return null
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Claude's event table.
 *
 * `retry-wedge` — a turn spinning on "Retrying in Ns (attempt N/300)". The response is ONE raw
 * ESC and nothing else: ESC aborts the wedged turn without asserting any intent about what the
 * agent should do next (the abort path then runs on-stop-failure → rate-limited.flag → resume).
 * A command, an Enter, or a Ctrl-C would each put words in the agent's mouth or kill work.
 *
 * WHY this matters beyond the stalled turn: a wedged turn still HOLDS the old credential, so the
 * ESC is a PREREQUISITE for rotation — the OAuth cascade cannot swap a token out from under a
 * turn that will not end.
 *
 * The `progressMarker` is the false-positive gate and is the whole safety of this event — see
 * the engine's `classifyContinuityWithEpisodes`: a first sighting never fires, and a marker that
 * does not ADVANCE never fires. That is what makes a STATIC string naming `attempt N/300` — this
 * TRDD on screen, the #90 issue text, a log tail — incapable of triggering an injection.
 */
export const CLAUDE_CONTINUITY_EVENTS: readonly ContinuityEvent[] = [
  {
    id: 'retry-wedge',
    match: (obs) => parseRetryAttempt(obs.frame) !== null,
    progressMarker: (obs) => parseRetryAttempt(obs.frame),
    response: { kind: 'esc' },
  },
]
