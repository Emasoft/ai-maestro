---
trdd-id: U6AS2YWB
title: AskUserQuestion event ESC-flood then cursor-ready then directive
column: todo
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-08-26T09:27:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
priority: 2
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: 5CIL7A07
derived: true
derived-kind: eht
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: implement the AskUserQuestion event — flood ESC to dismiss the menu, poll until the cursor
is back at a typeable prompt, then inject the continuation directive as a curated command key.

**UNBLOCKED 2026-07-24** — both blockers are `complete`: the frame reader (TRDD-6HEF0XLS) and the
registry + continuity actuator (TRDD-X8801GT4, `a3a22376`).

### RESUME CHECKPOINT — 2026-08-26 (all sites read first-hand this session; design settled, no code yet)

Sites mapped: union at `lib/continuity-registry.ts:53`; curated-key gate at
`lib/fleet-recovery-actuator.ts:306` (checks `kind === 'command'` — MUST also cover the new kind
or its commandKey bypasses the allowlist gate); production injector = `continuityActuatorDeps()`
in `lib/fleet-continuity.ts:~190-236` (esc branch: raw ESC, addNewline:false, requireIdle:false;
command branch: resolve via getAgentCommand, requireIdle HARDCODED true — keep it); frame capture
idiom = `defaultContinuityDeps().captureFrame` (`:151`, capturePane visible-only + the
empty-vs-error re-probe); events table `lib/continuity-events-claude.ts` (retry-wedge is the
model: matcher + optional progressMarker); curated commands `lib/agent-commands.ts:41` shape
`{key,label,command,requiresIdle,description}`.

**MEASURED CORRECTION to this card's spec:** `getForegroundCommand`/`waitForShellReady`
(`lib/agent-runtime.ts:510`) are the WRONG instrument for "cursor back at a typeable prompt" —
they test that the SHELL is the foreground process, and after dismissing an AskUserQuestion menu
the foreground is still `claude` (the TUI), so the poll would never succeed. The right
"menu dismissed" measure is the FRAME: after each ESC, re-capture and stop when the menu
signature no longer matches. Settled design:
1. Union gains `{ kind: 'esc-then-command'; commandKey: string; maxEsc: number }`.
2. Actuator's unknown_command_key gate covers BOTH command-carrying kinds.
3. Injector performs it: loop ≤ maxEsc: send raw ESC (addNewline:false, requireIdle:false),
   short delay, re-capture the frame; stop when the menu signature is gone (inject a
   `menuGone`/frame-recheck dep rather than teaching the injector client specifics — simplest:
   re-run the event's own matcher against a fresh observation); THEN send the curated key with
   requireIdle:true (the idle wait doubles as "turn settled" — the tool-rejection turn finishes
   before the directive lands, which is what kills the 300s-timeout failure mode).
4. New curated key (e.g. `continuity-decide-yourself`) whose command is the card's verbatim
   directive text below — free text typed as a prompt message, registered as a curated key so
   the injection boundary holds.
5. New event `ask-user-question` in continuity-events-claude.ts: menu-signature matcher in the
   looksLikeAbandonPrompt style (`lib/session-safe-state.ts:127` — broad families, observed not
   guessed; NOTE: no live AskUserQuestion frame has been captured yet — capture one before
   writing the regex, do not guess the copy).
6. ⚠ HID caveat, must be addressed in the same change: `continuityActuatorDeps` sets
   `hidPresent: () => false` with a comment "Any event that sends a COMMAND must wire this
   first" — an AskUserQuestion menu may be mid-interaction by the HUMAN. Wire hidPresent (or
   record an explicit, argued exception: fire flag off by default + requireIdle + cooldown).

NEXT ACTION (superseded framing below kept for history): this event needs a response kind that does not exist yet. E2 deliberately shipped
only `esc` and `command` — a kind the injector cannot PERFORM would be a lie in the type — so
this TRDD adds `{kind:'esc-then-command', commandKey, maxEsc}` to the `ContinuityResponse` union
in `lib/continuity-registry.ts` AND teaches `actuateContinuity` to perform it: ESC repeatedly,
polling `getForegroundCommand`/`waitForShellReady` until the cursor is typeable, bounded by
`maxEsc`, THEN the curated key. Register the directive text as a NEW curated key in
`lib/agent-commands.ts` (never raw free-text — that boundary is what makes the surface
injection-proof); the verbatim directive is in the Spec below.

## Spec

- Per-client menu signature (following `looksLikeAbandonPrompt`); inject ESC repeatedly, **poll
  until the cursor is back at a typeable prompt** (`getForegroundCommand`/`waitForShellReady`),
  bounded by a max-ESC ceiling.
- THEN inject the continuation directive, verbatim: *"decide the best course of action by
  yourself after carefully evaluate the facts. do not assume anything, verify all before
  deciding."* — registered as a NEW fixed curated command key in `lib/agent-commands.ts` (never
  raw free-text, preserving the injection-proof boundary).

## Acceptance

- [ ] A driven AskUserQuestion menu → ESC dismisses it → the directive lands
- [ ] No 300 s timeout
- [ ] The ESC count is bounded

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
