---
trdd-id: Y8VPE3NS
title: Retry-wedge event the ai-maestro 90 contract
column: blocked
pre-block-column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T15:07:44+0200
current-owner: ai-maestro
created-by: ai-maestro
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
blocked-by: [TRDD-6HEF0XLS, TRDD-X8801GT4]
relevant-rules: [ai-maestro-90]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: implement the retry-wedge event — the canonical ai-maestro#90 contract — detecting
`attempt N/300` spinning turns and injecting a single raw ESC. Blocked on TRDD-6HEF0XLS and
TRDD-X8801GT4 landing first. NEXT ACTION: wait for the reader + registry, then implement the
byte-identical regex + FP gate. Not started.

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
