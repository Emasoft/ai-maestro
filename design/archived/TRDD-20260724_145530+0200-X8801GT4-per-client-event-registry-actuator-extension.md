---
trdd-id: X8801GT4
title: Per-client per-event registry and actuator extension
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T21:10:33+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: 5CIL7A07
derived: true
derived-kind: npt
implementation-commits: [a3a22376]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

**COMPLETE 2026-07-24 (commit `a3a22376`).** Two pieces:

1. **`lib/continuity-registry.ts`** — the DATA half. A table keyed on the agent's `program`
   (basename+lowercase normalised, aliases supported), each entry listing `ContinuityEvent`s
   (`id`, `match(obs) → bool`, `response`). `ContinuityObservation` = the RENDERED frame (from
   E1's reader), the buffer type, and the hook's 5-state notification, so an event may match on
   screen text, on hook state, or both. `ContinuityResponse` is a CLOSED union — `{kind:'esc'}`
   (the fixed `ESC_KEYSTROKE`) or `{kind:'command', commandKey}` (a CURATED key). FAIL-OPEN:
   unknown program / empty table / a THROWING matcher all → null, and a broken matcher does not
   stop the rest of that client's events.
2. **`lib/fleet-recovery-actuator.ts`** — the ENGINE half. The four gates were EXTRACTED as
   `checkEntryGates` (fire-flag, machine-wide STOP) + `checkInjectionGates` (HID, cooldown), and
   BOTH diagnoses now call them — a duplicated gate is one place the fleet can be actuated while
   the owner believes it is halted. New `actuateContinuity(target, deps)` orders: `no_event` →
   `unknown_command_key` → entry gates → injection gates → FIRE.

**Design decisions worth not re-litigating:**
- The split is entry/injection (not one block) so each caller interleaves its OWN decision — the
  ladder's rung choice, the registry's key check — and still reports the dominant reason.
- `unknown_command_key` is reported even while the fire flag is OFF. The subsystem ships dark, so
  a typo caught only after arming would first surface as an agent silently receiving nothing.
- The cooldown is per AGENT, not per diagnosis: two subsystems each nudging "once per window"
  would still double-nudge the same agent inside that window.
- `esc-then-command` is deliberately NOT defined — a response kind the injector cannot perform
  would be a lie in the type. **E4 (U6AS2YWB) adds the kind together with the polling that
  executes it.**

51 tests green (21 new + the 22 pre-existing actuator/runner tests unchanged through the
refactor — that is the behaviour-preservation proof + 8 frame-reader). tsc 0, lint clean, build green.

**NEXT (Flock E):** all four E-children unblock — E3 (Y8VPE3NS retry-wedge, the #90 contract),
E4 (U6AS2YWB AskUserQuestion), E5 (9DYUI97S idle-inbox), E6 (8C1Z42GV multi-client). Each is now
a registry ENTRY plus whatever new capability its response needs; the `claude` entry ships with
`events: []` waiting for them.

## Spec

- A registry keyed on the agent's `program` (claude/codex/kimi/opencode/…); each entry declares
  `events: [{ match(frame|hookState) → bool, response: RegistryResponse }]`.
- Extend `fleet-recovery-actuator` with a `conversation-continuity` diagnosis that classifies via
  the registry and dispatches the response through the existing curated-key injection.
- Adding a client = a registry entry, not engine code. Aligns with task #57.

## Acceptance

- [x] Unit test — a frame → an event → a response, with fakes — `continuity-registry.test.ts`
      drives the engine entirely with FAKE client tables, which is itself the proof that no
      client knowledge is baked into the engine
- [x] Unknown `program` → no-op — an unregistered client (and a null/undefined program) classify
      to null and inject nothing, given the very frame that wedges the registered fake client

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T21:10:33+0200 — COMPLETED by ai-maestro (self-mandate). Registry + continuity actuator landed (`a3a22376`); both acceptance boxes met by 21 new tests, and the 22 pre-existing actuator/runner tests pass unchanged through the shared-gate refactor. blocked → complete.
