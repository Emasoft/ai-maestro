---
trdd-id: Y8VPE3NS
title: Retry-wedge event the ai-maestro 90 contract
column: dev
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
derived-kind: eht
relevant-rules: [ai-maestro-90]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: implement the retry-wedge event — the canonical ai-maestro#90 contract — detecting
`attempt N/300` spinning turns and injecting a single raw ESC.

**UNBLOCKED 2026-07-24** — both blockers are `complete`: the frame reader (TRDD-6HEF0XLS,
`lib/agent-frame-reader.ts`) and the registry + continuity actuator (TRDD-X8801GT4, `a3a22376`).

NEXT ACTION: push one `ContinuityEvent` onto the `claude` entry in `lib/continuity-registry.ts`
with the byte-identical `is_retry_wedge` regex and `response: { kind: 'esc' }` — then build the
attempt-ADVANCE false-positive gate, which the registry alone CANNOT express: `match(obs)` is
pure and sees one poll, while "the attempt number advanced since last poll" needs a per-agent
episode store. Decide where that store lives (the watchdog's recovery store is the precedent)
before writing the matcher. The gate is the whole safety of this event: a STATIC string naming
`attempt N/300` — this very TRDD on screen, the #90 issue text, a log tail — must NOT fire.

## Spec

- Regex **byte-identical** to the janitor's `is_retry_wedge`
  `/retrying\s+in\b.*\battempt\s+(\d+)\s*\/\s*\d+/i` (capture attempt N).
- **FP gate = attempt must ADVANCE across polls** (persist per-agent episode: advance=wedged,
  tie=keep polling, vanish=clear); never gate on the usage %.
- Response = **one raw ESC (0x1B)**, a second only past cooldown; **NEVER a command, Enter, or
  Ctrl-C**; after ESC do nothing (abort → `on-stop-failure` → `rate-limited.flag` → resume).
- ESC is a **prerequisite for rotation** (a wedged turn holds the old credential).
- Verify the two empirical unknowns on our PTY (transcript-append during retry; ESC→
  `on-stop-failure` vs plain `Stop` → if `Stop`, call `ensure-resume` after ESC).

## Acceptance

- [ ] Attempt-advancing frames → exactly one ESC per window
- [ ] The **static-string case** (this plan / #90 text) → **NO ESC**
- [ ] A progressing agent → NO ESC
- [ ] Usage-% ignored

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
