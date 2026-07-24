// Per-client continuity EVENT REGISTRY (TRDD-X8801GT4 — Flock-E E2).
//
// The terminal-continuity automaton must recognise a handful of BLOCKING screen states across
// several CLI clients (claude, codex, kimi, opencode, …) and answer each with one fixed,
// pre-declared response. This module is the DATA half: a table keyed on the agent's `program`,
// where each entry lists the events that client can present. The ENGINE — the gates and the one
// injection — stays in `fleet-recovery-actuator.ts`, so the whole fleet has exactly ONE injector.
//
// WHY a registry and not engine code: every new client would otherwise add a branch to the
// actuator, and every branch is a place a wedge-detector can fire on the WRONG client (a codex
// screen matched by a claude pattern is a keystroke injected into a healthy agent). Adding a
// client here is a data entry; the engine never changes. Aligns with task #57.
//
// WHY the response is a CLOSED UNION and never free text: the injection surface is
// injection-proof BY CONSTRUCTION (`lib/agent-commands.ts` — the caller supplies a KEY, never
// command text). A continuity response is therefore either the fixed ESC control byte or a
// CURATED command key. A registry entry cannot introduce new command text even by mistake.
//
// FAIL-OPEN (R16 posture): an unknown program, a matcher that throws, or an empty event list all
// resolve to "no event" — never to a spurious injection. A false detection drives a keystroke
// into a healthy agent, so silence is the safe failure.

/** The fixed ESC control byte. Exported so an injector never has to spell it — the `esc`
 *  response carries no payload precisely so no caller can substitute other keystrokes. */
export const ESC_KEYSTROKE = '\x1b'

/**
 * What the automaton observed about ONE agent at ONE poll. `frame` is the RENDERED grid from
 * `lib/agent-frame-reader` (what a human would SEE) — never the raw PTY byte stream, which is
 * redraw noise no regex parses reliably. `notification` is the hook's 5-state signal
 * (`readHookNotification`), so an event can match on screen text, on hook state, or on both.
 */
export interface ContinuityObservation {
  /** The agent's client program — the registry key. A path is accepted (basename is taken). */
  program: string | null | undefined
  /** The rendered visible frame ('' when the reader could not read one — fail-open). */
  frame: string
  /** 'alternate' while the client is in its full-screen TUI, 'normal' at a shell prompt. */
  bufferType: 'normal' | 'alternate' | null
  /** The hook's activity signal, or null when unknown/unreadable. */
  notification: { status: string | null; notificationType: string | null } | null
}

/**
 * The fixed answer an event declares. A CLOSED union by design (see the header):
 *  - `esc`     — one raw ESC. Dismisses a modal / aborts a wedged turn without asserting intent.
 *  - `command` — a CURATED key from `lib/agent-commands.ts`; the actuator refuses an unknown one.
 * Other shapes (e.g. E4's ESC-flood-then-directive) are added by the TRDD that also teaches the
 * actuator to PERFORM them — a response kind the injector cannot execute would be a lie in the type.
 */
export type ContinuityResponse = { kind: 'esc' } | { kind: 'command'; commandKey: string }

/** One recognisable screen state and its fixed answer. `match` must be PURE and cheap: it runs
 *  per agent per poll, and a throwing matcher is caught and treated as "no match" (fail-open). */
export interface ContinuityEvent {
  /** Stable id, reported in the decision and used for logging/tests (e.g. 'retry-wedge'). */
  id: string
  match: (obs: ContinuityObservation) => boolean
  response: ContinuityResponse
}

/** One CLI client's event table. Events are tried IN ORDER — the first match wins, so list the
 *  most specific first. */
export interface ContinuityClientEntry {
  /** Canonical program name (lowercase, no path), e.g. 'claude'. */
  program: string
  /** Other names the same client is registered under (matched after normalisation). */
  aliases?: readonly string[]
  events: readonly ContinuityEvent[]
}

/**
 * THE registry. Entries are populated by the per-event TRDDs — E3 (retry-wedge), E4
 * (AskUserQuestion), E5 (idle-with-inbox), E6 (non-Claude clients). A client listed with no
 * events is KNOWN but currently has nothing to detect: it classifies to null exactly like an
 * unknown one, and adding its first event is a one-entry push rather than an engine change.
 */
export const CONTINUITY_REGISTRY: readonly ContinuityClientEntry[] = [
  { program: 'claude', aliases: ['claude-code'], events: [] },
]

/** Normalise a program to its registry key: basename, trimmed, lowercased. An agent's stored
 *  `program` may be a bare name ('claude') or a path ('/usr/local/bin/claude'); both must key
 *  the same entry, otherwise a correctly-registered client silently gets no events. */
export function normalizeProgram(program: string | null | undefined): string | null {
  if (typeof program !== 'string') return null
  const base = program.trim().split('/').pop()
  if (!base) return null
  const key = base.toLowerCase()
  return key === '' ? null : key
}

/** Find the entry for a program, or null when the client is not registered. */
export function findClientEntry(
  program: string | null | undefined,
  registry: readonly ContinuityClientEntry[] = CONTINUITY_REGISTRY,
): ContinuityClientEntry | null {
  const key = normalizeProgram(program)
  if (key === null) return null
  for (const entry of registry) {
    if (normalizeProgram(entry.program) === key) return entry
    if (entry.aliases?.some((a) => normalizeProgram(a) === key)) return entry
  }
  return null
}

/** A classified observation: which client, which event, and the answer it declares. */
export interface ContinuityClassification {
  program: string
  eventId: string
  response: ContinuityResponse
}

/**
 * Classify ONE observation against the registry. Returns the first matching event's
 * classification, or null when the program is unknown, has no events, or nothing matched.
 *
 * FAIL-OPEN: a matcher that throws is treated as "did not match" and the scan continues — one
 * bad regex in one client's entry must never break detection for every other client, and it must
 * never be read as a positive.
 */
export function classifyContinuity(
  obs: ContinuityObservation,
  registry: readonly ContinuityClientEntry[] = CONTINUITY_REGISTRY,
): ContinuityClassification | null {
  const entry = findClientEntry(obs.program, registry)
  if (!entry) return null
  for (const event of entry.events) {
    let matched = false
    try {
      matched = event.match(obs) === true
    } catch {
      matched = false // fail-open — a broken matcher is never a detection
    }
    if (matched) return { program: entry.program, eventId: event.id, response: event.response }
  }
  return null
}

/** Every curated command key any registered response names. A test pins these to real
 *  `lib/agent-commands.ts` entries so a typo fails loudly at build time rather than silently
 *  refusing to actuate the first time the event ever fires in production. */
export function continuityCommandKeys(
  registry: readonly ContinuityClientEntry[] = CONTINUITY_REGISTRY,
): string[] {
  const keys: string[] = []
  for (const entry of registry) {
    for (const event of entry.events) {
      if (event.response.kind === 'command') keys.push(event.response.commandKey)
    }
  }
  return keys
}
