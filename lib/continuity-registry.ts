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

import { CLAUDE_CONTINUITY_EVENTS } from '@/lib/continuity-events-claude'

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
 *  - `esc-then-command` — E4's ESC-flood-then-directive (TRDD-U6AS2YWB): bounded ESCs until the
 *    menu leaves the frame, then a CURATED key. Landed together with its injector support —
 *    a response kind the injector cannot execute would be a lie in the type.
 */
export type ContinuityResponse =
  | { kind: 'esc' }
  | { kind: 'command'; commandKey: string }
  // TRDD-U6AS2YWB (E4): dismiss a blocking modal MENU with repeated ESC — re-checking the frame
  // between keystrokes and stopping the moment the menu is gone — then type ONE curated command.
  // `maxEsc` bounds the flood (a menu that survives maxEsc ESCs aborts the whole response, and
  // the curated command is NOT sent — half an actuation into an unknown screen is worse than
  // none). `commandKey` is a curated key exactly as in `command`; the same allowlist gate
  // applies. Added together with the actuator/injector support, per this union's own contract
  // that a kind the injector cannot perform is a lie in the type.
  | { kind: 'esc-then-command'; commandKey: string; maxEsc: number }

/** One recognisable screen state and its fixed answer. `match` must be PURE and cheap: it runs
 *  per agent per poll, and a throwing matcher is caught and treated as "no match" (fail-open). */
export interface ContinuityEvent {
  /** Stable id, reported in the decision and used for logging/tests (e.g. 'retry-wedge'). */
  id: string
  match: (obs: ContinuityObservation) => boolean
  /**
   * OPTIONAL false-positive gate for states that are only real when they are MOVING
   * (TRDD-Y8VPE3NS). Extract a monotonic progress number from the observation — a retry attempt
   * counter, a step index — and the event fires ONLY when that number ADVANCED since the previous
   * poll. A first sighting and a tie never fire.
   *
   * WHY: `match` sees ONE poll, so it cannot tell a live wedge from a STATIC string that merely
   * contains the same words — a document, an issue body, a log tail on screen. Without this gate
   * a agent reading its own spec would be injected into. Keep it pure; a throwing marker is
   * treated as absent, and an absent marker CLEARS the episode (the state went away).
   */
  progressMarker?: (obs: ContinuityObservation) => number | null
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
 * THE registry. Per-client event tables live in their own modules (`continuity-events-<client>.ts`)
 * and are assembled here, so adding a client is one import plus one row — never engine code.
 * Remaining events are added by their own TRDDs: E4 (AskUserQuestion), E5 (idle-with-inbox),
 * E6 (non-Claude clients). A client listed with no events is KNOWN but has nothing to detect yet:
 * it classifies to null exactly like an unknown one.
 */
export const CONTINUITY_REGISTRY: readonly ContinuityClientEntry[] = [
  { program: 'claude', aliases: ['claude-code'], events: CLAUDE_CONTINUITY_EVENTS },
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
 * Per-agent episode memory: the last progress marker seen for each temporal event, keyed by
 * event id. The CALLER owns the store (the actuator's `episodes` dep) — this module stays pure.
 * An event whose state vanished is simply absent from the next map, which is how "cleared" is
 * represented; there is no tombstone to leak.
 */
export type ContinuityEpisodes = Record<string, number>

/**
 * Classify ONE observation, carrying the per-agent episode memory that temporal events need.
 *
 * Returns the first matching event plus the episodes to remember for the NEXT poll. The episode
 * map is rebuilt on every call and covers EVERY temporal event of the client, whether or not it
 * fired — an event that only recorded its marker when it fired could never establish a previous
 * value, so it could never observe an advance, so it would never fire at all.
 *
 * THE FALSE-POSITIVE GATE: an event declaring `progressMarker` fires only when the marker is
 * present AND strictly greater than the remembered one. A first sighting cannot fire (nothing to
 * advance from) and a tie cannot fire (the screen is not moving). That is precisely what makes a
 * STATIC on-screen string incapable of triggering an injection, no matter how many polls it
 * survives.
 *
 * FAIL-OPEN throughout: a matcher or marker that throws is treated as absent, never as a
 * detection — one bad pattern in one client's table must not break the others, and must never
 * drive a keystroke into a healthy agent.
 */
export function classifyContinuityWithEpisodes(
  obs: ContinuityObservation,
  previous: Readonly<ContinuityEpisodes> = {},
  registry: readonly ContinuityClientEntry[] = CONTINUITY_REGISTRY,
): { hit: ContinuityClassification | null; episodes: ContinuityEpisodes } {
  const episodes: ContinuityEpisodes = {}
  const entry = findClientEntry(obs.program, registry)
  if (!entry) return { hit: null, episodes }

  let hit: ContinuityClassification | null = null
  for (const event of entry.events) {
    // Record the marker FIRST, for every temporal event, even once something has already matched:
    // the store must stay current or a later poll's "advance" is measured against a stale value.
    let marker: number | null = null
    if (event.progressMarker) {
      try {
        marker = event.progressMarker(obs)
      } catch {
        marker = null
      }
      if (typeof marker !== 'number' || !Number.isFinite(marker)) marker = null
      if (marker !== null) episodes[event.id] = marker
      // marker === null ⇒ the state vanished ⇒ the key stays absent ⇒ the episode is cleared.
    }

    if (hit !== null) continue // first match wins; keep looping only to keep episodes current

    let matched = false
    try {
      matched = event.match(obs) === true
    } catch {
      matched = false // fail-open — a broken matcher is never a detection
    }
    if (!matched) continue

    if (event.progressMarker) {
      const prev = previous[event.id]
      if (marker === null || typeof prev !== 'number' || marker <= prev) continue // no advance ⇒ no fire
    }

    hit = { program: entry.program, eventId: event.id, response: event.response }
  }
  return { hit, episodes }
}

/**
 * Stateless classification — the convenience entry point for callers with no episode store.
 *
 * SAFE BY DEFAULT: with no remembered episodes, a temporal event can never observe an advance,
 * so it never fires here. A caller that needs the retry-wedge class of event must carry the
 * store and use `classifyContinuityWithEpisodes`; forgetting to do so under-detects, which is
 * the failure direction we want.
 */
export function classifyContinuity(
  obs: ContinuityObservation,
  registry: readonly ContinuityClientEntry[] = CONTINUITY_REGISTRY,
): ContinuityClassification | null {
  return classifyContinuityWithEpisodes(obs, {}, registry).hit
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
